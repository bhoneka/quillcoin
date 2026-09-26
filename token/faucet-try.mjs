import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import fs from 'fs'; import os from 'os'; import path from 'path';
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config/quillcoin/devnet-authority.json'), 'utf8'))));
const tries = [['devnet 0.5', 'https://api.devnet.solana.com', 0.5], ['devnet 0.1', 'https://api.devnet.solana.com', 0.1], ['testnet 1', 'https://api.testnet.solana.com', 1]];
for (const [name, url, amt] of tries) {
  const conn = new Connection(url, { commitment: 'confirmed', disableRetryOnRateLimit: true });
  try { const sig = await conn.requestAirdrop(kp.publicKey, amt * LAMPORTS_PER_SOL); await conn.confirmTransaction(sig, 'confirmed'); console.log(name, '→ ok, balance', (await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL); }
  catch (e) { console.log(name, '→', String(e.message).replace(/\s+/g, ' ').slice(0, 110)); }
}
console.log('address:', kp.publicKey.toBase58());
