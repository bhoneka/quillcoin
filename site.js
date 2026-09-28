// QuillCoin - quillcoin.gg
const SB_URL = 'https://ovjeipprgkeygnlkraiu.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92amVpcHByZ2tleWdubGtyYWl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzMDk5NjksImV4cCI6MjEwNTg4NTk2OX0.5q95unvkFe2c1GBP91ztz44ejBX_2AnxQjYk0mxtcPQ';   // public key: it can only read what the public board already shows
const API = SB_URL + '/functions/v1/api';
const Q = new URLSearchParams(location.search);
const FLOW = Q.get('flow') === 'old' ? 'old' : 'new';     // ?flow=old keeps the first redeem flow around for comparing
const $ = s => document.querySelector(s);
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sb = window.supabase ? window.supabase.createClient(SB_URL, SB_ANON) : null;
const day = iso => new Date(iso).toISOString().slice(0, 10);
const stamp = iso => new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
const since = iso => { if (!iso) return '–'; const d = (Date.now() - Date.parse(iso)) / 1000; return d < 3600 ? Math.floor(d / 60) + 'M' : d < 86400 ? Math.floor(d / 3600) + 'H' : Math.floor(d / 86400) + 'D'; };
const validIgn = v => /^[A-Za-z0-9_]{3,16}$/.test(v);
const head = ign => validIgn(ign || '') ? `<img class="head" src="https://mc-heads.net/avatar/${encodeURIComponent(ign)}/16" alt="">` : '';
const finder = c => esc((c.found_ign || c.found_name || 'ANONYMOUS').toUpperCase());
const embedUrl = u => { const m = String(u).match(/(?:youtu\.be\/|[?&]v=|\/embed\/)([\w-]{6,})/); return m ? 'https://www.youtube.com/embed/' + m[1] : null; };
const roundName = id => 'ROUND ' + id;
const short = a => a.slice(0, 4) + '…' + a.slice(-4);

// ------------------------------------------------------------------ rounds and their books
let rounds = [], view = 'cards', openSet = new Set(), token = { mint: null, network: 'devnet', founder: null }, myBal = 0;
try { view = localStorage.getItem('qll-view') === 'list' ? 'list' : 'cards'; } catch (e) {}
const allCoins = () => rounds.flatMap(r => r.coins);
const coinOf = (r, n) => allCoins().find(c => c.round === r && c.number === n);
const placed = c => !!c.found_at && Number.isInteger(c.found_x) && Number.isInteger(c.found_z);
const foundOnes = () => allCoins().filter(placed);

function roundStatus(r){
  const now = Date.now(), opened = r.opened_at && Date.parse(r.opened_at) <= now, closed = r.closed_at && Date.parse(r.closed_at) <= now;
  if (r.id === 0) return 'THE TEST ROUND · ITS COINS ARE WORTH NOTHING · IT IS HERE SO THE WHOLE MACHINE CAN BE TRIED IN PUBLIC';
  if (closed) return 'CLOSED ' + day(r.closed_at);
  return opened ? 'OPEN SINCE ' + day(r.opened_at) + ' · ALL HASHES COMMITTED BEFORE THAT DAY' : 'NOT OPEN YET · HASHES BEING COMMITTED';
}
const vidLink = c => c.video_url ? `<a href="${esc(c.video_url)}" data-hide="${c.round}-${c.number}" title="recording sha256 ${c.video_hash || ''}">WATCH THE HIDE ↗</a>` : '';
function cardHTML(c, i){
  const f = !!c.found_at, v = vidLink(c);
  const st = f ? head(c.found_ign) + 'FOUND · ' + finder(c) + ' · ' + day(c.found_at) : 'STILL OUT · SINCE ' + day(c.hidden_at);
  return `<div class="card ${f ? 'found' : 'out'}" style="--i:${i}" data-r="${c.round}" data-n="${c.number}" title="sha256 ${c.hash}"><img class="book" src="${f ? 'book-gold.svg' : 'book-grey.svg'}" alt=""><b>COIN ${c.number}</b><span>${st}${v ? `<span class="vid">${v}</span>` : ''}</span><i>${c.hash.slice(0, 16)}…</i></div>`;
}
function rowHTML(c, i){
  const f = !!c.found_at, v = vidLink(c);
  const st = (f ? head(c.found_ign) + 'FOUND · ' + finder(c) + ' · ' + day(c.found_at) : 'STILL OUT THERE') + (v ? ' · ' + v.replace('<a ', '<a class="watch" ') : '');
  return `<li class="${f ? 'found' : 'out'}" style="--i:${i}" data-r="${c.round}" data-n="${c.number}"><span class="n">#${String(i + 1).padStart(3, '0')}</span><img class="lbook" src="${f ? 'book-gold.svg' : 'book-grey.svg'}" alt=""><span class="name">COIN ${c.number}<div class="h">${c.hash}</div></span><span class="s">${st}</span></li>`;
}
function renderRounds(){
  $('#v-cards').classList.toggle('on', view === 'cards'); $('#v-list').classList.toggle('on', view === 'list');
  $('#rounds').innerHTML = [...rounds].sort((a, b) => a.id - b.id).map(r => {
    const found = r.coins.filter(c => c.found_at), last = found.length ? since(found.map(c => c.found_at).sort().pop()) : '–';
    const body = !r.coins.length ? '<div class="card empty">NOTHING HIDDEN YET</div>'
      : view === 'list' ? `<ol class="list">${r.coins.map(rowHTML).join('')}</ol>` : `<div class="grid">${r.coins.map(cardHTML).join('')}</div>`;
    return `<div class="round${openSet.has(r.id) ? ' open' : ''}" data-round="${r.id}">
      <button class="round-bar" data-toggle="${r.id}" aria-expanded="${openSet.has(r.id)}"><span class="chev">▶</span><span class="t">${roundName(r.id)}</span><span class="m">${r.id === 0 ? 'TEST · ' : ''}${r.coins.length} HIDDEN · ${found.length} FOUND</span></button>
      <div class="round-body"><div><div class="round-in">
        <p class="rstat">${roundStatus(r)}</p>
        <p class="rstat">ITS BOOKS ARE BETWEEN ${blocks(ringOf(r.id).min)} AND ${blocks(ringOf(r.id).max)} BLOCKS FROM SPAWN, IN ANY DIRECTION.</p>
        <div class="stats"><div class="stat"><b>${r.coins.length}</b><span>HIDDEN</span></div><div class="stat"><b>${found.length}</b><span>FOUND</span></div><div class="stat"><b>${last}</b><span>SINCE LAST FIND</span></div></div>
        ${body}
        <p class="rlinks"><a href="${API}/board?round=${r.id}" target="_blank" rel="noopener">THIS ROUND'S HASH LIST (JSON) ↗</a></p>
      </div></div></div></div>`;
  }).join('') || '<div class="card empty">NOTHING HERE YET</div>';
  $('#map-count').textContent = foundOnes().length + ' ON THE MAP · ' + allCoins().filter(c => !c.found_at).length + ' STILL OUT';
}
let linked = false;
async function loadBoard(){
  try {
    const j = await (await fetch(API + '/board', { cache: 'no-store' })).json(); if (!j.ok) throw new Error(j.message);
    rounds = j.rounds.map(r => ({ ...r, coins: r.coins.map(c => ({ ...c, round: r.id })) }));
    if (!openSet.size) {
      const want = Q.get('round'), withBooks = rounds.filter(r => r.coins.length).map(r => r.id);
      openSet.add(want !== null && rounds.some(r => r.id === +want) ? +want : withBooks.length ? Math.max(...withBooks) : rounds.length ? Math.max(...rounds.map(r => r.id)) : 0);
    }
    renderRounds(); renderMap();
    // the guide quotes the ring of the newest real round
    const real = rounds.filter(r => r.id >= 1).sort((a, b) => b.id - a.id)[0];
    if (real) { $('#g-ring-min').textContent = blocks(ringOf(real.id).min); $('#g-ring-max').textContent = blocks(ringOf(real.id).max); }
    if (!linked) { linked = true; const m = location.hash.match(/^#coin=(?:(\d+)-)?(\d+)$/); if (m) { const n = +m[2], c = m[1] !== undefined ? coinOf(+m[1], n) : allCoins().filter(x => x.number === n).pop(); if (c) openCoin(c.round, c.number); } }
  } catch (e) { $('#rounds').innerHTML = '<div class="card empty">BOARD UNAVAILABLE</div>'; }
}
document.addEventListener('click', e => {
  const bar = e.target.closest('[data-toggle]');
  if (bar) { const id = +bar.dataset.toggle, el = bar.parentElement, on = !el.classList.contains('open'); el.classList.toggle('open', on); bar.setAttribute('aria-expanded', on); on ? openSet.add(id) : openSet.delete(id); return; }
  const hide = e.target.closest('a[data-hide]');
  if (hide) { e.preventDefault(); const [r, n] = hide.dataset.hide.split('-').map(Number); openHide(r, n); return; }
  if (e.target.closest('a')) return;
  const own = e.target.closest('[data-own]');
  if (own) { $('#account').hidden = true; openCoin(+own.dataset.round, +own.dataset.own); return; }
  const c = e.target.closest('[data-n][data-r]');
  if (c && c.closest('#rounds')) openCoin(+c.dataset.r, +c.dataset.n);
});
$('#v-cards').onclick = () => { view = 'cards'; try { localStorage.setItem('qll-view', view); } catch (e) {} renderRounds(); };
$('#v-list').onclick = () => { view = 'list'; try { localStorage.setItem('qll-view', view); } catch (e) {} renderRounds(); };

// ------------------------------------------------------------------ the recording of a hide
function openHide(r, n){
  const c = coinOf(r, n); if (!c || !c.video_url) return;
  const e = embedUrl(c.video_url); if (!e) { window.open(c.video_url, '_blank', 'noopener'); return; }
  $('#proof').hidden = false; $('#proof-title').textContent = 'PROOF · ' + roundName(r) + ' · COIN ' + c.number;
  $('#proof-video').innerHTML = `<iframe src="${e}?autoplay=1" allow="autoplay; fullscreen" loading="lazy"></iframe>`;
  $('#proof-meta').innerHTML = 'HIDDEN ' + day(c.hidden_at) + (c.video_hash ? ' · RECORDING SHA256 <span style="text-transform:none">' + c.video_hash.slice(0, 16) + '…</span>' : '') + ` · <a href="${esc(c.video_url)}" target="_blank" rel="noopener" style="text-decoration:underline">OPEN ON YOUTUBE ↗</a>`;
  $('#proof').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ------------------------------------------------------------------ the map: Leaflet over 2b2t.place's tiles (their 1M² world download is CC0)
// 512 px tiles, level L = 2^L blocks per pixel. Leaflet zoom = 10 - level, one latlng unit = 1024 blocks, block (0,0) = latlng (0,0).
const UNIT = 1024, NATIVE = 10;
const toLatLng = (x, z) => L.latLng(-z / UNIT, x / UNIT);
const toBlock = ll => ({ x: Math.round(ll.lng * UNIT), z: Math.round(-ll.lat * UNIT) });
const CLEAR = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const placeLayer = (kind, opts) => new (L.TileLayer.extend({ getTileUrl: c => `https://2b2t.place/tiles/${kind}/${NATIVE - c.z}/0/${Math.trunc(c.x / 32)}/${Math.trunc(c.y / 32)}/t.${c.x}.${c.y}.webp` }))('', opts);
const tileOpts = () => ({ minZoom: -1, maxZoom: 12, maxNativeZoom: NATIVE, tileSize: 512, noWrap: true, keepBuffer: 3, errorTileUrl: CLEAR, bounds: L.latLngBounds(toLatLng(-524288, -524288), toLatLng(524288, 524288)) });
const bookIcon = L.icon({ iconUrl: 'book-gold.svg', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14], className: 'book-marker' });
const ghostIcon = L.icon({ iconUrl: 'book-grey.svg', iconSize: [24, 24], iconAnchor: [12, 12], className: 'ghost-marker' });
const ringOf = round => { const r = rounds.find(x => x.id === round) || {}; return { min: Number.isFinite(r.ring_min) ? r.ring_min : 15000, max: Number.isFinite(r.ring_max) ? r.ring_max : 100000 }; };
const blocks = n => Number(n).toLocaleString('en-US');
const ringSpot = round => { const { min, max } = ringOf(round), a = Math.random() * Math.PI * 2, r = Math.sqrt(min * min + Math.random() * (max * max - min * min)); return toLatLng(Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)); };
const tip = { direction: 'top', offset: [0, -12], className: 'ghost-tip' };
let map = null, markers = [], ghosts = [], ghostTimer = null, mapTimers = [];
function ensureMap(){
  if (map) return map;
  map = L.map('leaf', { crs: L.CRS.Simple, minZoom: -1, maxZoom: 12, zoomControl: false, attributionControl: false, zoomSnap: 0, wheelPxPerZoomLevel: 90,
    maxBounds: L.latLngBounds(toLatLng(-600000, -600000), toLatLng(600000, 600000)), maxBoundsViscosity: 1 });
  placeLayer('base', tileOpts()).addTo(map); placeLayer('overlay', tileOpts()).addTo(map);
  L.circleMarker(toLatLng(0, 0), { radius: 5, color: '#ffd400', fillColor: '#ffd400', fillOpacity: 1, weight: 0 }).addTo(map).bindPopup('SPAWN<br>0, 0');
  map.on('mousemove', e => showCoords(toBlock(e.latlng)));
  map.on('move', () => { if (matchMedia('(hover: none)').matches) showCoords(toBlock(map.getCenter())); });
  map.setView(toLatLng(0, 0), 3);
  return map;
}
function showCoords(b){ $('#c-ow').innerHTML = 'OVERWORLD <b>' + b.x + ' ' + b.z + '</b>'; $('#c-ne').innerHTML = 'NETHER <b>' + Math.round(b.x / 8) + ' ' + Math.round(b.z / 8) + '</b>'; }
function renderMap(){
  if (!map) return;
  markers.forEach(m => m.remove()); markers = [];
  foundOnes().forEach(c => markers.push(L.marker(toLatLng(c.found_x, c.found_z), { icon: bookIcon }).addTo(map)
    .bindTooltip(`${roundName(c.round)} · COIN ${c.number} · ${finder(c)}<br>${c.found_x}, ${c.found_z}`, tip).on('click', () => openCoin(c.round, c.number))));
  if (document.body.classList.contains('mapmode')) startGhosts();
}
// every still-hidden book is a grey ghost that teleports around the ring it could be in - nobody knows where they really are
function startGhosts(){
  stopGhosts();
  const hidden = allCoins().filter(c => !c.found_at);
  ghosts = hidden.map(c => Object.assign(L.marker(ringSpot(c.round), { icon: ghostIcon, keyboard: false }).addTo(map)
    .bindTooltip(`${roundName(c.round)} · COIN ${c.number} · STILL OUT · HIDDEN ${day(c.hidden_at)}<br><span class="dim">NOT ITS REAL SPOT. NOBODY KNOWS THAT.</span>`, { ...tip, offset: [0, -10] })
    .on('click', () => openCoin(c.round, c.number)), { qRound: c.round }));
  if (!ghosts.length) return;
  ghostTimer = setInterval(() => {
    const g = ghosts[Math.floor(Math.random() * ghosts.length)], el = g.getElement(); if (!el) return;
    el.style.opacity = '0'; setTimeout(() => { g.setLatLng(ringSpot(g.qRound)); el.style.opacity = ''; }, 600);
  }, Math.max(900, 7000 / ghosts.length));
}
function stopGhosts(){ if (ghostTimer) clearInterval(ghostTimer); ghostTimer = null; ghosts.forEach(g => g.remove()); ghosts = []; }
// the view the page background is showing right now: the square world image, cover-fitted to a box 12% larger than the viewport, plus the drift
function backgroundView(){
  let a = 1, tx = 0, ty = 0;
  const m = (getComputedStyle(document.body, '::before').transform || '').match(/matrix\(([^)]+)\)/);
  if (m) { const v = m[1].split(',').map(Number); a = v[0] || 1; tx = v[4] || 0; ty = v[5] || 0; }
  const bpp = 1048576 / (Math.max(innerWidth, innerHeight) * 1.12 * a), leafTop = $('#leaf').getBoundingClientRect().top;
  return { zoom: Math.log2(1024 / bpp), center: toLatLng(Math.round(-tx * bpp), Math.round((-ty + leafTop / 2) * bpp)) };
}
function setMapMode(on){
  const b = document.body, fm = $('#fullmap');
  mapTimers.forEach(clearTimeout); mapTimers = [];
  $('#nav-map').textContent = on ? 'CLOSE MAP' : 'MAP';
  if (on) {
    ensureMap(); b.classList.remove('color', 'mapdone');
    const v = backgroundView(); fm.hidden = false; map.invalidateSize(); map.setView(v.center, v.zoom, { animate: false });
    requestAnimationFrame(() => { b.classList.add('mapmode'); renderMap(); startGhosts(); });
    mapTimers.push(setTimeout(() => b.classList.add('color'), 800));
    mapTimers.push(setTimeout(() => b.classList.add('mapdone'), 950));
    if (!location.hash.startsWith('#map')) history.replaceState(null, '', '#map');
  } else {
    b.classList.remove('mapdone', 'color'); void b.offsetHeight;
    requestAnimationFrame(() => b.classList.remove('mapmode'));
    mapTimers.push(setTimeout(() => { fm.hidden = true; stopGhosts(); }, 950));
    if (location.hash.startsWith('#map')) history.replaceState(null, '', location.pathname + location.search);
  }
}
function goTo(x, z){ ensureMap(); map.setView(toLatLng(x, z), Math.max(map.getZoom(), 5.5)); L.popup({ closeButton: false }).setLatLng(toLatLng(x, z)).setContent(x + ', ' + z).openOn(map); }
$('#nav-map').onclick = e => { e.preventDefault(); setMapMode(!document.body.classList.contains('mapmode')); };
document.querySelectorAll('.bar a[href^="#"]:not([id])').forEach(a => a.addEventListener('click', e => {
  if (!document.body.classList.contains('mapmode')) return;
  e.preventDefault(); setMapMode(false);
  setTimeout(() => { const t = document.querySelector(a.getAttribute('href')); if (t) t.scrollIntoView({ behavior: 'smooth' }); }, 80);
}));
$('#map-teaser').onclick = () => setMapMode(true);
$('#fm-close').onclick = () => setMapMode(false);
$('#fm-search').onsubmit = e => { e.preventDefault(); const m = $('#fm-q').value.match(/(-?\d+)[\s,]+(-?\d+)/); if (m) { goTo(+m[1], +m[2]); $('#fm-q').blur(); } };

// ------------------------------------------------------------------ one coin, everything known about it. What nobody knows yet is written in glyphs that never settle.
let coinTimers = [], miniMap = null;
function glyphs(el, pattern){
  // g = one glyph, anything else is punctuation, so unknown coordinates still read as "x, y, z"
  const G = 5, H = 7, S = 2, GAP = 2, cells = [], marks = []; let x = 0;
  for (const ch of pattern) { if (ch === 'g') { cells.push({ x, g: null }); x += G * S + GAP; } else { marks.push({ x, ch }); x += (ch === ' ' ? 3 : ch === '-' ? 4 : 2) * S + GAP; } }
  const c = document.createElement('canvas'); c.width = Math.max(1, x - GAP); c.height = H * S + S; el.innerHTML = ''; el.appendChild(c);
  const ctx = c.getContext('2d');
  const one = () => Array.from({ length: H }, () => { const r = [Math.random() < .5, Math.random() < .45, Math.random() < .55]; return [r[0], r[1], r[2], r[1], r[0]]; });
  cells.forEach(k => k.g = one());
  const draw = () => {
    ctx.clearRect(0, 0, c.width, c.height);
    cells.forEach((k, i) => k.g.forEach((row, y) => row.forEach((on, cx) => { if (on) { ctx.fillStyle = (cx + y + i) % 5 ? '#9a9a9a' : '#e6e6e6'; ctx.fillRect(k.x + cx * S, y * S, S, S); } })));
    ctx.fillStyle = '#9a9a9a';
    marks.forEach(m => { if (m.ch === ',') ctx.fillRect(m.x, (H - 1) * S, S, S * 2); else if (m.ch === '-') ctx.fillRect(m.x, 3 * S, 3 * S, S); else if (m.ch === ':') { ctx.fillRect(m.x, 2 * S, S, S); ctx.fillRect(m.x, 5 * S, S, S); } });
  };
  draw();
  const t = setInterval(() => { cells[Math.floor(Math.random() * cells.length)].g = one(); if (Math.random() < .35) cells[Math.floor(Math.random() * cells.length)].g = one(); draw(); }, 85);
  coinTimers.push(t); return t;
}
function closeCoin(){
  coinTimers.forEach(t => { clearInterval(t); clearTimeout(t); }); coinTimers = []; if (miniMap) { miniMap.remove(); miniMap = null; }
  $('#coin').hidden = true; if (location.hash.startsWith('#coin')) history.replaceState(null, '', location.pathname + location.search);
}
function openCoin(r, n, opts = {}){
  const c = coinOf(r, n); if (!c) return;
  closeCoin();
  const f = !!c.found_at, at = placed(c), reveal = !!opts.reveal && f;
  const days = Math.max(0, Math.floor(((f ? Date.parse(c.found_at) : Date.now()) - Date.parse(c.hidden_at)) / 864e5));
  const e = c.video_url ? embedUrl(c.video_url) : null;
  // [label, value or null when nobody knows, glyph pattern]
  const fields = [
    ['COORDINATES', at ? c.found_x + ', ' + (Number.isInteger(c.found_y) ? c.found_y + ', ' : '') + c.found_z : null, 'ggggg, gg, ggggg'],
    ['NETHER', at ? Math.round(c.found_x / 8) + ', ' + Math.round(c.found_z / 8) : null, 'gggg, gggg'],
    ['HIDDEN', stamp(c.hidden_at), ''],
    ['FOUND', f ? stamp(c.found_at) : null, 'gggg-gg-gg gg:gg:gg'],
    [f ? 'WAS OUT THERE FOR' : 'OUT THERE FOR', days + (days === 1 ? ' DAY' : ' DAYS'), ''],
    ['FOUND BY', f ? head(c.found_ign) + finder(c) : null, 'ggggggg'],
    ['HOW IT WAS HIDDEN', (c.blind ? 'BLIND RUN' : 'BY HAND') + (c.server ? ' · ' + esc(c.server.toUpperCase()) : ''), ''],
    ['WORTH', '1 QLL <i class="sub">+ 0.1 TO THE FOUNDER</i>', ''],
  ];
  const sheet = $('#coin-sheet'); sheet.className = 'sheet ' + (f ? 'found' : 'out') + (reveal ? ' reveal' : '');
  sheet.innerHTML = `
    <div class="ch"><div class="bkwrap">${reveal ? '<img class="grey" src="book-grey.svg" alt=""><img class="gold" src="book-gold.svg" alt="">' : `<img src="${f ? 'book-gold.svg' : 'book-grey.svg'}" alt="">`}</div>
      <div><h3>${reveal ? 'YOU FOUND IT.' : roundName(r) + ' · COIN ' + c.number}</h3><p class="${f ? 'ok' : ''}">${reveal ? roundName(r) + ' · COIN ' + c.number + ' IS YOURS. 1 QLL IS ON YOUR ACCOUNT.' : f ? head(c.found_ign) + 'FOUND BY ' + finder(c) : 'STILL OUT THERE'}</p></div>
      <a class="x" id="coin-x" title="close">✕</a></div>
    ${r === 0 ? '<p class="note">TEST ROUND: THIS COIN IS WORTH NOTHING.</p>' : ''}
    <div class="cf">${fields.map(([k, v, p], i) => `<div><span>${k}</span><b data-f="${i}">${v === null || (reveal && p) ? `<i class="gl" data-p="${p}"></i>` : v}</b></div>`).join('')}</div>
    ${reveal ? `<div class="cfull happened"><span>WHAT JUST HAPPENED</span><ul><li><b>1 QLL</b> IS ON YOUR ACCOUNT.</li><li><b>0.1 QLL</b> WENT TO THE FOUNDER. THAT IS THE WHOLE FEE.</li><li>${at ? 'THE CHEST THIS BOOK SAT IN IS NOW ON THE MAP.' : 'THIS BOOK CARRIED NO SEALED POSITION, SO THE MAP CANNOT SHOW ITS CHEST.'}</li><li>ALL OF IT IS WRITTEN IN <a href="ledger.html">THE LEDGER ↗</a>, FOR GOOD.</li></ul></div>` : ''}
    ${f ? '' : '<p class="note">THE GLYPHS ARE WHAT NOBODY KNOWS YET. ONLY THE CODE INSIDE THE BOOK CAN UNLOCK THEM.</p>'}
    <div class="cfull"><span>ITS FINGERPRINT · PUBLISHED BEFORE THE HUNT · SHA256 OF THE CODE</span><b class="hash">${c.hash}</b></div>
    <div id="coin-map" class="${at ? '' : 'grey'}"></div>
    ${e ? `<div class="cfull"><span>THE HIDE, ON CAMERA${c.video_hash ? ' · RECORDING SHA256 ' + c.video_hash.slice(0, 16) + '…' : ''}</span><div class="video"><iframe src="${e}" allow="fullscreen" loading="lazy"></iframe></div></div>`
        : c.video_url ? `<div class="cfull"><span>THE HIDE, ON CAMERA</span><a href="${esc(c.video_url)}" target="_blank" rel="noopener" style="text-decoration:underline">WATCH THE HIDE ↗</a></div>`
        : '<div class="cfull"><span>THE HIDE, ON CAMERA</span><b style="font-weight:400;color:var(--dim)">NO RECORDING COMMITTED FOR THIS COIN</b></div>'}
    <div class="row">${reveal ? '<button id="coin-claim">CLAIM TO WALLET</button>' : ''}<button class="ghost" id="coin-open-map">${at ? 'OPEN IN THE MAP ↗' : 'OPEN THE MAP ↗'}</button></div>`;
  $('#coin').hidden = false; $('#coin').scrollTop = 0;
  sheet.querySelectorAll('.gl').forEach((el, k) => {
    const t = glyphs(el, el.dataset.p), b = el.parentElement, i = +b.dataset.f;
    if (reveal && fields[i][1] !== null) coinTimers.push(setTimeout(() => { clearInterval(t); b.innerHTML = fields[i][1]; b.classList.add('lit'); }, 1500 + k * 420));   // the glyphs give way, one line at a time
  });
  $('#coin-x').onclick = closeCoin;
  $('#coin-open-map').onclick = () => { closeCoin(); setMapMode(true); if (at) setTimeout(() => goTo(c.found_x, c.found_z), 1000); };
  if (reveal) $('#coin-claim').onclick = () => { closeCoin(); toClaim(); };
  miniMap = L.map('coin-map', { crs: L.CRS.Simple, minZoom: -1, maxZoom: 12, zoomControl: false, attributionControl: false, zoomSnap: 0, scrollWheelZoom: false });
  placeLayer('base', tileOpts()).addTo(miniMap); placeLayer('overlay', tileOpts()).addTo(miniMap);
  if (at) { miniMap.setView(toLatLng(c.found_x, c.found_z), 5.5); L.marker(toLatLng(c.found_x, c.found_z), { icon: bookIcon, interactive: false }).addTo(miniMap); }
  else {
    miniMap.setView(toLatLng(0, 0), 1.2);
    const g = L.marker(ringSpot(r), { icon: ghostIcon, interactive: false }).addTo(miniMap);
    coinTimers.push(setInterval(() => { const el = g.getElement(); if (!el) return; el.style.opacity = '0'; setTimeout(() => { g.setLatLng(ringSpot(r)); el.style.opacity = ''; }, 600); }, 2200));
  }
  history.replaceState(null, '', '#coin=' + r + '-' + c.number);
}
$('#coin').addEventListener('pointerdown', e => { if (e.target === $('#coin')) closeCoin(); });
const toClaim = () => { $('#account').hidden = true; if (document.body.classList.contains('mapmode')) setMapMode(false); setTimeout(() => { $('#claim').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#wallet').focus({ preventScroll: true }); }, 60); };

// ------------------------------------------------------------------ account: Discord owns the coin, the Minecraft name goes on the card
let session = null, ignLocked = false;
const nameOf = u => { const m = u.user_metadata || {}; return (m.custom_claims && m.custom_claims.global_name) || m.full_name || m.preferred_username || m.name || u.email || 'YOU'; };
const pfpOf = u => { const m = u.user_metadata || {}; return m.avatar_url || m.picture || ''; };
function renderAccount(a){
  const chip = $('#nav-account');
  if (!a) { chip.textContent = 'SIGN IN'; $('#account').hidden = true; return; }
  chip.innerHTML = (a.pfp ? `<img src="${esc(a.pfp)}" alt="">` : '') + `<b>${a.total.toFixed(1)}</b> QLL`;
  $('#acc-pfp').src = a.pfp || 'favicon.svg'; $('#acc-name').textContent = a.name.toUpperCase();
  $('#acc-ign').innerHTML = a.ign ? head(a.ign) + esc(a.ign.toUpperCase()) : 'NO MINECRAFT NAME YET';
  $('#acc-total').textContent = a.total.toFixed(1);
  $('#acc-split').textContent = 'ON THE SITE ' + a.bal.toFixed(1) + ' · IN YOUR WALLET ' + a.inWallet.toFixed(1) + ' · ' + a.books.length + (a.books.length === 1 ? ' BOOK' : ' BOOKS');
  $('#acc-books').innerHTML = a.books.map(e => `<div class="own" data-own="${e.coin_number}" data-round="${e.coin_round}"><img src="book-gold.svg" alt="">${roundName(e.coin_round)} · COIN ${e.coin_number} · ${day(e.at)}</div>`).join('') || '<div>NO BOOKS YET. GO FIND ONE.</div>';
  $('#acc-claim').disabled = !(a.bal > 0);
  $('#acc-wallet').hidden = !a.wallet; if (a.wallet) $('#acc-wallet').innerHTML = 'YOUR WALLET · <span class="addr">' + esc(short(a.wallet)) + '</span>';
}
$('#nav-account').onclick = e => { e.preventDefault(); if (!session) { $('#btn-discord').click(); return; } $('#account').hidden = !$('#account').hidden; };
$('#acc-out').onclick = () => { $('#account').hidden = true; sb.auth.signOut(); };
$('#acc-claim').onclick = toClaim;
document.addEventListener('pointerdown', e => { const p = $('#account'); if (!p.hidden && !p.contains(e.target) && !e.target.closest('#nav-account')) p.hidden = true; });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#coin').hidden) closeCoin(); else if (!$('#account').hidden) $('#account').hidden = true; else if (document.body.classList.contains('mapmode')) setMapMode(false);
});
function updateRedeem(){
  const btn = $('#btn-redeem');
  if (FLOW === 'old') { btn.hidden = !session; btn.classList.remove('locked'); return; }
  btn.hidden = false; btn.classList.toggle('locked', !(session && ignLocked));
  if (session) $('#btn-discord').classList.remove('missing');
  if (ignLocked) { $('#btn-ign').classList.remove('missing'); $('#ign-row').classList.remove('missing'); }
}
async function showAuth(){
  const on = !!session, who = $('#who'), mine = $('#mine'), books = $('#mine-books');
  $('#btn-discord').hidden = on; $('#discord-done').hidden = !on;
  if (on) { const u = session.user, p = pfpOf(u), im = $('#discord-pfp'); $('#discord-name').textContent = nameOf(u).toUpperCase(); if (p) { im.src = p; im.hidden = false; } else im.hidden = true; }
  updateRedeem();
  who.textContent = FLOW === 'old' ? (on ? '' : 'A COIN NEEDS AN OWNER, SO REDEEMING TAKES A DISCORD SIGN-IN.') : 'DISCORD OWNS THE COIN. YOUR MINECRAFT NAME GOES ON THE CARD.';
  if (!on) { mine.hidden = true; books.hidden = true; $('#claim').hidden = true; renderAccount(null); return; }
  const me = { name: nameOf(session.user), pfp: pfpOf(session.user), ign: ignLocked ? $('#ign').value.trim() : '', bal: 0, inWallet: 0, total: 0, books: [], wallet: '' };
  renderAccount(me);
  try {
    const { data, error } = await sb.from('ledger').select('delta, reason, coin_round, coin_number, at').eq('user_id', session.user.id).order('at', { ascending: false });
    if (error) throw error;
    const all = data || [], rows = all.filter(e => e.reason === 'find'), bal = Math.round(all.reduce((t, e) => t + Number(e.delta), 0) * 1000) / 1000;
    const { data: cl } = await sb.from('claims').select('at, amount, wallet, status, tx, network').eq('user_id', session.user.id).order('at', { ascending: false });
    const sent = (cl || []).filter(c => c.status === 'sent'), inWallet = sent.reduce((t, c) => t + Number(c.amount), 0);
    const waiting = (cl || []).filter(c => c.status === 'pending'), onWay = waiting.reduce((t, c) => t + Number(c.amount), 0);
    const lastWallet = sent.length ? sent[0].wallet : '';
    mine.hidden = false;
    mine.textContent = 'ON THE SITE: ' + bal.toFixed(1) + ' QLL' + (onWay ? ' · ON THEIR WAY TO YOUR WALLET: ' + onWay.toFixed(1) + ' QLL' : '') + (inWallet ? ' · IN YOUR WALLET: ' + inWallet.toFixed(1) + ' QLL' : '') + (rows.length ? ' · ' + rows.length + (rows.length === 1 ? ' BOOK' : ' BOOKS') : ' · NONE YET. GO FIND ONE.');
    books.hidden = !rows.length;
    books.innerHTML = rows.map(e => `<div class="card found own" data-own="${e.coin_number}" data-round="${e.coin_round}"><img class="book" src="book-gold.svg" alt=""><b>R${e.coin_round} COIN ${e.coin_number}</b><span>REDEEMED ${day(e.at)}</span></div>`).join('');
    $('#claim').hidden = !(bal > 0 || sent.length || waiting.length);
    // the wallet used last time is remembered with the Discord account, and offered again
    if (lastWallet && !$('#wallet').value.trim() && !walletTouched) { $('#wallet').value = lastWallet; $('#wallet-note').hidden = false; }
    if (waiting.length) { $('#claim-msg').textContent = 'A TRANSFER OF ' + onWay.toFixed(1) + ' QLL IS BEING CONFIRMED BY THE NETWORK. THIS PAGE IS WATCHING IT.'; watchTransfer(); }
    else { if (settleTries) $('#claim-msg').textContent = ''; settleTries = 0; }
    myBal = bal; $('#btn-claim').disabled = !(bal > 0);
    renderAccount(Object.assign(me, { bal, inWallet, total: bal + inWallet + onWay, books: rows, wallet: lastWallet }));
    $('#claims').innerHTML = sent.map(c => `${Number(c.amount).toFixed(1)} QLL → <span class="addr">${esc(short(c.wallet))}</span> · ${day(c.at)} · <a href="https://explorer.solana.com/tx/${esc(c.tx)}${c.network === 'mainnet' ? '' : '?cluster=' + esc(c.network)}" target="_blank" rel="noopener">VIEW ↗</a>`).join('<br>');
  } catch (e) { mine.hidden = true; books.hidden = true; $('#claim').hidden = true; }
}
if (sb) { sb.auth.getSession().then(({ data }) => { session = data.session; showAuth(); }); sb.auth.onAuthStateChange((_e, s) => { session = s; showAuth(); }); }
$('#logout').onclick = () => sb.auth.signOut();
$('#btn-discord').onclick = async () => {
  $('#msg').textContent = '…';
  const { error } = await sb.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: location.origin + location.pathname + location.search } });
  if (error) $('#msg').textContent = ('DISCORD SIGN-IN FAILED: ' + error.message).toUpperCase();
};
fetch(SB_URL + '/auth/v1/settings', { headers: { apikey: SB_ANON } }).then(r => r.json()).then(j => {
  if (!(j && j.external && j.external.discord)) { const b = $('#btn-discord'); b.textContent = 'DISCORD SIGN-IN: SOON'; b.disabled = true; }
}).catch(() => {});

// the Minecraft name: the head slot flips through 2b2t faces until you type your own; Enter locks it, the ✕ unlocks it
const HEADS = ['FitMC', 'popbob', 'Hausemaster', 'jared2013', 'SalC1', 'x0XP', 'Sato86', 'Offtopia', 'Armorsmith', 'Fr1kin', 'Coltsnid', 'Jaang', 'iTristan', 'xcc2', 'Willyq', 'Krobar01', 'Torogadude', '0xymoron', 'Hermeticlock', 'Rusher'];
let headTimer = null, headIdx = Math.floor(Math.random() * HEADS.length);
const headUrl = n => 'https://mc-heads.net/avatar/' + encodeURIComponent(n) + '/40';
function nextHead(){ const im = $('#ign-head'); im.style.opacity = '0'; setTimeout(() => { headIdx = (headIdx + 1 + Math.floor(Math.random() * 3)) % HEADS.length; im.src = headUrl(HEADS[headIdx]); im.style.opacity = ''; }, 220); }
function showHead(){
  const v = $('#ign').value.trim(), im = $('#ign-head');
  if (validIgn(v)) { clearInterval(headTimer); headTimer = null; im.src = headUrl(v); im.style.opacity = ''; return; }
  if (!headTimer) { im.src = headUrl(HEADS[headIdx]); headTimer = setInterval(nextHead, 1300); }
}
$('#ign').addEventListener('input', () => { $('#ign-row').classList.remove('missing'); showHead(); });
const openIgn = () => { ignLocked = false; $('#btn-ign').hidden = true; $('#ign-done').hidden = true; $('#ign-row').hidden = false; showHead(); updateRedeem(); };
const closeIgn = () => { $('#ign-row').hidden = true; $('#btn-ign').hidden = false; clearInterval(headTimer); headTimer = null; };
function lockIgn(){
  const v = $('#ign').value.trim();
  if (!validIgn(v)) { $('#ign-row').classList.add('missing'); $('#msg').textContent = 'THAT IS NOT A MINECRAFT NAME.'; return; }
  ignLocked = true; try { localStorage.setItem('qll-ign', v); } catch (e) {}
  clearInterval(headTimer); headTimer = null;
  $('#ign-row').hidden = true; $('#btn-ign').hidden = true; $('#ign-done').hidden = false;
  $('#ign-head-done').src = headUrl(v); $('#ign-name').textContent = v.toUpperCase();
  $('#ign-row').classList.remove('missing'); updateRedeem();
  if (session) showAuth();
}
$('#btn-ign').onclick = () => { openIgn(); $('#ign').focus(); };
$('#ign-edit').onclick = () => { openIgn(); $('#ign').focus(); };
$('#ign').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); lockIgn(); } else if (e.key === 'Escape' && !$('#ign').value.trim()) closeIgn(); });
$('#ign').addEventListener('blur', () => { if (validIgn($('#ign').value.trim())) lockIgn(); });             // on a phone there is no Enter habit: leaving the field with a real name locks it
document.addEventListener('pointerdown', e => { const row = $('#ign-row'); if (!row.hidden && !row.contains(e.target) && !$('#ign').value.trim()) closeIgn(); });
try { $('#ign').value = localStorage.getItem('qll-ign') || ''; } catch (e) {}
if (validIgn($('#ign').value.trim())) lockIgn(); else if ($('#ign').value.trim()) openIgn();
updateRedeem();

// ------------------------------------------------------------------ the code: masked as it is typed, checked as it is typed, spent only by REDEEM
const norm = v => v.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^QLL/, '').replace(/(.{5})/g, '$1-').replace(/-$/, '');
const IDLE = 'CHECKED AS YOU TYPE. NOTHING IS SPENT UNTIL YOU PRESS REDEEM.';
let checkTimer = null, lastChecked = '';
$('#code').addEventListener('input', () => {
  const el = $('#code'), raw = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = (raw.startsWith('QLL') && raw.length > 3 ? raw.slice(3) : raw).slice(0, 20);
  el.value = body ? body.match(/.{1,5}/g).join('-') : '';
  el.setSelectionRange(el.value.length, el.value.length);
  $('#mask').innerHTML = '<i>' + esc(el.value) + '</i>' + 'XXXXX-XXXXX-XXXXX-XXXXX'.slice(el.value.length);
  $('.codewrap').classList.remove('missing');
  clearTimeout(checkTimer);
  const code = 'QLL-' + norm(el.value);
  if (code.length < 27) { $('#msg').textContent = code.length > 4 ? (27 - code.length) + ' CHARACTERS TO GO.' : IDLE; lastChecked = ''; return; }
  if (code === lastChecked) return;
  checkTimer = setTimeout(() => { lastChecked = code; send('/check'); }, 350);
});
async function send(path){
  const code = 'QLL-' + norm($('#code').value);
  if (path === '/redeem' && FLOW !== 'old') {                                // press REDEEM too early and everything still missing lights up red at once
    const missing = [];
    if (code.length < 27) { $('.codewrap').classList.add('missing'); missing.push('THE FULL CODE'); }
    if (!session) { $('#btn-discord').classList.add('missing'); missing.push('DISCORD'); }
    if (!ignLocked) { ($('#ign-row').hidden ? $('#btn-ign') : $('#ign-row')).classList.add('missing'); missing.push('YOUR MINECRAFT NAME'); }
    if (missing.length) { $('#msg').textContent = 'STILL NEEDED: ' + missing.join(' · ') + '.'; return; }
  }
  if (code.length < 27) { $('#msg').textContent = 'THAT IS NOT A FULL CODE.'; $('.codewrap').classList.add('missing'); return; }
  const headers = { 'Content-Type': 'application/json' };
  if (path === '/redeem') {
    if (!session) { $('#msg').textContent = 'SIGN IN WITH DISCORD FIRST, THEN PRESS REDEEM.'; $('#btn-discord').classList.add('missing'); return; }
    headers['Authorization'] = 'Bearer ' + session.access_token;
  }
  const ign = ignLocked ? $('#ign').value.trim() : '';
  $('#msg').textContent = '…';
  try {
    const j = await (await fetch(API + path, { method: 'POST', headers, body: JSON.stringify({ code, ign }) })).json();
    $('#msg').textContent = (j.message || JSON.stringify(j)).toUpperCase();
    if (j.ok && path === '/redeem') {                                        // the moment of finding
      $('#code').value = ''; $('#mask').textContent = 'XXXXX-XXXXX-XXXXX-XXXXX'; lastChecked = '';
      await loadBoard(); openSet.add(j.round); renderRounds(); showAuth();
      openCoin(j.round, j.number, { reveal: true });
    }
  } catch (e) { $('#msg').textContent = 'COULD NOT REACH THE SERVER.'; }
}
$('#btn-redeem').onclick = () => send('/redeem');

// ------------------------------------------------------------------ claiming to a wallet
const claimLabel = () => token.network === 'mainnet' ? 'CLAIM TO WALLET' : 'CLAIM TO WALLET · TEST NETWORK';
let armed = null, armTimer = null, walletTouched = false, settleTimer = null, settleTries = 0;
// a transfer that was left open is settled by asking the server to look it up on the network, every few seconds, until it has ended one way or the other
function watchTransfer(){
  if (settleTimer || settleTries >= 30 || !session) return;
  settleTimer = setTimeout(async () => { settleTimer = null; settleTries++;
    try { await fetch(API + '/settle', { method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token } }); } catch (e) {}
    showAuth(); }, 8000);
}
const disarm = () => { armed = null; clearTimeout(armTimer); $('#btn-claim').textContent = claimLabel(); $('#btn-claim').classList.remove('armed'); };
$('#wallet').addEventListener('input', () => { walletTouched = true; $('#wallet-note').hidden = true; $('#wallet').classList.remove('missing'); if (armed) { disarm(); $('#claim-msg').textContent = ''; } });
$('#btn-claim').onclick = async () => {
  const wallet = $('#wallet').value.trim(), say = t => $('#claim-msg').textContent = t;
  const no = t => { $('#wallet').classList.add('missing'); say(t); };
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) return no('THAT IS NOT A SOLANA WALLET ADDRESS.');
  if (wallet === token.mint) return no('THAT IS THE ADDRESS OF THE TOKEN, NOT OF A WALLET. PASTE THE ADDRESS YOUR WALLET APP SHOWS UNDER RECEIVE.');
  if (wallet === token.founder) return no('THAT IS THE FOUNDER WALLET. IT ONLY EVER RECEIVES THE FOUNDER\'S TENTH.');
  if (armed !== wallet) {                                                     // first press: say exactly what is about to happen
    armed = wallet; clearTimeout(armTimer); armTimer = setTimeout(() => { disarm(); say(''); }, 15000);
    $('#btn-claim').innerHTML = 'PRESS AGAIN: SEND ' + myBal.toFixed(1) + ' QLL TO <span class="addr">' + esc(short(wallet)) + '</span>'; $('#btn-claim').classList.add('armed');
    say('CHECK THE ADDRESS, FIRST AND LAST FOUR CHARACTERS. A TRANSFER CANNOT BE UNDONE.'); return;
  }
  disarm(); say('SENDING…'); $('#btn-claim').disabled = true;
  try {
    const r = await fetch(API + '/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token }, body: JSON.stringify({ wallet }) });
    const j = await r.json(); say((j.message || '').toUpperCase());
  } catch (e) { say('COULD NOT REACH THE SERVER.'); }
  showAuth();
};
// the token and the founder wallet are public: link them, and offer the token address to wallets that show nothing on their own
fetch(API + '/ledger').then(r => r.json()).then(j => {
  token = { mint: j.mint, network: j.network || 'devnet', founder: j.founder_wallet };
  document.body.classList.toggle('mainnet', token.network === 'mainnet');
  const q = token.network === 'mainnet' ? '' : '?cluster=' + encodeURIComponent(token.network);
  if (token.founder) { const a = $('#lnk-founder'); a.href = 'https://explorer.solana.com/address/' + encodeURIComponent(token.founder) + '/tokens' + q; a.hidden = false; }
  if (token.mint) {
    const a = $('#lnk-token'); a.href = 'https://explorer.solana.com/address/' + encodeURIComponent(token.mint) + q; a.hidden = false;
    $('#mint-line').hidden = false; $('#mint').textContent = token.mint;
    $('#mint-copy').onclick = async () => { try { await navigator.clipboard.writeText(token.mint); $('#mint-copy').textContent = 'COPIED'; setTimeout(() => $('#mint-copy').textContent = 'COPY', 1500); } catch (e) {} };
  }
  if (!armed) $('#btn-claim').textContent = claimLabel();
}).catch(() => {});

if (window.QUILL_PROOF_VIDEO) { $('#proof').hidden = false; $('#proof-video').innerHTML = `<iframe src="${window.QUILL_PROOF_VIDEO}" allow="fullscreen" loading="lazy"></iframe>`; }
loadBoard().then(() => { const m = location.hash.match(/^#map(?:=(-?\d+),(-?\d+))?$/); if (m) { setMapMode(true); if (m[1]) setTimeout(() => goTo(+m[1], +m[2]), 60); } });

function openChapter(){ const t = location.hash.startsWith('#g-') && document.getElementById(location.hash.slice(1)); if (t && t.tagName === 'DETAILS') { t.open = true; t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }
addEventListener('hashchange', openChapter); openChapter();
