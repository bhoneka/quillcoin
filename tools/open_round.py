#!/usr/bin/env python3
"""
Sets the moment a round opens. From that moment its books can be redeemed, and its list of books, its ring and its size are locked for good.

  tools/open_round.py 1                        what the round looks like right now; changes nothing
  tools/open_round.py 1 --at "2026-10-03 18:00"   opens at that time (this computer's clock)
  tools/open_round.py 1 --now                  opens at once
  tools/open_round.py 1 --not-yet              takes a planned opening back, as long as it has not happened

It refuses while books are missing or a book has no recording committed (--allow-missing-recordings opens it anyway; those books show that they have none). A round that is open cannot be closed again with this.
"""
import argparse, json, os, re, sys, time, urllib.error, urllib.request

ENV = os.path.join(os.path.expanduser('~'), '.config/quillcoin/env')


def env():
    out = {}
    for line in open(ENV):
        m = re.match(r'\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$', line)
        if m: out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def call(url, headers, data=None, method='GET'):
    req = urllib.request.Request(url, data=data, headers={**headers, 'user-agent': 'quillcoin-tools'}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, r.read().decode('utf8', 'replace')
    except urllib.error.HTTPError as e: return e.code, e.read().decode('utf8', 'replace')


def main():
    ap = argparse.ArgumentParser(description='Set the moment a round opens.')
    ap.add_argument('round', type=int); ap.add_argument('--at'); ap.add_argument('--now', action='store_true'); ap.add_argument('--not-yet', action='store_true'); ap.add_argument('--yes', action='store_true'); ap.add_argument('--allow-missing-recordings', action='store_true')
    a = ap.parse_args()
    e = env(); api = e['SUPABASE_URL'] + '/functions/v1/api'
    s, body = call(f'{api}/board?round={a.round}', {})
    if s != 200: raise SystemExit(f'round {a.round}: the site answered {s}')
    b = json.loads(body); r, coins = b['round'], b['coins']
    opened = r['opened_at'] and time.mktime(time.strptime(r['opened_at'][:19], '%Y-%m-%dT%H:%M:%S')) - time.timezone <= time.time()
    no_video = [c['number'] for c in coins if not c.get('video_hash')]
    by_hand = [c['number'] for c in coins if not c.get('blind')]
    print(f"round {r['id']}: {len(coins)} of {r['planned']} books on the site | ring {r['ring_min']:,} to {r['ring_max']:,} | opens: {r['opened_at'] or 'not set'}{' (already open)' if opened else ''}")
    print(f"   recordings committed: {len(coins) - len(no_video)} of {len(coins)}" + (f" | missing for coin {', '.join(map(str, no_video))}" if no_video else ''))
    if by_hand: print(f"   hidden without a blind run: coin {', '.join(map(str, by_hand))}")
    if not (a.at or a.now or a.not_yet): return
    if opened: raise SystemExit('This round is open. That cannot be changed.')
    if a.not_yet: when = None
    else:
        if r['planned'] and len(coins) < r['planned']: raise SystemExit(f"Only {len(coins)} of {r['planned']} books are hidden. A round opens when all of its books are out there.")
        if no_video and not a.allow_missing_recordings: raise SystemExit('Every book needs its recording committed before the round opens (tools/publish_hide.py). If one was lost, say so with --allow-missing-recordings: that book will show that it has none.')
        t = time.time() if a.now else time.mktime(time.strptime(a.at, '%Y-%m-%d %H:%M'))
        if t < time.time() - 60: raise SystemExit('That moment has passed.')
        when = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(t))
        print(f"   opening: {time.strftime('%Y-%m-%d %H:%M', time.localtime(t))} here = {when.replace('T', ' ').replace('Z', ' UTC')}")
        if not a.yes and input('   From that moment the books can be redeemed and nothing about the round can change. Go on? [y/N] ').strip().lower() not in ('y', 'yes'): raise SystemExit('left as it was')
    key = e['SUPABASE_SERVICE_KEY']
    s, body = call(f"{e['SUPABASE_URL']}/rest/v1/rounds?id=eq.{a.round}", {'apikey': key, 'authorization': 'Bearer ' + key, 'content-type': 'application/json', 'prefer': 'return=representation'}, json.dumps({'opened_at': when}).encode(), 'PATCH')
    if s >= 300: raise SystemExit(f'the database refused ({s}): {body[:200]}')
    print('   done:', json.loads(body)[0]['opened_at'] or 'no opening time set')


if __name__ == '__main__': main()
