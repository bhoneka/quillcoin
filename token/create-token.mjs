// Creates QLL on the Solana TEST network (devnet). Nothing here has value. The authority key lives outside the repo.
import { Connection, Keypair, LAMPORTS_PER_SOL, clusterApiUrl } from '@solana/web3.js';
import { createMint, getMint } from '@solana/spl-token';
import fs from 'fs'; import os from 'os'; import path from 'path';

const dir = path.join(os.homedir(), '.config/quillcoin');
const keyPath = path.join(dir, 'devnet-authority.json'), infoPath = path.join(dir, 'devnet.json');
let kp;
if (fs.existsSync(keyPath)) kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, 'utf8'))));
else { kp = Keypair.generate(); fs.writeFileSync(keyPath, JSON.stringify([...kp.secretKey]), { mode: 0o600 }); }
console.log('authority (test network only):', kp.publicKey.toBase58());

const conn = new Connection(clusterApiUrl('devnet'), 'confirmed');
let bal = await conn.getBalance(kp.publicKey);
for (let i = 0; i < 4 && bal < 0.2 * LAMPORTS_PER_SOL; i++) {
  try { const sig = await conn.requestAirdrop(kp.publicKey, 1 * LAMPORTS_PER_SOL); await conn.confirmTransaction(sig, 'confirmed'); }
  catch (e) { console.log('faucet said:', String(e.message).slice(0, 90)); await new Promise(r => setTimeout(r, 4000)); }
  bal = await conn.getBalance(kp.publicKey);
}
console.log('test SOL balance:', bal / LAMPORTS_PER_SOL);
if (bal < 0.05 * LAMPORTS_PER_SOL) { console.log('NEED_FAUCET'); process.exit(2); }

if (fs.existsSync(infoPath)) { const info = JSON.parse(fs.readFileSync(infoPath, 'utf8')); console.log('mint already exists:', info.mint); process.exit(0); }
const mint = await createMint(conn, kp, kp.publicKey, null, 6);          // mint authority = the test key, freeze authority = NONE, 6 decimals
const m = await getMint(conn, mint);
fs.writeFileSync(infoPath, JSON.stringify({ network: 'devnet', mint: mint.toBase58(), authority: kp.publicKey.toBase58(), decimals: 6 }, null, 2));
console.log('QLL mint:', mint.toBase58(), '| decimals', m.decimals, '| freeze authority', m.freezeAuthority ? m.freezeAuthority.toBase58() : 'none', '| supply', m.supply.toString());
