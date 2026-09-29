// QuillCoin - the ledger page. Everything here can be checked without trusting this site: the hashing runs in the browser, the transfers are read from Solana.
const API = 'https://ovjeipprgkeygnlkraiu.supabase.co/functions/v1/api';
const $ = s => document.querySelector(s);
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (a, n = 4) => a.length > n * 2 + 1 ? a.slice(0, n) + '…' + a.slice(-n) : a;
const q3 = n => (Math.round(Number(n) * 1000) / 1000).toFixed(3).replace(/0{1,2}$/, '');           // 1.0, 0.1, 0.125
const when = s => String(s).replace('T', ' ').slice(0, 19);
const RPC = { devnet: 'https://api.devnet.solana.com', testnet: 'https://api.testnet.solana.com', mainnet: 'https://solana-rpc.publicnode.com' };   // a public endpoint that answers browsers; this site is not in between
const cluster = n => n === 'mainnet' ? '' : '?cluster=' + encodeURIComponent(n);
const SHOWN = 200;

let info = null, chain = [], shown = SHOWN, marks = new Map(), anchors = new Map();

// exactly the text that is hashed for a line
const canon = r => [r.prev ?? '', r.id, r.at, r.delta, r.reason, r.coin_round ?? '', r.coin_number ?? '', r.who].join('|');
async function sha256(text){
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
}
const WHAT = {
  'find': r => `<a href="./#coin=${r.coin_round}-${r.coin_number}">ROUND ${r.coin_round} · COIN ${r.coin_number}</a> FOUND BY ${esc((r.name || 'anonymous').toUpperCase())}`,
  'founder-fee': r => `THE FOUNDER'S TENTH FOR <a href="./#coin=${r.coin_round}-${r.coin_number}">ROUND ${r.coin_round} · COIN ${r.coin_number}</a>`,
  'claim': () => 'A FINDER MOVED COINS TO A WALLET',
  'founder-claim': () => "THE FOUNDER'S TENTH MOVED TO THE FOUNDER WALLET",
  'claim-reversed': () => 'A TRANSFER DID NOT GO THROUGH · COINS PUT BACK',
  'founder-claim-reversed': () => "A TRANSFER DID NOT GO THROUGH · FOUNDER'S TENTH PUT BACK",
};
const what = r => (WHAT[r.reason] ? WHAT[r.reason](r) : esc(r.reason.toUpperCase()));

function renderRows(){
  const rows = [...chain].reverse().slice(0, shown);
  $('#rows').innerHTML = '<div class="lrow hd"><span>#</span><span class="tm">TIME · UTC</span><span>WHAT HAPPENED</span><span class="amt">QLL</span><span class="hx">FINGERPRINT</span><span></span></div>' +
    (rows.map(r => {
      const m = marks.get(r.id), a = anchors.get(r.hash);
      return `<div class="lrow" title="${esc(canon(r))}"><span>${r.id}</span><span class="tm">${when(r.at)}</span><span class="what">${what(r)}<span class="tm2">${when(r.at)} UTC · <span class="addr">${short(r.hash, 6)}</span></span>${a ? ` <a class="anch" href="${a}" target="_blank" rel="noopener" title="this fingerprint is written into a Solana transaction">⚓</a>` : ''}</span>` +
        `<span class="amt ${Number(r.delta) > 0 ? 'plus' : 'minus'}">${Number(r.delta) > 0 ? '+' : ''}${q3(r.delta)}</span><span class="hx">${short(r.hash, 8)}</span><span class="${m === true ? 'ok' : m === false ? 'no' : ''}">${m === true ? '✓' : m === false ? '✕' : ''}</span></div>`;
    }).join('') || '<div class="lrow"><span></span><span>NOTHING HAS BEEN FOUND YET</span></div>');
  $('#btn-more').hidden = chain.length <= shown;
}
function renderTransfers(){
  const t = info.transfers || [];
  $('#sent').innerHTML = '<div class="lrow hd t"><span class="tm">TIME · UTC</span><span>TO</span><span class="amt">FINDER</span><span class="amt">FOUNDER</span><span class="hx">FINGERPRINT WRITTEN INTO IT</span><span></span></div>' +
    (t.map((c, i) => `<div class="lrow t" data-t="${i}"><span class="tm">${when(c.at)}</span><span class="what"><a href="https://explorer.solana.com/tx/${esc(c.tx)}${cluster(c.network)}" target="_blank" rel="noopener">${c.wallet === 'founder wallet' ? 'THE FOUNDER WALLET' : '<span class="addr">' + esc(short(c.wallet)) + '</span>'} ↗</a><span class="tm2">${when(c.at)} UTC${c.ledger_head ? ' · ⚓ <span class="addr">' + short(c.ledger_head, 6) + '</span>' : ''}</span></span>` +
      `<span class="amt plus">${q3(c.to_finder)}</span><span class="amt plus">${q3(c.to_founder)}</span><span class="hx">${c.ledger_head ? short(c.ledger_head, 8) : 'none · made before anchors existed'}</span><span class="st"></span></div>`).join('')
      || '<div class="lrow"><span></span><span>NO COINS HAVE BEEN MOVED TO A WALLET YET</span></div>');
  if ((info.transfers_total || 0) > t.length) $('#sent').insertAdjacentHTML('beforeend', `<div class="lrow"><span></span><span>THE NEWEST ${t.length} OF ${info.transfers_total}</span></div>`);
}
function say(id, text, cls){ const el = $(id); el.innerHTML = text; el.className = 'verdict ' + (cls || ''); }

async function load(){
  try {
    info = await (await fetch(API + '/ledger', { cache: 'no-store' })).json(); if (!info.ok) throw new Error(info.message);
    chain = info.chain; let page = info;
    while (page.more) { page = await (await fetch(API + '/ledger?after=' + chain[chain.length - 1].id, { cache: 'no-store' })).json(); if (!page.ok) throw new Error(page.message); chain = chain.concat(page.chain); }
  } catch (e) { $('#rows').innerHTML = '<div class="lrow"><span></span><span>THE LEDGER COULD NOT BE REACHED. TRY AGAIN IN A MINUTE.</span></div>'; $('#sent').innerHTML = ''; $('#t-note').textContent = ''; $('#c-head').textContent = ''; return; }
  $('#t-minted').textContent = q3(info.minted); $('#t-finders').textContent = q3(info.minted - info.founder); $('#t-founder').textContent = q3(info.founder);
  $('#t-wallets').textContent = q3(info.in_wallets); $('#t-site').textContent = q3(info.on_site);
  $('#t-note').textContent = (info.network === 'mainnet' ? '' : 'TEST NETWORK: THESE COINS ARE WORTH NOTHING. ') + (info.claims === 'soon' ? 'THE TOKEN DOES NOT EXIST YET: EVERY COIN IS STILL ON THE SITE. ' : '') + 'CREATED = MOVED TO WALLETS + STILL WAITING ON THE SITE' + (Number(info.in_flight) ? ' + ' + q3(info.in_flight) + ' ON THEIR WAY TO A WALLET RIGHT NOW.' : '.');
  $('#c-head').innerHTML = chain.length ? `${chain.length} LINES · NEWEST FINGERPRINT <span class="mono inl">${info.head}</span>` : 'NO LINES YET';
  $('#lnk-json').href = API + '/ledger';
  const n = info.network || 'devnet';
  if (info.founder_wallet) { const a = $('#lnk-founder'); a.href = 'https://explorer.solana.com/address/' + encodeURIComponent(info.founder_wallet) + '/tokens' + cluster(n); a.hidden = false; }
  if (info.mint) { const a = $('#lnk-token'); a.href = 'https://explorer.solana.com/address/' + encodeURIComponent(info.mint) + cluster(n); a.hidden = false; }
  (info.transfers || []).forEach(c => { if (c.ledger_head) anchors.set(c.ledger_head, 'https://explorer.solana.com/tx/' + c.tx + cluster(c.network)); });
  renderRows(); renderTransfers();
  if (chain.length) { const last = chain[chain.length - 1]; $('#ex-canon').textContent = canon(last); $('#ex-hash').textContent = '→ ' + last.hash; }
  remembered();
}

// 1 · every fingerprint again, in this browser
async function verify(){
  if (!chain.length) { say('#v-chain', 'THERE IS NOTHING TO CHECK YET.'); return true; }
  if (!(window.crypto && crypto.subtle)) { say('#v-chain', 'THIS BROWSER CANNOT HASH HERE. OPEN THE PAGE OVER HTTPS.', 'no'); return false; }
  say('#v-chain', 'CHECKING…'); marks.clear();
  let bad = [], prev = null, minted = 0, founder = 0, total = 0;
  for (const r of chain) {
    const good = (r.prev ?? null) === prev && await sha256(canon(r)) === r.hash;
    marks.set(r.id, good); if (!good) bad.push(r.id);
    prev = r.hash;
    const d = Math.round(Number(r.delta) * 1000);
    if (r.reason === 'find' || r.reason === 'founder-fee') minted += d; if (r.reason === 'founder-fee') founder += d; total += d;
  }
  renderRows();
  const k = n => Math.round(Number(n) * 1000);
  const totals = minted === k(info.minted) && founder === k(info.founder) && total === k(info.on_site) && k(info.minted) === k(info.in_wallets) + k(info.in_flight || 0) + k(info.on_site);
  const headOk = prev === info.head;
  // every find must come with exactly its tenth
  const finds = chain.filter(r => r.reason === 'find'), fees = new Map(chain.filter(r => r.reason === 'founder-fee').map(r => [r.coin_round + '/' + r.coin_number, r]));
  const lonely = finds.filter(r => { const f = fees.get(r.coin_round + '/' + r.coin_number); return !f || Math.round(Number(f.delta) * 1000) * 10 !== Math.round(Number(r.delta) * 1000); });
  if (bad.length) say('#v-chain', `${bad.length} ${bad.length === 1 ? 'LINE DOES' : 'LINES DO'} NOT MATCH: #${bad.slice(0, 8).join(', #')}. THE LEDGER HAS BEEN TAMPERED WITH, OR IT ARRIVED DAMAGED.`, 'no');
  else if (!headOk || !totals) say('#v-chain', `ALL ${chain.length} LINES LINK UP, BUT ${!headOk ? 'THE NEWEST FINGERPRINT' : 'THE COUNT ABOVE'} DOES NOT MATCH WHAT THE LINES SAY.`, 'no');
  else say('#v-chain', `ALL ${chain.length} LINES CHECK OUT. EVERY ONE POINTS AT THE ONE BEFORE IT, EVERY FINGERPRINT IS RIGHT, AND THE COUNT ABOVE IS EXACTLY WHAT THE LINES ADD UP TO.` +
    (lonely.length ? ` <span class="no">BUT ${lonely.length} ${lonely.length === 1 ? 'FIND HAS' : 'FINDS HAVE'} NO MATCHING TENTH.</span>` : ` ${finds.length} ${finds.length === 1 ? 'FIND' : 'FINDS'}, EACH WITH EXACTLY ITS TENTH.`), lonely.length ? '' : 'ok');
  return !bad.length && headOk && totals;
}

// 2 · the transfers, read from the network itself
async function rpc(network, method, params){
  for (let attempt = 0; ; attempt++) {                                           // the public endpoint asks for patience now and then (429): wait and ask again
    const r = await fetch(RPC[network] || RPC.devnet, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = r.status === 429 ? null : await r.json().catch(() => null);
    if (j && !j.error) return j.result;
    const busy = r.status === 429 || (j && j.error && j.error.code === 429);
    if (!busy || attempt >= 5) throw new Error(j && j.error ? j.error.message : 'solana answered ' + r.status);
    await new Promise(w => setTimeout(w, 1500 * (attempt + 1)));
  }
}
async function readTransfer(network, sig){
  const tx = await rpc(network, 'getTransaction', [sig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
  if (!tx) return null;
  const ins = tx.transaction.message.instructions.concat(...((tx.meta && tx.meta.innerInstructions) || []).map(i => i.instructions));
  const mints = ins.filter(i => i.program === 'spl-token' && i.parsed && /^mintTo/.test(i.parsed.type)).map(i => ({ mint: i.parsed.info.mint, units: Number(i.parsed.info.amount ?? (i.parsed.info.tokenAmount && i.parsed.info.tokenAmount.amount) ?? 0) }));
  const memo = ins.filter(i => i.program === 'spl-memo' && typeof i.parsed === 'string').map(i => i.parsed).find(m => m.startsWith('quillcoin-ledger:'));
  return { failed: !!(tx.meta && tx.meta.err), mints, anchor: memo ? memo.slice('quillcoin-ledger:'.length) : null };
}
// every creation of coins the network knows about that is NOT one of the ledger's transfers, found by reading the token's own history
async function outside(n){
  const claimed = new Set((info.transfers || []).map(c => c.tx)), found = [];
  const sigs = await rpc(n, 'getSignaturesForAddress', [info.mint, { limit: 1000 }]);
  for (const s of sigs.filter(s => !s.err && !claimed.has(s.signature)).slice(0, 60)) {
    const x = await readTransfer(n, s.signature);
    const units = x ? x.mints.filter(m => m.mint === info.mint).reduce((t, m) => t + m.units, 0) : 0;
    if (units > 0) found.push({ tx: s.signature, amount: units / 1e6, at: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : '' });
    await new Promise(r => setTimeout(r, 350));
  }
  return found;
}
async function solana(){
  const t = info.transfers || [], n = info.network || 'devnet';
  if (!info.mint) { say('#v-solana', 'THE QLL TOKEN DOES NOT EXIST YET, SO NO COIN HAS LEFT THIS SITE. ITS ADDRESS WILL BE PUBLISHED HERE BEFORE THE FIRST TRANSFER.'); return; }
  say('#v-solana', 'ASKING SOLANA…');
  const hashes = new Set(chain.map(r => r.hash));
  let ok = 0, wrong = [], unread = 0, anchored = 0, rewritten = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i], cell = document.querySelector(`[data-t="${i}"] .st`);
    try {
      const x = await readTransfer(c.network || n, c.tx);
      const want = Math.round((c.to_finder + c.to_founder) * 1e6), got = x ? x.mints.filter(m => m.mint === info.mint).reduce((s, m) => s + m.units, 0) : -1;
      const amounts = x && !x.failed && got === want, note = !x || (x.anchor || null) === (c.ledger_head || null), known = !x || !x.anchor || hashes.has(x.anchor);
      if (x && x.anchor) { anchored++; anchors.set(x.anchor, 'https://explorer.solana.com/tx/' + c.tx + cluster(c.network)); if (!known) rewritten++; }
      const good = amounts && note && known;
      if (good) ok++; else wrong.push(c.tx);
      if (cell) { cell.textContent = good ? '✓' : '✕'; cell.className = 'st ' + (good ? 'ok' : 'no'); cell.title = !x ? 'solana does not know this transaction' : !amounts ? 'solana shows ' + got / 1e6 + ' QLL created here, the ledger says ' + want / 1e6 : !note ? 'the fingerprint on solana is not the one listed here' : !known ? 'the fingerprint on solana is not in the ledger any more' : 'amounts and fingerprint match solana'; }
    } catch (e) { unread++; if (cell) { cell.textContent = '?'; cell.className = 'st'; cell.title = 'could not be read: ' + e.message; } }
    if (i % 8 === 7) await new Promise(r => setTimeout(r, 1100));                // the public endpoint only takes so many questions at a time
  }
  let supply = null; try { supply = Number((await rpc(n, 'getTokenSupply', [info.mint])).value.amount) / 1e6; } catch (e) {}
  renderRows();
  const listed = (info.transfers_total || t.length) === t.length;
  const parts = [];
  if (t.length) parts.push(`${ok} OF ${t.length} TRANSFERS MATCH SOLANA TO THE LAST DIGIT` + (unread ? ` · ${unread} COULD NOT BE READ, TRY AGAIN IN A MINUTE` : ''));
  else parts.push('NO TRANSFERS YET');
  if (anchored) parts.push(rewritten ? `<span class="no">${rewritten} FINGERPRINT${rewritten === 1 ? '' : 'S'} WRITTEN ON SOLANA ${rewritten === 1 ? 'IS' : 'ARE'} MISSING FROM THE LEDGER: IT WAS REWRITTEN</span>` : `${anchored} FINGERPRINT${anchored === 1 ? '' : 'S'} WRITTEN ON SOLANA, ALL STILL IN THE LEDGER (MARKED ⚓)`);
  else if (t.length) parts.push('NO TRANSFER CARRIES A FINGERPRINT YET: THEY WERE ALL MADE BEFORE ANCHORS EXISTED');
  if (supply !== null) {
    const diff = Math.round((supply - info.in_wallets) * 1000) / 1000;
    if (diff === 0) parts.push(`SOLANA SAYS ${q3(supply)} QLL EXIST. THE LEDGER SENT ${q3(info.in_wallets)}. THE SAME`);
    else {
      say('#v-solana', 'THE NUMBERS DIFFER. READING THE TOKEN\'S WHOLE HISTORY TO FIND OUT WHY…');
      let strays = null; try { strays = await outside(n); } catch (e) {}
      const list = strays && strays.length ? ' CREATED OUTSIDE THE LEDGER: ' + strays.map(x => `${q3(x.amount)} QLL ON ${when(x.at)} UTC (<a href="https://explorer.solana.com/tx/${x.tx}${cluster(n)}" target="_blank" rel="noopener">SEE IT ↗</a>)`).join(', ') + '.' : strays ? ' NO CREATION OUTSIDE THE LEDGER WAS FOUND, SO COINS WERE DESTROYED BY THEIR HOLDERS OR A TRANSFER IS ON ITS WAY.' : ' THE TOKEN\'S HISTORY COULD NOT BE READ RIGHT NOW.';
      parts.push(`<span class="${n === 'mainnet' ? 'no' : 'warnc'}">SOLANA SAYS ${q3(supply)} QLL EXIST. THE LEDGER SENT ${q3(info.in_wallets)}. DIFFERENCE: ${q3(Math.abs(diff))}.${list}${n === 'mainnet' ? '' : ' THIS IS THE TEST TOKEN: IT WAS TRIED OUT BY HAND WHILE IT WAS BEING BUILT. THE REAL TOKEN STARTS AT ZERO'}</span>`);
    }
  } else parts.push('THE NUMBER OF COINS THAT EXIST COULD NOT BE READ');
  const clean = !wrong.length && !rewritten && !unread && supply !== null && (Math.abs(supply - info.in_wallets) < 0.0005 || n !== 'mainnet');
  say('#v-solana', parts.join('. ') + '.' + (listed ? '' : ` (THE NEWEST ${t.length} OF ${info.transfers_total} TRANSFERS.)`), wrong.length || rewritten ? 'no' : clean ? 'ok' : '');
}

// 3 · this browser as a witness
const KEY = 'qll-ledger-seen';
function remembered(){
  let seen = null; try { seen = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (!seen || !seen.hash) return;
  const row = chain.find(r => r.id === seen.id);
  if (row && row.hash === seen.hash) say('#v-seen', `ON ${esc(when(seen.on))} UTC THIS BROWSER REMEMBERED LINE #${seen.id}. IT IS STILL HERE, UNCHANGED, AND ${chain.length - 1 - chain.indexOf(row)} ${chain.length - 1 - chain.indexOf(row) === 1 ? 'LINE HAS' : 'LINES HAVE'} BEEN ADDED SINCE. PRESS CHECK EVERY LINE TO BE SURE NOTHING BEFORE IT CHANGED EITHER.`, 'ok');
  else say('#v-seen', `ON ${esc(when(seen.on))} UTC THIS BROWSER REMEMBERED LINE #${seen.id} AS <span class="addr">${esc(short(seen.hash, 8))}</span>. THAT LINE IS ${row ? 'DIFFERENT NOW' : 'GONE'}. THE LEDGER WAS REWRITTEN.`, 'no');
}
$('#btn-remember').onclick = () => {
  if (!chain.length) { say('#v-seen', 'THERE IS NOTHING TO REMEMBER YET.'); return; }
  const last = chain[chain.length - 1];
  try { localStorage.setItem(KEY, JSON.stringify({ id: last.id, hash: last.hash, on: new Date().toISOString() })); say('#v-seen', `REMEMBERED: LINE #${last.id}, <span class="addr">${esc(short(last.hash, 8))}</span>. COME BACK ANY TIME, THIS BROWSER WILL CHECK IT IS STILL THERE.`, 'ok'); }
  catch (e) { say('#v-seen', 'THIS BROWSER WILL NOT KEEP ANYTHING (PRIVATE WINDOW?). WRITE THE NEWEST FINGERPRINT DOWN INSTEAD.', 'no'); }
};
const busy = (b, f) => async () => { b.disabled = true; try { await f(); } finally { b.disabled = false; } };
$('#btn-verify').onclick = busy($('#btn-verify'), verify);
$('#btn-solana').onclick = busy($('#btn-solana'), solana);
$('#btn-more').onclick = () => { shown += 500; renderRows(); };
load();
