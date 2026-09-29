#!/usr/bin/env python3
"""
How many people visit quillcoin.gg. Numbers only: the site keeps nothing about who they are.

  tools/visitors.py            the numbers, once
  tools/visitors.py --watch    the same, again every 30 seconds (ctrl-C to stop)

A visitor is one browser address on one day. Somebody who comes on two days counts on both.
"""
import json, os, re, sys, time, urllib.error, urllib.request

ENV = os.path.join(os.path.expanduser('~'), '.config/quillcoin/env')


def env():
    out = {}
    for line in open(ENV):
        m = re.match(r'\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$', line)
        if m: out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def ask(e, name, args=None):
    key = e['SUPABASE_SERVICE_KEY']
    req = urllib.request.Request(f"{e['SUPABASE_URL']}/rest/v1/rpc/{name}", data=json.dumps(args or {}).encode(), method='POST',
                                 headers={'apikey': key, 'authorization': 'Bearer ' + key, 'content-type': 'application/json', 'user-agent': 'quillcoin-tools'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read().decode('utf8'))
    except urllib.error.HTTPError as err: raise SystemExit(f'the database refused ({err.code}): {err.read().decode("utf8", "replace")[:200]}')


def show(e):
    n = ask(e, 'visitors'); n = n[0] if isinstance(n, list) else n
    print(time.strftime('%H:%M:%S'), 'here')
    print(f"   on the site in the last 5 minutes   {n['last_5_min']}")
    print(f"   in the last 15 minutes              {n['last_15_min']}")
    print(f"   in the last hour                    {n['last_hour']}")
    print(f"   today (since midnight UTC)          {n['today']}   ({n['pages_today']} page loads)")
    print(f"   yesterday                           {n['yesterday']}")
    print(f"   the last 7 days, added up           {n['last_7_days']}")
    hours = ask(e, 'visitors_by_hour')
    if hours:
        top = max(h['new_visitors'] for h in hours)
        print('   new visitors per hour, last 24 hours (UTC):')
        for h in hours[:24]: print(f"      {h['hour'][11:16]}  {h['new_visitors']:5d}  {'█' * max(1, round(h['new_visitors'] / top * 30))}")
    days = ask(e, 'visitors_by_day', {'p_days': 14})
    if len(days) > 1:
        print('   per day:')
        for d in days: print(f"      {d['day']}  {d['visitors']:5d} visitors  {d['pages']:6d} page loads")


def main():
    e = env()
    if '--watch' not in sys.argv: return show(e)
    try:
        while True:
            print('\033[2J\033[H', end=''); show(e); time.sleep(30)
    except KeyboardInterrupt: pass


if __name__ == '__main__': main()
