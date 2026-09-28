import { Connection, PublicKey, LAMPORTS_PER_SOL, clusterApiUrl } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { fetchMetadataFromSeeds } from '@metaplex-foundation/mpl-token-metadata';
import { publicKey } from '@metaplex-foundation/umi';
const MINT = 'BCHXyYfPhpPjfQGfVQ2qt44EHkwb9utmAmrtMpRRktyH', who = new PublicKey(process.argv[2]);
const conn = new Connection(clusterApiUrl('devnet'), 'confirmed');
console.log('wallet test SOL:', (await conn.getBalance(who)) / LAMPORTS_PER_SOL);
const accts = await conn.getParsedTokenAccountsByOwner(who, { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') });
for (const a of accts.value) { const i = a.account.data.parsed.info; console.log('token account', a.pubkey.toBase58().slice(0, 8) + '…', 'mint', i.mint.slice(0, 8) + '…', 'amount', i.tokenAmount.uiAmountString, 'state', i.state); }
console.log('is the standard associated account:', accts.value.some(a => a.pubkey.equals(getAssociatedTokenAddressSync(new PublicKey(MINT), who))));
const umi = createUmi('https://api.devnet.solana.com');
try { const m = await fetchMetadataFromSeeds(umi, { mint: publicKey(MINT) }); console.log('metadata on-chain:', JSON.stringify({ name: m.name, symbol: m.symbol, uri: m.uri })); }
catch (e) { console.log('metadata on-chain: MISSING -', String(e.message).slice(0, 80)); }
const main = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
try { const sigs = await main.getSignaturesForAddress(who, { limit: 3 }); console.log('same address on the real network: balance', (await main.getBalance(who)) / LAMPORTS_PER_SOL, 'SOL,', sigs.length, 'recent transactions'); } catch (e) { console.log('real network lookup failed:', String(e.message).slice(0, 60)); }
