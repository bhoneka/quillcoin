// Proves the claim path on the test network without touching anyone's account: mints 1 QLL to a throwaway wallet.
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, mintTo, getAccount, getMint } from '@solana/spl-token';
import fs from 'fs'; import os from 'os'; import path from 'path';
const dir = path.join(os.homedir(), '.config/quillcoin');
const info = JSON.parse(fs.readFileSync(path.join(dir, 'devnet.json'), 'utf8'));
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(dir, 'devnet-authority.json'), 'utf8'))));
const conn = new Connection(clusterApiUrl('devnet'), 'confirmed'), mint = new PublicKey(info.mint), to = Keypair.generate().publicKey;
const acct = await getOrCreateAssociatedTokenAccount(conn, authority, mint, to);
const sig = await mintTo(conn, authority, mint, acct.address, authority, 1_000_000n);
const bal = await getAccount(conn, acct.address), m = await getMint(conn, mint);
console.log('minted to throwaway wallet', to.toBase58().slice(0, 8) + '…', '| its balance', Number(bal.amount) / 1e6, 'QLL | total supply', Number(m.supply) / 1e6, '| freeze authority', m.freezeAuthority ? 'SET' : 'none');
console.log('tx https://explorer.solana.com/tx/' + sig + '?cluster=devnet');
