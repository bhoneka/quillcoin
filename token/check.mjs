import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
const conn = new Connection(clusterApiUrl('devnet'), 'confirmed'), mint = new PublicKey('BCHXyYfPhpPjfQGfVQ2qt44EHkwb9utmAmrtMpRRktyH');
const who = new PublicKey(process.argv[2]);
const accts = await conn.getParsedTokenAccountsByOwner(who, { mint });
console.log('test wallet QLL balance:', accts.value.length ? accts.value.map(a => a.account.data.parsed.info.tokenAmount.uiAmountString).join(', ') : 'no QLL token account yet');
const m = await getMint(conn, mint); console.log('total QLL supply on the test network:', Number(m.supply) / 1e6);
