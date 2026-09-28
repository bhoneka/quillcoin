// Sends a little TEST-NETWORK SOL (free faucet currency, no value) so a fresh wallet has something visible on devnet.
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL, clusterApiUrl } from '@solana/web3.js';
import fs from 'fs'; import os from 'os'; import path from 'path';
const from = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config/quillcoin/devnet-authority.json'), 'utf8'))));
const to = new PublicKey(process.argv[2]), conn = new Connection(clusterApiUrl('devnet'), 'confirmed');
const sig = await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: 0.05 * LAMPORTS_PER_SOL })), [from]);
console.log('sent 0.05 test SOL | wallet now has', (await conn.getBalance(to)) / LAMPORTS_PER_SOL, '| sender has', (await conn.getBalance(from.publicKey)) / LAMPORTS_PER_SOL);
