// QuillCoin API - one function, four public routes and one for the hider tool.
// Nothing here ever sees a coordinate. Codes arrive only at /check and /redeem and are hashed immediately.
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const HIDER_KEY = Deno.env.get("HIDER_KEY") ?? "";
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
    const cls = path === "/check" || path === "/redeem" ? "code" : path === "/hide" ? "hide" : "read";
    const max = cls === "code" ? 20 : cls === "hide" ? 60 : 120;
    if (await limited(req, cls, max)) return json(429, { ok: false, message: "slow down - try again in a minute" });
    if (req.method === "GET" && path === "/board") return await board(Number(u.searchParams.get("round") ?? "1"));
    if (req.method === "GET" && path === "/ledger") return await ledger();
    if (req.method === "POST" && path === "/hide") return await hide(req);
    if (req.method === "POST" && path === "/check") return await check(req);
    if (req.method === "POST" && path === "/redeem") return await redeem(req);
    if (path === "/") {
      return json(200, {
        ok: true,
        service: "quillcoin api",
        endpoints: ["GET /board?round=N", "GET /ledger", "POST /check {code}", "POST /redeem {code, ign} + Bearer <user token>", "POST /hide (hider tool only)"],
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
  const { data: r } = await admin.from("rounds").select("id, opened_at, closed_at, note").eq("id", round).maybeSingle();
  if (!r) return json(404, { ok: false, message: "no such round" });
  const { data: coins, error } = await admin.from("coins")
    .select("number, hash, hidden_at, blind, server, found_at, found_ign").eq("round", round).order("number");
  if (error) throw error;
  const list = coins ?? [];
  return json(200, { ok: true, round: r, coins: list, hidden: list.length, found: list.filter((c) => c.found_at).length });
}

async function ledger() {
  const { data, error } = await admin.from("ledger")
    .select("at, delta, reason, coin_round, coin_number").order("at", { ascending: false }).limit(500);
  if (error) throw error;
  const { data: names } = await admin.from("coins").select("round, number, found_ign").not("found_at", "is", null);
  const nameOf = new Map((names ?? []).map((c) => [`${c.round}/${c.number}`, c.found_ign]));
  const entries = (data ?? []).map((e) => ({
    at: e.at,
    delta: Number(e.delta),
    reason: e.reason,
    coin: e.coin_round == null ? null : `R${e.coin_round} #${e.coin_number}`,
    who: e.reason === "founder-fee" ? "FOUNDER" : (nameOf.get(`${e.coin_round}/${e.coin_number}`) || "anonymous"),
  }));
  const founder = entries.filter((e) => e.reason === "founder-fee").reduce((s, e) => s + e.delta, 0);
  const minted = entries.reduce((s, e) => s + e.delta, 0);
  return json(200, { ok: true, minted, founder, entries });
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
  if (!Number.isInteger(round) || round < 0 || !Number.isInteger(number) || number < 1 || !/^[0-9a-f]{64}$/.test(hash) || !Number.isFinite(ts)) {
    return json(400, { ok: false, message: "bad fields" });
  }
  if (round > 0 && !(server && /(^|\.)2b2t\.org$/.test(server))) {
    return json(400, { ok: false, message: "only hides made on 2b2t.org can join a real round - singleplayer hides belong to round 0" });
  }
  const { data: r } = await admin.from("rounds").select("id, opened_at").eq("id", round).maybeSingle();
  if (!r) return json(404, { ok: false, message: "no such round" });
  if (round > 0 && r.opened_at && new Date(r.opened_at) <= new Date()) {
    return json(409, { ok: false, message: "round already open - nothing can be added" });
  }
  const { error } = await admin.from("coins").insert({ round, number, hash, hidden_at: new Date(ts * 1000).toISOString(), blind, server });
  if (error) {
    if (error.code === "23505") {
      // same hash posted twice (a retry) is fine; a different hash on a used number is not
      const { data: ex } = await admin.from("coins").select("hash").eq("round", round).eq("number", number).maybeSingle();
      if (ex?.hash === hash) return json(200, { ok: true, message: "already on the board" });
      return json(409, { ok: false, message: "number or hash already used" });
    }
    throw error;
  }
  return json(201, { ok: true, message: `R${round} coin ${number} committed` });
}

async function check(req: Request) {
  const b = await req.json().catch(() => null);
  const code = canon(b?.code);
  if (!code) return json(400, { ok: false, status: "malformed", message: "that is not a full code" });
  const hash = await sha256(code);
  const { data: c } = await admin.from("coins").select("round, number, found_at, found_ign").eq("hash", hash).maybeSingle();
  if (!c) return json(200, { ok: true, status: "unknown", message: "no coin has this code" });
  if (c.found_at) {
    return json(200, {
      ok: true, status: "spent", round: c.round, number: c.number, found_at: c.found_at,
      message: `R${c.round} coin ${c.number} was redeemed ${new Date(c.found_at).toUTCString()} by ${c.found_ign || "someone"}`,
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
  const hash = await sha256(code);
  const { data, error } = await admin.rpc("claim_coin", { p_hash: hash, p_user: user.id, p_ign: ign || null });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("blacklisted")) return json(403, { ok: false, message: "this account is on the hider blacklist and can never redeem" });
    if (m.includes("unknown")) return json(404, { ok: false, message: "no coin has this code" });
    if (m.includes("spent")) return json(409, { ok: false, message: "already redeemed - someone got there first" });
    if (m.includes("closed")) return json(409, { ok: false, message: "this round is not open for redemption yet" });
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return json(200, { ok: true, round: row.round, number: row.number, message: `R${row.round} coin ${row.number} is yours. 1 QLL minted to you, 0.1 to the founder wallet` });
}
