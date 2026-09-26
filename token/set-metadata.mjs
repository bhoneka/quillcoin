// Gives the test-network QLL mint its name, ticker and logo (Metaplex token metadata).
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createMetadataAccountV3 } from '@metaplex-foundation/mpl-token-metadata';
import { keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import fs from 'fs'; import os from 'os'; import path from 'path';
const dir = path.join(os.homedir(), '.config/quillcoin');
const info = JSON.parse(fs.readFileSync(path.join(dir, 'devnet.json'), 'utf8'));
const umi = createUmi('https://api.devnet.solana.com');
const kp = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(dir, 'devnet-authority.json'), 'utf8'))));
umi.use(keypairIdentity(kp));
const r = await createMetadataAccountV3(umi, {
  mint: publicKey(info.mint), mintAuthority: umi.identity, payer: umi.identity, updateAuthority: kp.publicKey,
  data: { name: 'QuillCoin', symbol: 'QLL', uri: 'https://quillcoin.gg/token/qll.json', sellerFeeBasisPoints: 0, creators: null, collection: null, uses: null },
  isMutable: true, collectionDetails: null,
}).sendAndConfirm(umi);
console.log('metadata set: QuillCoin / QLL');
