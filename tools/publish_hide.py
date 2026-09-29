#!/usr/bin/env python3
"""
Publishes the recordings of hides.

  tools/publish_hide.py                         every recording the hiding tool has made that is not on the site yet
  tools/publish_hide.py --recording <file.mp4> --notes <file.json>
                                                one of them (this is how the hiding tool itself calls it, right after a hide)
  tools/publish_hide.py <file or folder> ...    recordings made by hand (QuickTime, OBS): finds the hides in them, cuts them, asks, publishes
  tools/publish_hide.py <file> --round 1 --number 37 --whole     one named coin, the recording as it is

  --dry    stop before anything leaves this computer: the clips and their stills are written, nothing is sent
  --yes    do not ask before sending (recordings made by hand)
  --sound  keep the sound of a recording made by hand (it is removed otherwise: it may hold a microphone)

THE HIDING TOOL'S OWN RECORDINGS hold the game's window and the game's own sound, from the moment a run starts until a
few seconds after the hider is away from the chest (as many as the hiding tool is set to; none, if it is set to none).
The world is hidden before such a recording begins, so there is nothing to cut: everything stored inside the file
(device, dates, names) is removed, and it is made small enough to keep.

RECORDINGS MADE BY HAND may be as long as you like and hold several hides. For each hide the tool cuts the clip to the
run itself: it begins when the run begins and ends when the hider leaves, a moment inside both, so that neither the
place the run started from nor the place the hider went to is ever part of a clip. Which part of a recording belongs to
which coin comes from the hiding tool's own log, which holds times and events and never a position.

Either way the clip's fingerprint (SHA-256) is worked out, the clip is stored, and both are committed to the coin.
From that moment the recording plays on the coin's card, and its fingerprint can never be replaced by another.
"""
import argparse, hashlib, json, os, re, secrets, subprocess, sys, tempfile, time, urllib.error, urllib.request

HOME = os.path.expanduser('~')
ENV = os.path.join(HOME, '.config/quillcoin/env')
HIDER = os.path.join(HOME, 'Library/Application Support/PrismLauncher/instances/QuillCoin Hider/.minecraft/meteor-client')
LOG = os.path.join(HIDER, 'quillcoin-audit.txt')
RECORDINGS = os.path.join(HIDER, 'quillcoin-recordings')
FOLDERS = [os.path.join(HOME, d) for d in ('Movies', 'Documents/OBS', 'Documents', 'Desktop')]
MAX_BYTES = 46 * 1024 * 1024            # the storage takes 50 MB a file
VIDEO = ('.mp4', '.mov', '.mkv', '.m4v', '.webm')
AFTER_START = 1.0                       # the clip begins this long after the run began: by then the world around the hider is no longer drawn
BEFORE_AWAY = 3.0                       # ...and ends this long before the hider is away from the chest: the next thing on screen is wherever they went
LOOSE = 4.0                             # how far the clocks of the recording and of the log may disagree before the tool refuses


def env():
    out = {}
    for line in open(ENV):
        m = re.match(r'\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$', line)
        if m: out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def runs(log_path):
    """Every hide in the log: when its run began, when it was in the air, when the book went in, when the hider was away."""
    found, cur = [], {}
    for line in open(log_path, encoding='utf8', errors='replace'):
        m = re.match(r'(\d+),(.*)', line.strip())
        if not m: continue
        t, what = int(m.group(1)), m.group(2)
        if what.startswith('run started'): cur = {'start': t}
        elif what.startswith('takeoff: gliding') and 'start' in cur and 'air' not in cur: cur['glide'] = t          # the screen goes black the moment the hider glides
        elif what.startswith('takeoff: airborne') and 'start' in cur and 'stash' not in cur: cur['air'] = t
        elif what.startswith('the flight stopped right after takeoff') and 'stash' not in cur: cur.pop('air', None)   # a takeoff that failed: the next one counts
        elif what.startswith('stashed '):
            s = re.match(r'stashed R(\d+) Coin (\d+)(.*)', what)
            if s: cur.update(round=int(s.group(1)), number=int(s.group(2)), stash=t, blind='WITHOUT' not in s.group(3))
        elif what.startswith('away from the stash') and 'stash' in cur:
            cur['away'] = t; found.append(cur); cur = {}
        elif ('run void' in what or what == 'module on') and 'stash' not in cur: cur = {}
    if 'stash' in cur: found.append(cur)
    return found


def probe(path):
    """When a recording began (seconds since 1970) and how long it is. The file's name is trusted first, then what the recorder stored, then the file's own dates."""
    j = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_format', path], capture_output=True, text=True, check=True).stdout)
    dur = float(j['format']['duration'])
    st = os.stat(path)
    guess = st.st_mtime - dur
    birth = getattr(st, 'st_birthtime', None)
    if birth and abs(birth - guess) < 30: guess = min(birth, guess)
    name = os.path.basename(path)
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})[ _T](\d{2})-(\d{2})-(\d{2})', name)                                  # OBS: 2026-09-29 21-35-23
    if m:
        t = time.mktime(tuple(int(x) for x in m.groups()) + (0, 0, -1))
        if abs(t - guess) < 30: return t, dur, 'the file name'
    m = re.search(r'(\d{4})-(\d{2})-(\d{2}) at (\d{1,2})\.(\d{2})\.(\d{2})\s*([AP]M)?', name.replace(' ', ' '))   # macOS: Screen Recording 2026-09-29 at 9.35.23 PM
    if m:
        y, mo, d, h, mi, s, ap = m.groups(); h = int(h) % 12 + (12 if ap == 'PM' else 0) if ap else int(h)
        t = time.mktime((int(y), int(mo), int(d), h, int(mi), int(s), 0, 0, -1))
        if abs(t - guess) < 30: return t, dur, 'the file name'
    tag = (j['format'].get('tags') or {}).get('creation_time')
    if tag:
        try:
            import calendar
            t = calendar.timegm(time.strptime(tag[:19], '%Y-%m-%dT%H:%M:%S'))
            if abs(t - guess) < 30: return t, dur, 'the date stored in the file'
        except ValueError: pass
    return guess, dur, "the file's own dates"


def black(path, a, b):
    """The stretches of [a, b] in which the picture is black (the flight), as offsets into the recording."""
    if b - a < 1: return []
    err = subprocess.run(['ffmpeg', '-v', 'info', '-nostats', '-ss', f'{a:.2f}', '-t', f'{b - a:.2f}', '-i', path, '-an', '-vf', 'scale=320:-2,blackdetect=d=1:pic_th=0.85:pix_th=0.12', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return [(a + float(s), a + float(e)) for s, e in re.findall(r'black_start:([\d.]+) black_end:([\d.]+)', err)]


def window(path, r, start, dur):
    """Which part of the recording is this hide's clip. Returns (from, to) or a reason why there is none."""
    at = lambda t: t - start                                                      # a moment of the log, as seconds into the recording
    if not (0 < at(r['stash']) < dur): return None, 'the recording does not hold the moment the book went in'
    if not r.get('blind') or 'start' not in r or 'glide' not in r:
        end = min(at(r['away']) - BEFORE_AWAY - 2, dur - 0.5) if 'away' in r else min(at(r['stash']) + 12, dur - 0.5)
        if end < at(r['stash']) + 1: return None, 'the hider left too soon after the book went in to show it and still stop well before wherever they went'
        return (max(0.0, at(r['stash']) - 45), end), None                           # hidden by hand: the last 45 seconds before the book went in
    if at(r['start']) < 1: return None, 'the recording began after the run had started - a clip has to show the whole run'
    # the two clocks are lined up on something both of them saw: the moment the screen went black
    dark = [(a, b) for a, b in black(path, max(0.0, at(r['glide']) - LOOSE - 2), min(dur, at(r['glide']) + 90)) if b - a >= 5]
    if not dark: return None, 'no black screen was found where the flight should be - the recording and the log do not line up'
    off = dark[0][0] - at(r['glide'])
    if abs(off) > LOOSE: return None, f'the black screen of the flight is {abs(off):.0f} s away from where the log says - the recording and the log do not line up'
    begin = at(r['start']) + off + AFTER_START
    end = min(at(r['away']) + off - BEFORE_AWAY, dur - 0.5) if 'away' in r else min(at(r['stash']) + off + 12, dur - 0.5)
    if begin < 0.5: return None, 'the recording began after the run had started - a clip has to show the whole run'
    if end < at(r['stash']) + off + 1: return None, 'the hider left too soon after the book went in to show it and still stop well before wherever they went'
    return (begin, end), None


def cut(path, a, b, out, sound=False):
    d = b - a
    voice = 96 if sound else 0
    kbps = max(250, min(2500, int(MAX_BYTES * 8 / 1000 / d * 0.92) - voice))
    has_sound = sound and 'audio' in subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout
    for _ in range(4):
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{a:.2f}', '-t', f'{d:.2f}', '-i', path, '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1', '-map', '0:v:0']
                       + (['-map', '0:a:0', '-c:a', 'aac', '-b:a', f'{voice}k', '-ac', '2', '-ar', '48000'] if has_sound else ['-an'])
                       + ['-vf', 'scale=-2:720:flags=lanczos,fps=30', '-c:v', 'libx264', '-preset', 'medium', '-b:v', f'{kbps}k', '-maxrate', f'{int(kbps * 1.4)}k', '-bufsize', f'{kbps * 2}k',
                          '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact', out], check=True)
        if os.path.getsize(out) <= MAX_BYTES: return kbps
        kbps = int(kbps * 0.8)
    raise SystemExit('could not make the clip small enough')


def stills(clip, out):
    d = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', clip], capture_output=True, text=True, check=True).stdout)
    at = [0.1, d * 0.3, d * 0.6, max(0.1, d - 12), max(0.1, d - 5), max(0.1, d - 0.2)]          # the beginning, the way, and three looks at the end
    tmp = tempfile.mkdtemp()
    for i, t in enumerate(at):
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{t:.2f}', '-i', clip, '-frames:v', '1', '-vf', 'scale=480:270', os.path.join(tmp, f'{i}.png')], check=True)
    subprocess.run(['ffmpeg', '-y', '-v', 'error'] + sum((['-i', os.path.join(tmp, f'{i}.png')] for i in range(len(at))), []) + ['-filter_complex', 'xstack=inputs=6:layout=0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0', out], check=True)


def call(url, data, headers, method='POST'):
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=600) as r: return r.status, r.read().decode('utf8', 'replace')
    except urllib.error.HTTPError as e: return e.code, e.read().decode('utf8', 'replace')


def send(e, api, clip, rnd, number):
    """Stores the clip and commits it to its coin. Returns (done, what was said, fingerprint)."""
    sha = hashlib.sha256(open(clip, 'rb').read()).hexdigest()
    name = f"r{rnd}/coin-{number}-{secrets.token_hex(8)}.mp4"
    s, body = call(f"{e['SUPABASE_URL']}/storage/v1/object/hides/{name}", open(clip, 'rb').read(), {'authorization': 'Bearer ' + e['SUPABASE_SERVICE_KEY'], 'apikey': e['SUPABASE_SERVICE_KEY'], 'content-type': 'video/mp4', 'cache-control': 'max-age=31536000', 'x-upsert': 'false'})
    if s >= 300: return False, f'the storage refused it ({s}): {body[:120]}', sha
    url = f"{e['SUPABASE_URL']}/storage/v1/object/public/hides/{name}"
    s, body = call(api + '/video', json.dumps(dict(round=rnd, number=number, sha256=sha, url=url)).encode(), {'authorization': 'Bearer ' + e['HIDER_KEY'], 'content-type': 'application/json', 'user-agent': 'quillcoin-tools'})
    try: said = json.loads(body).get('message', body)
    except ValueError: said = body[:140]
    return s < 300, said if s < 300 else f'not committed ({s}): {said}', sha


def on_site(api, rnd, number):
    """The coin as the site shows it, None when it is not there, False when the site cannot be read."""
    s, body = call(f'{api}/board?round={rnd}', None, {'user-agent': 'quillcoin-tools'}, 'GET')
    if s == 404: return None
    if s != 200: return False
    return next((c for c in json.loads(body)['coins'] if c['number'] == number), None)


def own(recording, notes_path, e, api, dry=False, wait=600):
    """One recording made by the hiding tool. Returns (done, one line about it)."""
    notes = json.load(open(notes_path))
    rnd, number = notes.get('round'), notes.get('number')
    if not notes.get('hidden') or number is None: return False, 'no book was hidden during this recording'
    tag = f'R{rnd} coin {number}'
    marker = recording[:-4] + '.published'
    if os.path.exists(marker): return True, f'{tag}: already published'
    coin, until = on_site(api, rnd, number), time.time() + wait
    while not coin and time.time() < until:                                        # its fingerprint is posted when the hider is away; give it a moment
        time.sleep(10); coin = on_site(api, rnd, number)
    if not coin: return False, f'{tag}: the book is not on the site yet - run tools/publish_hide.py once it is'
    if coin.get('video_hash'):
        open(marker, 'w').write(json.dumps(dict(sha256=coin['video_hash'], url=coin.get('video_url'), note='was on the site already'), indent=1))
        return True, f'{tag}: a recording is already committed'
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', recording], capture_output=True, text=True, check=True).stdout)
    end = notes.get('seconds_to_end')
    if notes.get('seconds_to_away') is not None and end: end = min(dur - 0.05, end)  # it went on after the hider had left, on purpose: all of it is kept
    else: end = min(dur - 0.3, end - 1.0) if end else dur - 2.0                      # otherwise the last second is never part of it
    if end < 5: return False, f'{tag}: the recording is too short to be the recording of a hide'
    folder = os.path.join(os.path.dirname(recording), 'published'); os.makedirs(folder, exist_ok=True)
    clip = os.path.join(folder, f'r{rnd}-coin-{number}.mp4')
    cut(recording, 0.0, end, clip, sound=True); stills(clip, clip[:-4] + '-stills.png')
    if dry: return True, f'{tag}: {end:.0f} s, {os.path.getsize(clip) / 1e6:.1f} MB - dry run, nothing was sent'
    done, said, sha = send(e, api, clip, rnd, number)
    if done: open(marker, 'w').write(json.dumps(dict(sha256=sha, seconds=round(end, 1), bytes=os.path.getsize(clip), at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())), indent=1))
    return done, f'{tag}: {end:.0f} s, {os.path.getsize(clip) / 1e6:.1f} MB, ' + ('on the site' if done else said)


def note(line):
    print(line, flush=True)
    try: open(os.path.join(RECORDINGS, 'publish.log'), 'a').write(time.strftime('%Y-%m-%d %H:%M:%S ') + line + '\n')
    except OSError: pass


def main():
    ap = argparse.ArgumentParser(description='Publish the recordings of hides.')
    ap.add_argument('paths', nargs='*'); ap.add_argument('--round', type=int); ap.add_argument('--number', type=int); ap.add_argument('--whole', action='store_true')
    ap.add_argument('--recording'); ap.add_argument('--notes'); ap.add_argument('--sound', action='store_true')
    ap.add_argument('--log', default=LOG); ap.add_argument('--dry', action='store_true'); ap.add_argument('--yes', action='store_true'); ap.add_argument('--out', default=os.path.join(HOME, 'Movies', 'quillcoin-clips'))
    ap.add_argument('--api', default=None, help=argparse.SUPPRESS); ap.add_argument('--wait', type=int, default=600, help=argparse.SUPPRESS)
    a = ap.parse_args()
    e = env(); api = a.api or e['SUPABASE_URL'] + '/functions/v1/api'

    if a.recording:                                                                # called by the hiding tool, right after a hide
        try: done, said = own(a.recording, a.notes or a.recording[:-4] + '.json', e, api, a.dry, a.wait)
        except Exception as x: done, said = False, f'{type(x).__name__}: {x}'
        note(said); sys.exit(0 if done else 1)

    if not a.paths:                                                                # whatever the hiding tool recorded and is not on the site yet
        waiting = sorted(f for f in (os.listdir(RECORDINGS) if os.path.isdir(RECORDINGS) else []) if re.fullmatch(r'r\d+-coin-\d+\.json', f) and not os.path.exists(os.path.join(RECORDINGS, f[:-5] + '.published')))
        if not waiting: print('nothing is waiting: every recording the hiding tool made is on the site. (Recordings made by hand: name the file or the folder.)'); return
        bad = 0
        for f in waiting:
            try: done, said = own(os.path.join(RECORDINGS, f[:-5] + '.mp4'), os.path.join(RECORDINGS, f), e, api, a.dry, 0)
            except Exception as x: done, said = False, f'{f}: {type(x).__name__}: {x}'
            note(said); bad += not done
        sys.exit(1 if bad else 0)

    known = runs(a.log) if os.path.exists(a.log) else []
    files = []
    for p in a.paths:
        p = os.path.expanduser(p)
        if os.path.isdir(p): files += sorted(os.path.join(p, f) for f in os.listdir(p) if f.lower().endswith(VIDEO) and not f.startswith('.'))
        elif os.path.exists(p): files.append(p)
    if not files: raise SystemExit('no recording found')
    s, body = call(api + '/board', None, {'user-agent': 'quillcoin-tools'}, 'GET')
    if s != 200: raise SystemExit(f'the site could not be read ({s})')
    board = {(r['id'], c['number']): c for r in json.loads(body)['rounds'] for c in r['coins']}
    os.makedirs(a.out, exist_ok=True)
    done, seen = 0, set()
    for path in files:
        try: start, dur, how = probe(path)
        except Exception: continue
        if a.whole:
            if a.round is None or a.number is None: raise SystemExit('--whole needs --round and --number')
            jobs = [(dict(round=a.round, number=a.number), (0.0, dur), None)]
        else:
            mine = [r for r in known if start - 2 <= r['stash'] <= start + dur + 2 and (a.round is None or r['round'] == a.round) and (a.number is None or r['number'] == a.number)]
            jobs = [(r,) + window(path, r, start, dur) for r in mine]
        for r, win, why in jobs:
            key = (r['round'], r['number']); tag = f"R{r['round']} coin {r['number']}"
            if key in seen: continue
            if key not in board: print(f'{tag}: not on the site - skipped'); continue
            if board[key].get('video_hash') and not a.dry: print(f'{tag}: a recording is already committed - skipped'); seen.add(key); continue
            if not win: print(f'{tag}: {why} ({os.path.basename(path)}, lined up by {how})'); continue
            clip = os.path.join(a.out, f"r{r['round']}-coin-{r['number']}.mp4"); sheet = clip[:-4] + '-stills.png'
            cut(path, win[0], win[1], clip, a.sound); stills(clip, sheet)
            print(f"{tag}: {win[1] - win[0]:.0f} s of {os.path.basename(path)} (lined up by {how}) -> {os.path.getsize(clip) / 1e6:.1f} MB")
            print(f'   clip   {clip}\n   stills {sheet}')
            seen.add(key)
            if a.dry: continue
            if not a.yes:
                subprocess.run(['open', sheet], check=False)
                print('   Look at the stills: nothing of any place you would not show, at the start or at the end.')
                if input(f'   Publish the recording of {tag}? It can never be replaced by another. [y/N] ').strip().lower() not in ('y', 'yes'): print('   left alone'); continue
            ok, said, sha = send(e, api, clip, r['round'], r['number'])
            print(f'   {said}\n   sha256 {sha}')
            done += ok
    print('dry run: nothing left this computer' if a.dry else f'{done} recording(s) published')


if __name__ == '__main__': main()
