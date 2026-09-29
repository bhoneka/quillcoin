// Creates the real QLL token on Solana, once, and opens wallet transfers on the site.
//
//   node create-mainnet.mjs             the real network
//   node create-mainnet.mjs --rehearse  the same steps on the test network, with a token that is worth nothing
//
// Run it yourself, in your own terminal. It asks before every step that costs anything or cannot be undone.
//
// What it makes:
//   - a key that can create QLL. It is written to ~/.config/quillcoin/ and to the site's private settings, and nowhere else.
//     It is never printed. Whoever holds it can create coins, so it is never shared, committed or pasted anywhere.
//   - the token: 6 decimals, a supply of 0, and NO freeze authority, so nobody can ever freeze coins in somebody's wallet.
//     Coins only come into existence when the site moves a finder's coins to their wallet.
//   - its name, ticker and logo (QuillCoin, QLL).
//
// What it needs: about 0.1 SOL sent to the address it prints, from a wallet of your own.
// Roughly 0.03 of it pays for creating the token; the rest pays the network when finders move their coins (about 0.002 each).
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { createMint, getMint } from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createMetadataAccountV3, findMetadataPda, fetchMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import { execFileSync } from 'child_process';
import readline from 'readline/promises';
import fs from 'fs'; import os from 'os'; import path from 'path'; import url from 'url';

const rehearse = process.argv.includes('--rehearse');
const NET = rehearse ? 'devnet' : 'mainnet';
const RPCS = rehearse ? ['https://api.devnet.solana.com'] : ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'];
const SITE_RPC = rehearse ? 'https://api.devnet.solana.com' : 'https://solana-rpc.publicnode.com';
const NAME = 'QuillCoin', SYMBOL = 'QLL', URI = 'https://quillcoin.gg/token/qll.json', DECIMALS = 6;
const NEED = 0.05, SEND = 0.1;

const dir = path.join(os.homedir(), '.config/quillcoin');
const keyPath = path.join(dir, rehearse ? 'rehearsal-authority.json' : 'mainnet-authority.json');
const infoPath = path.join(dir, rehearse ? 'rehearsal.json' : 'mainnet.json');
const repo = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ask = async (q, word) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(`\n${q}\nType ${word} to go on, anything else to stop: `)).trim().toLowerCase() === word; }
  finally { rl.close(); }
};
const stop = (why) => { console.log('\n' + why); process.exit(0); };
const explorer = (kind, id) => `https://explorer.solana.com/${kind}/${id}${rehearse ? '?cluster=devnet' : ''}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function connect() {
  for (const u of RPCS) { try { const c = new Connection(u, 'confirmed'); await c.getLatestBlockhash(); return [c, u]; } catch (e) { console.log('no answer from', u); } }
  throw new Error('Solana could not be reached');
}

console.log(rehearse ? '\nREHEARSAL on the test network. Nothing here is worth anything.' : '\nTHE REAL NETWORK. This creates the real QLL token.');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

// 1. the key
let kp;
if (fs.existsSync(keyPath)) kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, 'utf8'))));
else {
  kp = Keypair.generate();
  fs.writeFileSync(keyPath, JSON.stringify([...kp.secretKey]), { mode: 0o600, flag: 'wx' });
  console.log('\nA new key was made and saved to', keyPath.replace(os.homedir(), '~'));
  console.log('Keep a copy of that file somewhere safe (a USB stick, a password manager). Without it no coin can ever be moved to a wallet again.');
}
fs.chmodSync(keyPath, 0o600);
const address = kp.publicKey.toBase58();
console.log('\nThe address that creates QLL:', address);

const [conn, rpcUrl] = await connect();

// 2. the money for the network
let bal = await conn.getBalance(kp.publicKey);
const have = fs.existsSync(infoPath) ? JSON.parse(fs.readFileSync(infoPath, 'utf8')) : null;
if (!have && bal < NEED * LAMPORTS_PER_SOL) {
  console.log(`\nIt holds ${bal / LAMPORTS_PER_SOL} SOL and needs at least ${NEED}.`);
  console.log(rehearse ? 'Get test SOL for it at https://faucet.solana.com (choose devnet).' : `Send ${SEND} SOL to it from a wallet of your own. Check the address twice; a transfer cannot be taken back.`);
  console.log('Waiting for it to arrive (Ctrl+C stops; running the script again picks up here)...');
  for (let i = 0; i < 360 && bal < NEED * LAMPORTS_PER_SOL; i++) { await sleep(10_000); try { bal = await conn.getBalance(kp.publicKey); } catch (e) { } }
  if (bal < NEED * LAMPORTS_PER_SOL) stop('Nothing arrived within an hour. Run the script again once it has been sent.');
}
console.log(`\nBalance: ${bal / LAMPORTS_PER_SOL} SOL`);

// 3. the token
let mint;
if (have) { mint = new PublicKey(have.mint); console.log('The token already exists:', have.mint); }
else {
  if (!await ask(`This creates the token ${NAME} (${SYMBOL}) on ${NET}: ${DECIMALS} decimals, supply 0, no freeze authority.\nIt costs about 0.03 SOL and cannot be undone.`, 'create')) stop('Nothing was created.');
  mint = await createMint(conn, kp, kp.publicKey, null, DECIMALS);
  fs.writeFileSync(infoPath, JSON.stringify({ network: NET, mint: mint.toBase58(), authority: address, decimals: DECIMALS, created: new Date().toISOString() }, null, 2));
  console.log('Created. The token\'s address:', mint.toBase58());
}

// 4. its name, ticker and logo
const umi = createUmi(rpcUrl);
umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(kp.secretKey)));
const pda = findMetadataPda(umi, { mint: publicKey(mint.toBase58()) });
let meta = null;
try { meta = await fetchMetadata(umi, pda); } catch (e) { }
if (!meta) {
  console.log('Writing its name, ticker and logo...');
  await createMetadataAccountV3(umi, {
    mint: publicKey(mint.toBase58()), mintAuthority: umi.identity, payer: umi.identity, updateAuthority: umi.identity.publicKey,
    data: { name: NAME, symbol: SYMBOL, uri: URI, sellerFeeBasisPoints: 0, creators: null, collection: null, uses: null },
    isMutable: true, collectionDetails: null,                                  // the logo can still be replaced; the supply rules above cannot
  }).sendAndConfirm(umi);
  for (let i = 0; i < 10 && !meta; i++) { await sleep(2000); try { meta = await fetchMetadata(umi, pda); } catch (e) { } }
}

// 5. read everything back from the network
const m = await getMint(conn, mint);
const okay = m.decimals === DECIMALS && m.freezeAuthority === null && m.mintAuthority?.toBase58() === address && meta?.name?.replace(/\0/g, '').trim() === NAME && meta?.symbol?.replace(/\0/g, '').trim() === SYMBOL;
console.log('\nRead back from the network:');
console.log('  token          ', mint.toBase58());
console.log('  name / ticker  ', meta ? `${meta.name.replace(/\0/g, '').trim()} / ${meta.symbol.replace(/\0/g, '').trim()}` : 'NOT WRITTEN');
console.log('  decimals       ', m.decimals);
console.log('  supply         ', (Number(m.supply) / 10 ** m.decimals).toString());
console.log('  can be frozen  ', m.freezeAuthority ? 'YES - this is wrong' : 'no, by nobody');
console.log('  created by     ', m.mintAuthority?.toBase58());
console.log('  to look at it  ', explorer('address', mint.toBase58()));
if (!okay) stop('Something is not as it should be. Wallet transfers were NOT opened. Run the script again, or look at the lines above.');

// 6. the site
if (process.argv.includes('--no-site')) stop('Done. The site was left as it is (--no-site).');
if (rehearse) stop('Rehearsal done. The site is never touched by a rehearsal.');
if (!await ask('Open wallet transfers on quillcoin.gg now? From that moment finders can move their coins to a wallet as real QLL.\nThe token\'s address appears on the site and in the ledger.', 'open')) stop('The token exists; the site was left as it is. Run the script again to open it.');
const tmp = path.join(dir, '.secrets-' + process.pid);
try {
  fs.writeFileSync(tmp, `QLL_NETWORK=mainnet\nQLL_RPC=${SITE_RPC}\nQLL_MINT=${mint.toBase58()}\nQLL_AUTHORITY=${JSON.stringify([...kp.secretKey])}\n`, { mode: 0o600 });
  execFileSync('supabase', ['secrets', 'set', '--env-file', tmp], { cwd: repo, stdio: ['ignore', 'ignore', 'inherit'] });
} finally { try { fs.rmSync(tmp); } catch (e) { } }
await sleep(4000);
const live = await (await fetch('https://ovjeipprgkeygnlkraiu.supabase.co/functions/v1/api/ledger')).json();
console.log('\nThe site now says: network', live.network, '| token', live.mint, '| wallet transfers', live.claims);
console.log(live.mint === mint.toBase58() && live.claims === 'open' ? 'Open. Check 2 on https://quillcoin.gg/ledger.html now reads the real network.' : 'The site has not picked it up yet - look again in a minute.');
process.exit(0);
