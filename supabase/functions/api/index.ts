// QuillCoin API - one function: the public board and ledger, check / redeem / claim for finders, and two routes for the hider tool.
// Nothing here ever sees a coordinate. Codes arrive only at /check and /redeem and are hashed immediately.
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const HIDER_KEY = Deno.env.get("HIDER_KEY") ?? "";
const WEBHOOK = Deno.env.get("DISCORD_WEBHOOK_URL") ?? "";   // optional: announce every find in the community server
const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" } });

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
/** Whatever the finder typed -> exactly what the book prints: QLL-XXXXX-XXXXX-XXXXX-XXXXX */
function canon(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.startsWith("QLL")) s = s.slice(3);
  if (s.length !== 20) return null;
  return "QLL-" + s.match(/.{5}/g)!.join("-");
}
/** Per-IP hits per minute, counted in the database (edge isolates share nothing). The 100-bit code space is the real defence; this just keeps abuse from costing anything. */
async function limited(req: Request, cls: string, max: number): Promise<boolean> {
  const ip = (req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? "?").split(",")[0].trim();
  const { data, error } = await admin.rpc("bump_rate", { p_key: cls + ":" + ip, p_max: max });
  if (error) { console.error("rate", error.message); return false; }
  return data === true;
}
/** The hider tool encrypts the chest position with AES-256-GCM under SHA-256("quillcoin-loc:" + code). Only the code opens it. */
async function openLoc(code: string, b64: string): Promise<{ x: number; y: number; z: number } | null> {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (bytes.length < 12 + 16 + 1) return null;
    const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("quillcoin-loc:" + code));
    const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    const j = JSON.parse(new TextDecoder().decode(pt));
    if (![j.x, j.y, j.z].every((v: unknown) => Number.isInteger(v))) return null;
    return { x: j.x, y: j.y, z: j.z };
  } catch { return null; }
}
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const u = new URL(req.url);
  const path = u.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  try {
    const cls = path === "/check" || path === "/redeem" || path === "/settle" ? "code" : path === "/hide" ? "hide" : "read";
    const max = cls === "code" ? 20 : cls === "hide" ? 60 : 120;
    if (await limited(req, cls, max)) return json(429, { ok: false, message: "slow down - try again in a minute" });
    if (req.method === "GET" && path === "/board") { const q = u.searchParams.get("round"); return q === null ? await boardAll() : await board(Number(q)); }
    if (req.method === "GET" && path === "/ledger") return await ledger(u);
    if (req.method === "POST" && path === "/hide") return await hide(req);
    if (req.method === "POST" && path === "/video") return await video(req);
    if (req.method === "POST" && path === "/check") return await check(req);
    if (req.method === "POST" && path === "/redeem") return await redeem(req);
    if (req.method === "POST" && path === "/claim") return await claim(req);
    if (req.method === "POST" && path === "/settle") return await settle(req);
    if (path === "/") {
      return json(200, {
        ok: true,
        service: "quillcoin api",
        endpoints: ["GET /board", "GET /board?round=N", "GET /ledger", "GET /ledger?after=ID", "POST /check {code}", "POST /redeem {code, ign} + Bearer <user token>", "POST /claim {wallet} + Bearer <user token>", "POST /settle + Bearer <user token>", "POST /hide (hider tool only)", "POST /video {round, number, sha256, url} (hider only)"],
      });
    }
    return json(404, { ok: false, message: "no such endpoint" });
  } catch (e) {
    console.error(e);
    return json(500, { ok: false, message: "server error" });
  }
});

async function board(round: number) {
  if (!Number.isInteger(round) || round < 0) return json(400, { ok: false, message: "bad round" });
  const { data: r } = await admin.from("rounds").select("id, opened_at, closed_at, note, ring_min, ring_max, planned").eq("id", round).maybeSingle();
  if (!r) return json(404, { ok: false, message: "no such round" });
  const { data: coins, error } = await admin.from("coins")
    .select("number, hash, hidden_at, blind, server, found_at, found_ign, found_name, found_x, found_y, found_z, video_hash, video_at, video_url").eq("round", round).order("number");
  if (error) throw error;
  const list = coins ?? [];                                                   // a recording's fingerprint is public at once; its address is only written onto the coin when the book is found
  return json(200, { ok: true, round: r, coins: list, hidden: list.length, found: list.filter((c) => c.found_at).length });
}

const COIN_FIELDS = "round, number, hash, hidden_at, blind, server, found_at, found_ign, found_name, found_x, found_y, found_z, video_hash, video_at, video_url";
async function boardAll() {
  const { data: rs, error: e1 } = await admin.from("rounds").select("id, opened_at, closed_at, note, ring_min, ring_max, planned").order("id");
  if (e1) throw e1;
  const { data: coins, error: e2 } = await admin.from("coins").select(COIN_FIELDS).order("number");
  if (e2) throw e2;
  const rounds = (rs ?? []).map((r) => { const list = (coins ?? []).filter((c) => c.round === r.id); return { ...r, coins: list, hidden: list.length, found: list.filter((c) => c.found_at).length }; });
  return json(200, { ok: true, rounds });
}

const PAGE = 1000;
/** The public ledger, oldest row first, PAGE rows at a time: GET /ledger, then GET /ledger?after=<last id> while "more" is true. */
async function ledger(u: URL) {
  const after = Math.max(0, Math.floor(Number(u.searchParams.get("after") ?? 0)) || 0);
  const { data, error } = await admin.from("ledger_named").select("*").gt("id", after).order("id", { ascending: true }).limit(PAGE);
  if (error) throw error;
  const chain = data ?? [];
  const { data: t, error: e2 } = await admin.rpc("ledger_totals");
  if (e2) throw e2;
  const tot = (Array.isArray(t) ? t[0] : t) ?? {};
  const page = { ok: true, rows: Number(tot.total_rows ?? 0), head: tot.head ?? null, after, more: chain.length === PAGE, chain };
  if (after > 0) return json(200, page);
  // coins come into existence only through a find (1 to the finder) and its founder fee (0.1); a claim moves them to a wallet, it creates nothing
  const { data: sent } = await admin.from("claims").select("at, amount, founder_amount, wallet, tx, network, user_id, ledger_head").eq("status", "sent").order("at", { ascending: false }).limit(PAGE);
  const transfers = (sent ?? []).map((c) => ({ at: c.at, to_finder: Number(c.amount), to_founder: Number(c.founder_amount), wallet: c.user_id ? c.wallet : "founder wallet", tx: c.tx, network: c.network, ledger_head: c.ledger_head }));
  return json(200, {
    ...page,
    minted: Number(tot.minted ?? 0), founder: Number(tot.founder ?? 0), on_site: Number(tot.on_site ?? 0), in_wallets: Number(tot.in_wallets ?? 0), in_flight: Number(tot.in_flight ?? 0),
    founder_wallet: Deno.env.get("QLL_FOUNDER") ?? null, mint: Deno.env.get("QLL_MINT") ?? null, network: Deno.env.get("QLL_NETWORK") ?? "devnet",
    claims: Deno.env.get("QLL_MINT") && Deno.env.get("QLL_AUTHORITY") && Deno.env.get("QLL_FOUNDER") ? "open" : "soon",      // moving coins to a wallet needs the token to exist
    hashing: "sha256( prev | id | at | delta | reason | coin_round | coin_number | who ), empty for a missing value, joined with |",
    anchor: "every claim writes quillcoin-ledger:<newest hash> into its own Solana transaction",
    transfers_total: Number(tot.transfers ?? 0), transfers,
  });
}

/** Hider tool only. Body: {round, number, hash, ts, server?, blind?}. A hash can be added until the round opens, never after. */
async function hide(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!HIDER_KEY || !auth.startsWith("Bearer ") || !sameSecret(auth.slice(7).trim(), HIDER_KEY)) {
    return json(401, { ok: false, message: "bad hider key" });
  }
  const b = await req.json().catch(() => null);
  if (!b) return json(400, { ok: false, message: "bad json" });
  const round = Number(b.round), number = Number(b.number), ts = Number(b.ts);
  const hash = String(b.hash ?? "").toLowerCase();
  const server = typeof b.server === "string" ? b.server.toLowerCase().slice(0, 64) : null;
  const blind = b.blind === true || b.blind === 1 || b.blind === "1";
  const loc = typeof b.loc === "string" && /^[A-Za-z0-9+/=]{40,400}$/.test(b.loc) ? b.loc : null;
  if (!Number.isInteger(round) || round < 0 || !Number.isInteger(number) || number < 1 || !/^[0-9a-f]{64}$/.test(hash) || !Number.isFinite(ts)) {
    return json(400, { ok: false, message: "bad fields" });
  }
  if (round > 0 && !(server && /(^|\.)2b2t\.org$/.test(server))) {
    return json(400, { ok: false, message: "only hides made on 2b2t.org can join a real round - singleplayer hides belong to round 0" });
  }
  const { data: r } = await admin.from("rounds").select("id, opened_at, planned").eq("id", round).maybeSingle();
  if (!r) return json(404, { ok: false, message: "no such round" });
  if (round > 0 && r.opened_at && new Date(r.opened_at) <= new Date()) {
    return json(409, { ok: false, message: "round already open - nothing can be added" });
  }
  const { error } = await admin.from("coins").insert({ round, number, hash, hidden_at: new Date(ts * 1000).toISOString(), blind, server, loc_enc: loc });
  if (error) {
    if (error.code === "23505") {
      // same hash posted twice (a retry) is fine; a different hash on a used number is not
      const { data: ex } = await admin.from("coins").select("hash, loc_enc").eq("round", round).eq("number", number).maybeSingle();
      if (ex?.hash === hash) {
        if (loc && !ex.loc_enc) await admin.from("coins").update({ loc_enc: loc }).eq("hash", hash);   // a retry that finally carries the position
        return json(200, { ok: true, message: "already on the board" });
      }
      return json(409, { ok: false, message: "number or hash already used" });
    }
    // the database has the last word on a round's size and on whether it is open
    if (/already holds all|is open/.test(error.message ?? "")) return json(409, { ok: false, message: error.message });
    throw error;
  }
  return json(201, { ok: true, message: `R${round} coin ${number} committed` });
}

/**
 * Hider only: commits the recording of a hide. Body: {round, number, sha256, url}.
 * The fingerprint is public at once and can never be replaced by another. The address is kept back until the book is found,
 * because a recording of a dungeon can give its place away: the pattern of its floor is decided by the world's seed.
 */
async function video(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!HIDER_KEY || !auth.startsWith("Bearer ") || !sameSecret(auth.slice(7).trim(), HIDER_KEY)) return json(401, { ok: false, message: "bad hider key" });
  const b = await req.json().catch(() => null);
  const round = Number(b?.round), number = Number(b?.number), sha = String(b?.sha256 ?? "").toLowerCase();
  const url = typeof b?.url === "string" && /^https:\/\/[^\s"'<>]{4,290}$/.test(b.url) ? b.url : null;
  if (!Number.isInteger(round) || !Number.isInteger(number) || !/^[0-9a-f]{64}$/.test(sha)) return json(400, { ok: false, message: "bad fields" });
  const { data: c } = await admin.from("coins").select("video_hash, found_at").eq("round", round).eq("number", number).maybeSingle();
  if (!c) return json(404, { ok: false, message: "no such coin" });
  if (c.video_hash && c.video_hash !== sha) return json(409, { ok: false, message: "a different recording is already committed for this coin" });
  if (url) {
    const { error: e0 } = await admin.from("recordings").upsert({ round, number, url }, { onConflict: "round,number" });
    if (e0) throw e0;
  }
  const change: Record<string, unknown> = { video_hash: sha };
  if (!c.video_hash) change.video_at = new Date().toISOString();
  if (c.found_at && url) change.video_url = url;                               // found already: nothing is left to give away
  const { error } = await admin.from("coins").update(change).eq("round", round).eq("number", number);
  if (error) throw error;
  return json(200, { ok: true, message: `recording committed for R${round} coin ${number}` + (c.found_at ? "" : " - it opens when the book is found") });
}

async function check(req: Request) {
  const b = await req.json().catch(() => null);
  const code = canon(b?.code);
  if (!code) return json(400, { ok: false, status: "malformed", message: "that is not a full code" });
  const hash = await sha256(code);
  const { data: c } = await admin.from("coins").select("round, number, found_at, found_ign, found_name").eq("hash", hash).maybeSingle();
  if (!c) return json(200, { ok: true, status: "unknown", message: "no coin has this code" });
  if (c.found_at) {
    return json(200, {
      ok: true, status: "spent", round: c.round, number: c.number, found_at: c.found_at,
      message: `R${c.round} coin ${c.number} was redeemed ${new Date(c.found_at).toUTCString()} by ${c.found_ign || c.found_name || "someone"}`,
    });
  }
  return json(200, { ok: true, status: "unspent", round: c.round, number: c.number, message: `R${c.round} coin ${c.number} is real and unspent` });
}

async function redeem(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json(401, { ok: false, need: "login", message: "sign in first - a coin has to belong to someone" });
  const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: uerr } = await asUser.auth.getUser();
  if (uerr || !user) return json(401, { ok: false, need: "login", message: "sign in first - a coin has to belong to someone" });
  const b = await req.json().catch(() => null);
  const code = canon(b?.code);
  if (!code) return json(400, { ok: false, message: "that is not a full code" });
  const ign = typeof b?.ign === "string" ? b.ign.replace(/[^A-Za-z0-9_]/g, "").slice(0, 16) : "";
  const m = (user.user_metadata ?? {}) as Record<string, unknown>;
  const cc = (m.custom_claims ?? {}) as Record<string, unknown>;
  const discordName = String(cc.global_name || m.full_name || m.preferred_username || m.name || "").slice(0, 32);
  const hash = await sha256(code);
  const { data, error } = await admin.rpc("claim_coin", { p_hash: hash, p_user: user.id, p_ign: ign || null, p_name: discordName || null });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("blacklisted")) return json(403, { ok: false, message: "this account is on the hider blacklist and can never redeem" });
    if (m.includes("unknown")) return json(404, { ok: false, message: "no coin has this code" });
    if (m.includes("spent")) {
      const { data: c } = await admin.from("coins").select("round, number, found_at, found_ign, found_name").eq("hash", hash).maybeSingle();
      const who = c?.found_ign || c?.found_name || "someone", when = c?.found_at ? new Date(c.found_at).toUTCString() : "earlier";
      return json(409, { ok: false, message: c ? `already redeemed: R${c.round} coin ${c.number} went to ${who} on ${when}` : "already redeemed - someone got there first" });
    }
    if (m.includes("closed")) return json(409, { ok: false, message: "this round is not open for redemption yet" });
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  // the code just proved itself: it can now open the chest position for the map
  const { data: coin } = await admin.from("coins").select("loc_enc").eq("hash", hash).maybeSingle();
  if (coin?.loc_enc) {
    const at = await openLoc(code, coin.loc_enc);
    if (at) await admin.from("coins").update({ found_x: at.x, found_y: at.y, found_z: at.z }).eq("hash", hash);
  }
  announce(row.round, row.number, ign || discordName).catch((e) => console.error("webhook", e));
  return json(200, { ok: true, round: row.round, number: row.number, message: `R${row.round} coin ${row.number} is yours. 1 QLL minted to you, 0.1 to the founder wallet` });
}

async function announce(round: number, number: number, ign: string) {
  if (!WEBHOOK || round === 0) return;
  const { data: c } = await admin.from("coins").select("hidden_at").eq("round", round).eq("number", number).maybeSingle();
  const days = c ? Math.floor((Date.now() - Date.parse(c.hidden_at)) / 86_400_000) : null;
  const who = ign ? `**${ign.replace(/[*_`~|]/g, "")}**` : "someone";
  const content = `R${round} Coin ${number} was just found by ${who}${days == null ? "" : ` after ${days} day${days === 1 ? "" : "s"} out there`}. https://quillcoin.gg/`;
  await fetch(WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content, username: "QuillCoin" }) });
}

// ---------------------------------------------------------------- moving coins to a wallet
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
type Fate = "landed" | "failed" | "unknown";

async function chain() {
  const web3 = await import("npm:@solana/web3.js@1.98.0");
  const NETWORK = Deno.env.get("QLL_NETWORK") ?? "devnet", RPC = Deno.env.get("QLL_RPC") ?? "https://api.devnet.solana.com";
  return { web3, NETWORK, conn: new web3.Connection(RPC, "confirmed") };
}
async function signedIn(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await asUser.auth.getUser();
  return error || !user ? null : user;
}

/** What became of a transaction. "failed" is only ever answered when it ran and was rejected, or when it can no longer run at all. */
// deno-lint-ignore no-explicit-any
async function fate(conn: any, sig: string, lastValid: number | null): Promise<Fate> {
  for (let look = 0; look < 2; look++) {
    const st = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
    if (st) {
      if (st.err) return "failed";
      return st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized" ? "landed" : "unknown";
    }
    // never seen. It can still arrive until the network has finalized a block past the last one it is valid for; after that, look once more and then it is certain
    if (lastValid == null || (await conn.getBlockHeight("finalized")) <= lastValid) return "unknown";
  }
  return "failed";
}

/** Settles every transfer of this finder that was left open. Returns how many are still waiting. */
// deno-lint-ignore no-explicit-any
async function settlePending(userId: string, conn: any): Promise<{ settled: number; waiting: number }> {
  const { data: rows, error } = await admin.from("claims").select("id, at, tx, last_valid_height").eq("user_id", userId).eq("status", "pending");
  if (error) throw error;
  let settled = 0, waiting = 0;
  for (const c of rows ?? []) {
    if (!c.tx) {
      // no signature was written down, so nothing was ever handed to the network; give a running request three minutes before calling it off
      if (Date.now() - Date.parse(c.at) > 180_000) { await admin.rpc("fail_claim", { p_id: c.id }); settled++; } else waiting++;
      continue;
    }
    const f = await fate(conn, c.tx, c.last_valid_height == null ? null : Number(c.last_valid_height));
    if (f === "landed") { await admin.rpc("mark_claim_sent", { p_id: c.id }); settled++; }
    else if (f === "failed") { await admin.rpc("fail_claim", { p_id: c.id }); settled++; }
    else waiting++;
  }
  return { settled, waiting };
}

async function settle(req: Request) {
  const user = await signedIn(req);
  if (!user) return json(401, { ok: false, need: "login", message: "sign in first" });
  const { conn } = await chain();
  const r = await settlePending(user.id, conn);
  return json(200, { ok: true, ...r, message: r.waiting ? "still being confirmed" : "nothing is waiting" });
}

/** Moves a finder's whole site balance to their wallet as QLL tokens. QLL_NETWORK / QLL_RPC / QLL_MINT / QLL_AUTHORITY / QLL_FOUNDER are function secrets. */
async function claim(req: Request) {
  const user = await signedIn(req);
  if (!user) return json(401, { ok: false, need: "login", message: "sign in first" });
  const MINT = Deno.env.get("QLL_MINT") ?? "", AUTHORITY = Deno.env.get("QLL_AUTHORITY") ?? "", FOUNDER = Deno.env.get("QLL_FOUNDER") ?? "";
  if (!MINT || !AUTHORITY || !FOUNDER) return json(503, { ok: false, message: "claims are not open yet" });
  const b = await req.json().catch(() => null);
  const wallet = typeof b?.wallet === "string" ? b.wallet.trim() : "";
  const { web3, NETWORK, conn } = await chain();
  const spl = await import("npm:@solana/spl-token@0.4.9");
  const authority = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(AUTHORITY)));

  // the address has to be a wallet, and a wallet of the finder's own
  let to;
  try { to = new web3.PublicKey(wallet); if (!web3.PublicKey.isOnCurve(to.toBytes())) throw new Error("not a wallet"); }
  catch { return json(400, { ok: false, message: "that is not a solana wallet address" }); }
  if (wallet === MINT) return json(400, { ok: false, message: "that is the address of the token itself, not of a wallet - paste your wallet's address" });
  if (wallet === FOUNDER) return json(400, { ok: false, message: "that is the founder wallet - it only ever receives the founder's tenth" });
  if (wallet === authority.publicKey.toBase58()) return json(400, { ok: false, message: "that address belongs to the token, not to a wallet" });
  try {
    const acct = await conn.getAccountInfo(to);
    if (acct && acct.owner.toBase58() !== SYSTEM_PROGRAM) return json(400, { ok: false, message: "that address is not a wallet (it is a token account or a program) - paste your wallet's main address" });
  } catch (e) { console.error("claim lookup", e); return json(502, { ok: false, message: "solana could not be reached - nothing was sent, try again in a minute" }); }

  // one transfer at a time: anything left open is settled first
  try {
    const open = await settlePending(user.id, conn);
    if (open.waiting) return json(409, { ok: false, pending: true, message: "an earlier transfer of yours is still being confirmed - give it a minute" });
  } catch (e) { console.error("claim settle", e); return json(502, { ok: false, message: "solana could not be reached - nothing was sent, try again in a minute" }); }

  const { data, error } = await admin.rpc("begin_claim", { p_user: user.id, p_wallet: wallet });
  if (error) {
    if ((error.message ?? "").includes("nothing")) return json(409, { ok: false, message: "nothing to claim - your site balance is zero" });
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  const back = async (why: unknown) => {
    console.error("claim", why);
    await admin.rpc("fail_claim", { p_id: row.id });
    return json(502, { ok: false, message: "the transfer did not go through - your balance is back on the site, try again" });
  };
  const done = (sig: string) => {
    const cluster = NETWORK === "mainnet" ? "" : `?cluster=${NETWORK}`;
    return json(200, { ok: true, amount: Number(row.amount), tx: sig, explorer: `https://explorer.solana.com/tx/${sig}${cluster}`, message: `${Number(row.amount)} QLL sent to your wallet${NETWORK === "mainnet" ? "" : " on the test network"}` });
  };

  // 1. everything up to the signature: if any of it fails, nothing was handed to the network and the balance goes straight back
  let tx, sig: string, latest;
  try {
    const mint = new web3.PublicKey(MINT);
    const account = await spl.getOrCreateAssociatedTokenAccount(conn, authority, mint, to);
    const founderAccount = await spl.getOrCreateAssociatedTokenAccount(conn, authority, mint, new web3.PublicKey(FOUNDER));
    const units = BigInt(Math.round(Number(row.amount) * 1000)) * 1000n;       // 6 decimals
    const feeUnits = BigInt(Math.round(Number(row.founder_amount) * 1000)) * 1000n;
    // one transaction, two mints: whoever looks at it sees the finder's coins and the founder's tenth arrive together
    tx = new web3.Transaction();
    if (NETWORK === "mainnet") {
      // a small tip to the network (about 0.00001 SOL, paid by the token's own key), so a transfer is not left waiting when Solana is busy
      tx.add(web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 }), web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }));
    }
    tx.add(spl.createMintToInstruction(mint, account.address, authority.publicKey, units));
    if (feeUnits > 0n) tx.add(spl.createMintToInstruction(mint, founderAccount.address, authority.publicKey, feeUnits));
    // anchor: the ledger's newest hash is written into the transaction itself, where it can never be edited
    const { data: top } = await admin.from("ledger_public").select("hash").order("id", { ascending: false }).limit(1).maybeSingle();
    const head = top?.hash ?? "";
    const { Buffer } = await import("node:buffer");
    if (head) tx.add(new web3.TransactionInstruction({ keys: [], programId: new web3.PublicKey(MEMO_PROGRAM), data: Buffer.from("quillcoin-ledger:" + head, "utf8") }));
    latest = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latest.blockhash; tx.lastValidBlockHeight = latest.lastValidBlockHeight; tx.feePayer = authority.publicKey;
    tx.sign(authority);
    const { default: bs58 } = await import("npm:bs58@6.0.0");
    sig = bs58.encode(tx.signature!);
    // written down before it leaves, so it can always be looked up afterwards
    const { error: e1 } = await admin.from("claims").update({ tx: sig, last_valid_height: latest.lastValidBlockHeight, network: NETWORK, ledger_head: head || null }).eq("id", row.id);
    if (e1) throw e1;
  } catch (e) { return await back(e); }

  // 2. handed to the network. From here on the balance only goes back when the transaction can no longer happen
  try {
    await conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
  } catch (e) {
    if (e instanceof web3.SendTransactionError) return await back(e);           // the network answered no: it was never passed on
    console.error("claim send", e);                                             // no answer at all: it may or may not have arrived
  }
  let f: Fate = "unknown";
  try {
    const res = await conn.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
    f = res.value.err ? "failed" : "landed";
  } catch (e) {
    console.error("claim confirm", e);
    try { f = await fate(conn, sig, latest.lastValidBlockHeight); } catch (e2) { console.error("claim fate", e2); }
  }
  if (f === "landed") { await admin.rpc("mark_claim_sent", { p_id: row.id }); return done(sig); }
  if (f === "failed") return await back("transaction " + sig + " failed or expired");
  return json(202, { ok: true, pending: true, tx: sig, message: "the transfer is taking longer than usual - your coins are reserved for it, and this page will show how it ended" });
}
