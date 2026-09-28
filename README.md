# quillcoin.gg

Signed books with one-time codes are hidden in 2b2t dungeon chests. Whoever types a book's code on the site first owns one QuillCoin (QLL).
This repository is the whole site: the pages, the database rules and the API. The tool that hides the books is in
[quillcoin-hider](https://github.com/bhoneka/quillcoin-hider).

## What is where

| Path | What it is |
| --- | --- |
| `index.html`, `site.css`, `site.js` | The site: redeem, the rounds and their books, the map, the guide. |
| `ledger.html`, `ledger.js` | The public ledger, and the checks that run in the visitor's own browser. |
| `supabase/migrations/` | Every table, rule and function in the database, in the order they were applied. |
| `supabase/functions/api/index.ts` | The API. One function, all routes. |
| `supabase/launch/` | One file, run once by hand before round 1 opens: it removes the test round. It refuses to run once a real round is open. |
| `token/` | Scripts that created the QLL token on Solana's test network. |
| `tools/` | Map rendering and the script that fingerprints a hide's recording. |

The site is static and is served by GitHub Pages. Sign-in, the database and the API run on Supabase.

## The API

Base: `https://ovjeipprgkeygnlkraiu.supabase.co/functions/v1/api`

| Route | Who | What it does |
| --- | --- | --- |
| `GET /board` | anyone | Every round and every book: number, fingerprint, when it was hidden, and once found: by whom, when and where. |
| `GET /board?round=N` | anyone | One round. |
| `GET /ledger` | anyone | Totals, transfers, and the first 1000 lines of the ledger. `GET /ledger?after=ID` continues while `more` is true. |
| `POST /check {code}` | anyone | `unspent`, `spent` or `unknown`. Never spends anything. |
| `POST /redeem {code, ign}` | signed-in finder | Spends the code: 1 QLL to the finder, 0.1 QLL to the founder. |
| `POST /claim {wallet}` | signed-in finder | Sends the finder's whole site balance to their Solana wallet. Refuses addresses that are not wallets. |
| `POST /settle` | signed-in finder | Looks up a transfer that was left open and settles it: arrived, or back on the site. |
| `POST /hide`, `POST /video` | the hider tool | Commits a book's fingerprint, and the fingerprint of its recording. Refused once the round is open. |

A code is never stored. It arrives at `/check` and `/redeem`, is hashed at once, and only the hash is looked up.

## Rules the database enforces

- **A code is spent once.** `claim_coin` locks the book's row, so two people redeeming at the same moment cannot both win.
- **Nothing joins an open round.** `/hide` refuses new books once a round has opened, and refuses real rounds from anywhere but 2b2t.org.
- **The hider cannot redeem.** Accounts on the `blacklist` table are refused.
- **The position of a chest is sealed.** The hider tool encrypts it (AES-256-GCM) under a key derived from the book's code. The site stores the sealed box and can only open it with the code, which it sees for the first time when the book is redeemed.
- **The ledger only grows.** Updates, deletes and truncates are refused by triggers.
- **Coins are never returned and delivered at once.** A transfer's signature and the last block it is valid for are stored before it is sent. The balance only goes back to the site when the network has finalized a later block and the transaction is not in it.

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
