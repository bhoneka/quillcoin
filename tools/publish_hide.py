#!/usr/bin/env python3
"""
Publishes the recordings of hides.

  tools/publish_hide.py                       every hide found in the newest recordings of the usual folders
  tools/publish_hide.py <file or folder> ...  every hide found in these recordings
  tools/publish_hide.py <file> --round 1 --number 37 --whole     one named coin, the recording as it is

  --dry    stop before anything leaves this computer: the clips and their stills are written, nothing is sent
  --yes    do not ask before sending

For each hide it finds, it
  1. cuts the clip to the run itself: from the black screen of the flight to the book lying in the chest.
     The takeoff before it and wherever the hider went afterwards are never part of a clip;
  2. removes the sound and everything stored inside the file (device, dates, names), and makes it small enough to keep;
  3. shows stills of the clip and asks;
  4. works out the clip's fingerprint (SHA-256), stores the clip under an address nobody can guess,
     and commits both to the coin. The fingerprint is public at once. The address is published by the site
     the moment the book is found, and not earlier: the floor of a dungeon is enough to work out where it is.

Which part of a recording belongs to which coin comes from the hiding tool's own log, which holds times and events and never a position.
"""
import argparse, hashlib, json, os, re, secrets, subprocess, sys, tempfile, time, urllib.error, urllib.request

HOME = os.path.expanduser('~')
ENV = os.path.join(HOME, '.config/quillcoin/env')
LOG = os.path.join(HOME, 'Library/Application Support/PrismLauncher/instances/QuillCoin Hider/.minecraft/meteor-client/quillcoin-audit.txt')
FOLDERS = [os.path.join(HOME, d) for d in ('Movies', 'Documents/OBS', 'Documents', 'Desktop')]
MAX_BYTES = 46 * 1024 * 1024            # the storage takes 50 MB a file
VIDEO = ('.mp4', '.mov', '.mkv', '.m4v', '.webm')
AFTER_BLACK = 2.0                       # seconds of black flight skipped at the start
BEFORE_AWAY = 5.0                       # the clip ends at least this long before the hider is away from the chest
AFTER_STASH = 12.0                      # ...and at most this long after the book went in


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
        elif what.startswith('takeoff: airborne') and 'start' in cur and 'stash' not in cur: cur['air'] = t       # the last takeoff counts
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
    stash = r['stash'] - start
    if not (0 < stash < dur): return None, 'the recording does not hold the moment the book went in'
    away = (r['away'] - start) if 'away' in r else dur
    end = min(stash + AFTER_STASH, away - BEFORE_AWAY, dur - 0.5)
    if end < stash + 1: return None, f'the hider was away {away - stash:.0f} s after the book went in: too soon to show the book and still stop well before wherever they went'
    if not r.get('blind') or 'air' not in r:
        return (max(0.0, stash - 45), end), None                                  # hidden by hand: the last 45 seconds before the book went in
    air = r['air'] - start
    if air < -5: return None, 'the recording began after the flight had started'
    # the clip begins inside the black of the flight, never before it: what is on screen before that is the place the run started from
    dark = [(s, e) for s, e in black(path, max(0.0, air - 5), min(stash, air + 90)) if e - s >= 5]
    if not dark: return None, 'no black screen was found where the flight should be - the recording and the log do not line up'
    s, e = dark[0]
    begin = max(s + AFTER_BLACK, air + 1)
    if begin > e: return None, 'the black screen of the flight is shorter than expected - the recording and the log do not line up'
    return (begin, end), None


def cut(path, a, b, out):
    d = b - a
    kbps = max(250, min(2000, int(MAX_BYTES * 8 / 1000 / d * 0.92)))
    for _ in range(4):
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{a:.2f}', '-t', f'{d:.2f}', '-i', path, '-an', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
                        '-vf', 'scale=-2:720:flags=lanczos,fps=30', '-c:v', 'libx264', '-preset', 'medium', '-b:v', f'{kbps}k', '-maxrate', f'{int(kbps * 1.4)}k', '-bufsize', f'{kbps * 2}k',
                        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-fflags', '+bitexact', '-flags:v', '+bitexact', out], check=True)
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


def main():
    ap = argparse.ArgumentParser(description='Publish the recordings of hides.')
    ap.add_argument('paths', nargs='*'); ap.add_argument('--round', type=int); ap.add_argument('--number', type=int); ap.add_argument('--whole', action='store_true')
    ap.add_argument('--log', default=LOG); ap.add_argument('--dry', action='store_true'); ap.add_argument('--yes', action='store_true'); ap.add_argument('--out', default=os.path.join(HOME, 'Movies', 'quillcoin-clips'))
    ap.add_argument('--api', default=None, help=argparse.SUPPRESS)
    a = ap.parse_args()
    known = runs(a.log) if os.path.exists(a.log) else []
    files = []
    for p in (a.paths or FOLDERS):
        p = os.path.expanduser(p)
        if os.path.isdir(p): files += sorted(os.path.join(p, f) for f in os.listdir(p) if f.lower().endswith(VIDEO) and not f.startswith('.'))
        elif os.path.exists(p): files.append(p)
    if not a.paths:                                                                # nothing named: only recordings that can hold a hide from the log
        first = min((r.get('start', r['stash']) for r in known), default=0) - 6 * 3600
        files = [f for f in files if os.path.getmtime(f) >= first]
    if not files: raise SystemExit('no recording found')
    e = env(); api = a.api or e['SUPABASE_URL'] + '/functions/v1/api'; store = e['SUPABASE_URL'] + '/storage/v1/object'
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
            kbps = cut(path, win[0], win[1], clip); stills(clip, sheet)
            sha = hashlib.sha256(open(clip, 'rb').read()).hexdigest()
            print(f"{tag}: {win[1] - win[0]:.0f} s of {os.path.basename(path)} (lined up by {how}) -> {os.path.getsize(clip) / 1e6:.1f} MB | sha256 {sha}")
            print(f'   clip   {clip}\n   stills {sheet}')
            seen.add(key)
            if a.dry: continue
            if not a.yes:
                subprocess.run(['open', sheet], check=False)
                print('   Look at the stills: black at the start, the dungeon and the chest at the end, and nothing of any place you would not show.')
                if input(f'   Publish the recording of {tag}? It can never be replaced by another. [y/N] ').strip().lower() not in ('y', 'yes'): print('   left alone'); continue
            name = f"r{r['round']}/coin-{r['number']}-{secrets.token_hex(16)}.mp4"  # nobody can guess it, so the clip stays shut until the site publishes its address
            s, body = call(f'{store}/hides/{name}', open(clip, 'rb').read(), {'authorization': 'Bearer ' + e['SUPABASE_SERVICE_KEY'], 'apikey': e['SUPABASE_SERVICE_KEY'], 'content-type': 'video/mp4', 'cache-control': 'max-age=31536000', 'x-upsert': 'false'})
            if s >= 300: print(f'   the storage refused it ({s}): {body[:160]}'); continue
            url = f"{e['SUPABASE_URL']}/storage/v1/object/public/hides/{name}"
            s, body = call(api + '/video', json.dumps(dict(round=r['round'], number=r['number'], sha256=sha, url=url)).encode(), {'authorization': 'Bearer ' + e['HIDER_KEY'], 'content-type': 'application/json', 'user-agent': 'quillcoin-tools'})
            try: said = json.loads(body).get('message', body)
            except ValueError: said = body[:140]
            print(f'   {"committed" if s < 300 else "NOT committed (" + str(s) + ")"}: {said}')
            done += s < 300
    print('dry run: nothing left this computer' if a.dry else f'{done} recording(s) published')


if __name__ == '__main__': main()
