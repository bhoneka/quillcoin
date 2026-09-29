# quillcoin.gg

Signed books with one-time codes are hidden in 2b2t dungeon chests. Whoever types a book's code on the site first owns that book's coin.
This repository is the whole site: the pages, the database rules and the API. The tool that hides the books is in
[quillcoin-hider](https://github.com/bhoneka/quillcoin-hider).

## No token

QuillCoin runs without a token. A coin is a line in the site's public ledger with its finder's name on it: it cannot be bought, sold or sent anywhere,
nobody gets a share of a find, and nothing is for sale.

The repository also holds the code for a token on Solana (`token/`, the `/claim` and `/settle` routes, the transfer parts of the ledger page).
All of it is **switched off** by one row in the database (`switches`, read through `token_on()`), which the site's own key can read and cannot change.
While it is off a find writes one line (1 coin for the finder), `begin_claim` refuses, `/claim`, `/settle` and `/health` answer "switched off",
`GET /ledger` says `"claims": "off"`, and the pages show nothing about tokens or wallets. It stays in the repository so that everything the site can do can be read.

## What is where

| Path | What it is |
| --- | --- |
| `index.html`, `site.css`, `site.js` | The site: redeem, the rounds and their books, the map, the guide. |
| `rounds/` | One folder per round that has opened: the hider's audit log as it was at that moment (`audit.txt`), and how to read it (`notes.txt`). |
| `vendor/` | The two libraries the site uses (supabase-js 2.117.2, Leaflet 1.9.4), taken from the npm registry and served from here, each pinned by its hash in `index.html`. The site loads no code from anywhere else. |
| `ledger.html`, `ledger.js` | The public ledger, and the checks that run in the visitor's own browser. |
| `supabase/migrations/` | Every table, rule and function in the database, in the order they were applied. |
| `supabase/functions/api/` | The API. One function, all routes (`index.ts`). `fate.ts` decides what became of a transfer; `supabase/functions/tests/fate_test.ts` tries it against nodes that are late, wrong or silent (`deno test`). |
| `supabase/launch/` | One file, run once by hand before round 1 opens: it removes the test round. It refuses to run once a real round is open. |
| `token/` | `create-mainnet.mjs` creates the real QLL token: 6 decimals, a supply of 0, no freeze authority. `--rehearse` runs the same steps on the test network. The other scripts are the ones the test network was tried with. |
| `tools/` | Map rendering, and `publish_hide.py`: it publishes the recording the hiding tool made of a run (the game's picture and the game's own sound, nothing else), removes everything stored inside the file, stores it, and commits its fingerprint. A recording made by hand is cut down to the run itself and loses its sound. `open_round.py` sets the moment a round opens, and refuses while a book or a recording is missing. |

The site is static and is served by GitHub Pages. Sign-in, the database and the API run on Supabase.

## The API

Base: `https://ovjeipprgkeygnlkraiu.supabase.co/functions/v1/api`

| Route | Who | What it does |
| --- | --- | --- |
| `GET /board` | anyone | Every round and every book: number, fingerprint, when it was hidden, and once found: by whom, when and where. |
| `GET /board?round=N` | anyone | One round. |
| `GET /health` | anyone | Whether moving coins to a wallet can work right now: both nodes answer, the token is there with nobody able to freeze it, the site's key is the one that may create it, and how many transfers its fee money pays for. |
| `GET /ledger` | anyone | Totals, transfers, and the first 1000 lines of the ledger. `GET /ledger?after=ID` continues while `more` is true. |
| `POST /check {code}` | anyone | `unspent`, `spent` or `unknown`. Never spends anything. The site itself does not use it: it checks a code inside the visitor's browser, against the public fingerprints. |
| `POST /redeem {code, ign}` | signed-in finder | Spends the code: 1 QLL to the finder, 0.1 QLL to the founder. |
| `POST /claim {wallet}` | signed-in finder | Sends the finder's whole site balance to their Solana wallet. Refuses addresses that are not wallets. |
| `POST /settle` | signed-in finder | Looks up a transfer that was left open and settles it: arrived, or back on the site. |
| `POST /hide` | the hider tool | Commits a book's fingerprint. Refused once the round is open, and once the round holds all of its books. |
| `POST /video` | the hider | Commits the recording of a hide: its address and its fingerprint, both public at once. The address has to lie in the site's own storage. A committed fingerprint can never be replaced by another. |

A code is never stored. The site sends it once, when REDEEM is pressed. The database is handed the code itself and works out the fingerprint: fingerprints are public, so a fingerprint alone redeems nothing, not even for the site's own key.

## Rules the database enforces

- **A code is spent once, and only the code spends it.** `redeem_book` takes the code, hashes it and locks the book's row, so two people redeeming at the same moment cannot both win. A find, once written, cannot be changed or given to another name.
- **An open round is frozen.** Its opening time, ring and size cannot change, its books cannot be removed or altered, and it cannot be deleted.
- **Nothing joins an open round.** `/hide` refuses new books once a round has opened, and refuses real rounds from anywhere but 2b2t.org.
- **The ring is fixed before the hunt.** Every round publishes how far from spawn its books are (`ring_min`, `ring_max`); once the round is open the database refuses to change it.
- **So is the number of books.** Every round publishes how many books it holds (`planned`). The database refuses a book too many, and refuses to change the number once the round is open.
- **A recording cannot be replaced once its round is open.** A recording is public from the moment it is committed (`video_url`, `video_hash`, `video_at`). The API refuses a different fingerprint for the same book at any time; until the round opens a recording can still be corrected by hand in the database, and from that moment a trigger refuses every change of the fingerprint and of the address.
- **The hider cannot redeem.** Accounts on the `blacklist` table are refused.
- **The position of a chest is sealed.** The hider tool encrypts it (AES-256-GCM) under a key derived from the book's code. The site stores the sealed box and can only open it with the code, which it sees for the first time when the book is redeemed.
- **The ledger only grows.** Updates, deletes and truncates are refused by triggers. Its lines are numbered and chained under one lock, and the site's own key cannot write to it: lines come from the functions that redeem a book or move coins, and from nowhere else.
- **Coins are never returned and delivered at once.** A transfer is one transaction (the wallet's token account, the finder's coins, the founder's tenth, the ledger's newest hash), tried out before it is signed. Its signature and the last block it is valid for are stored before it is sent, once. From then on the balance only goes back when two independent nodes both say that the transaction failed for good, or that they never saw it and a final block past its last valid one exists. For its first three minutes it does not go back at all. A node that is behind, silent or contradicted leaves the question open.
- **One transfer at a time, six an hour.** A finder with a transfer under way cannot start another.

## The ledger, and checking it yourself

Every line carries the hash of the line before it (`prev`) and its own (`hash`):

```
hash = sha256( prev | id | at | delta | reason | coin_round | coin_number | who )
```

The fields are joined with `|` exactly as `GET /ledger` prints them. A missing value (the first line's `prev`, or a line without a coin) is an empty string.

```sh
printf '%s' '|1|2026-09-26T23:59:37.241606Z|1.000|find|0|104|finder' | shasum -a 256
# 6281b991dd96a978358fa2f72fa6212c4bded85ca7e90561740fde6f9cc511a1
```

Whoever runs a database could rewrite all of it and hash it again, so the chain is also anchored where nobody can edit it:
every transfer to a wallet is one Solana transaction that mints the finder's coins, mints the founder's tenth, and carries the note
`quillcoin-ledger:<newest hash>`. A rewritten ledger would no longer contain the hashes already on Solana.

[quillcoin.gg/ledger.html](https://quillcoin.gg/ledger.html) does all of this in the browser: it hashes every line again, reads every
transfer from a public Solana endpoint, and compares the number of coins that exist with the number the ledger sent out.

## The founder's tenth

Each find creates 1 QLL for the finder and 0.1 QLL for a public founder wallet. That is the founder's only income.
There is no presale, and nothing is sold by the founder.

## Running it yourself

```sh
supabase link --project-ref <your project>
supabase db push
supabase functions deploy api --no-verify-jwt
python3 -m http.server 8000      # then open http://localhost:8000
```

Function secrets: `HIDER_KEY`, `QLL_MINT`, `QLL_AUTHORITY`, `QLL_FOUNDER`, `QLL_NETWORK`, `QLL_RPC`, and optionally `DISCORD_WEBHOOK_URL`.

Map tiles come from [2b2t.place](https://2b2t.place)'s 1M² world download (CC0). Not affiliated with 2b2t.org.
