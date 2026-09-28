// Mints whatever founder fee has accrued on the ledger but was never minted (finds claimed before the paired mint existed). Safe to re-run: it only ever mints the difference.
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, mintTo, getAccount } from '@solana/spl-token';
import fs from 'fs'; import os from 'os'; import path from 'path';
const dir = path.join(os.homedir(), '.config/quillcoin');
const env = Object.fromEntries(fs.readFileSync(path.join(dir, 'env'), 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'content-type': 'application/json', Prefer: 'return=minimal' };
const rest = (p, o = {}) => fetch(env.SUPABASE_URL + '/rest/v1/' + p, { headers: H, ...o });
const ledger = await (await rest('ledger?select=delta,reason&user_id=is.null')).json();
const owed = Math.round(ledger.reduce((t, r) => t + Number(r.delta), 0) * 1000) / 1000;      // fees accrued minus founder claims already booked
console.log('founder balance on the ledger:', owed);
if (owed <= 0) { console.log('nothing owed'); process.exit(0); }
const info = JSON.parse(fs.readFileSync(path.join(dir, 'devnet.json'), 'utf8'));
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(dir, 'devnet-authority.json'), 'utf8'))));
const conn = new Connection(clusterApiUrl('devnet'), 'confirmed'), mint = new PublicKey(info.mint), founder = new PublicKey(env.QLL_FOUNDER);
const acct = await getOrCreateAssociatedTokenAccount(conn, authority, mint, founder);
const sig = await mintTo(conn, authority, mint, acct.address, authority, BigInt(Math.round(owed * 1000)) * 1000n);
const a = await rest('claims', { method: 'POST', body: JSON.stringify({ user_id: null, wallet: env.QLL_FOUNDER, amount: 0, founder_amount: owed, status: 'sent', tx: sig, network: 'devnet' }) });
const b = await rest('ledger', { method: 'POST', body: JSON.stringify({ user_id: null, delta: -owed, reason: 'founder-claim' }) });
console.log('minted', owed, 'QLL to the founder wallet | booked:', a.status, b.status, '| wallet now holds', Number((await getAccount(conn, acct.address)).amount) / 1e6);
console.log('tx https://explorer.solana.com/tx/' + sig + '?cluster=devnet');
