# quillcoin.gg

Static front end (`index.html`) + Supabase for auth, the ledger and three edge functions:

- `POST /api/hide` — hider tool, bearer key: `{round, number, hash, ts}` → stores the hash. Refused after the round is opened.
- `POST /api/redeem` — logged-in user: `{code}` → sha256 → match → atomic spend → +1 coin to user, +0.1 to founder wallet.
- `POST /api/check` — `{code}` → `spent | unspent | unknown`, never spends.
- `GET  /api/board?round=1` — the public board.

Until the backend exists the page reads `api/coins.json` (the committed hash list) and says redemption opens with round 1.
Deploy like iveslibrary: GitHub Pages on `main`, domain via Porkbun.
