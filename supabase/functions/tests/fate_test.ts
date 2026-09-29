// deno test supabase/functions/tests/fate_test.ts
// Nodes are played by stand-ins here, so that every answer a real one could give - late, wrong, or none - can be tried.
import { fate, look } from "../api/fate.ts";

type Status = { err: unknown; confirmationStatus: "processed" | "confirmed" | "finalized" } | null;
/** A node whose newest final block is `height` at `slot`, which answers about the signature as of `seenSlot`. */
const node = (status: Status, height: number, slot: number, seenSlot = slot + 30) => ({
  getEpochInfo: () => Promise.resolve({ blockHeight: height, absoluteSlot: slot }),
  getSignatureStatuses: () => Promise.resolve({ context: { slot: seenSlot }, value: [status] }),
});
const dead = { getEpochInfo: () => Promise.reject(new Error("no answer")), getSignatureStatuses: () => Promise.reject(new Error("no answer")) };
const is = (got: unknown, want: unknown, what: string) => { if (got !== want) throw new Error(`${what}: expected ${want}, got ${got}`); };
const LAST = 1000;                                                             // the last block the transaction is valid for

Deno.test("in a block, confirmed: landed", async () => is(await look(node({ err: null, confirmationStatus: "confirmed" }, 900, 950), "sig", LAST), "landed", "confirmed"));
Deno.test("in a block, final: landed", async () => is(await look(node({ err: null, confirmationStatus: "finalized" }, 2000, 2100), "sig", LAST), "landed", "final"));
Deno.test("only just processed: not decided yet", async () => is(await look(node({ err: null, confirmationStatus: "processed" }, 900, 950), "sig", LAST), "unknown", "processed"));
Deno.test("rejected, but not final: not decided yet (the block could still be dropped and the transaction run again)", async () => {
  is(await look(node({ err: { InstructionError: [2, "Custom"] }, confirmationStatus: "processed" }, 900, 950), "sig", LAST), "unknown", "rejected at processed");
  is(await look(node({ err: { InstructionError: [2, "Custom"] }, confirmationStatus: "confirmed" }, 900, 950), "sig", LAST), "unknown", "rejected at confirmed");
});
Deno.test("rejected, and final: failed", async () => is(await look(node({ err: { InstructionError: [2, "Custom"] }, confirmationStatus: "finalized" }, 900, 950), "sig", LAST), "rejected", "rejected for good"));
Deno.test("never seen while it can still arrive: not decided yet", async () => {
  is(await look(node(null, 990, 1040), "sig", LAST), "unknown", "before its last block");
  is(await look(node(null, 1000, 1050), "sig", LAST), "unknown", "at its last block");
});
Deno.test("never seen and its time is over: never", async () => is(await look(node(null, 1001, 1051), "sig", LAST), "never", "after its last block"));
Deno.test("never seen, by a node that is behind the block that ends its time: not decided yet", async () => {
  is(await look(node(null, 1200, 1300, 1299), "sig", LAST), "unknown", "one slot behind");
  is(await look(node(null, 1200, 1300, 700), "sig", LAST), "unknown", "far behind");
});
Deno.test("no last block written down: never decided as failed", async () => is(await look(node(null, 5000, 5100), "sig", null), "unknown", "no last block"));
Deno.test("an answer with holes in it: not decided", async () => {
  const holes = { getEpochInfo: () => Promise.resolve({}), getSignatureStatuses: () => Promise.resolve({ value: [null] }) };
  is(await look(holes, "sig", LAST), "unknown", "holes");
});

Deno.test("two nodes, both say never and over: failed", async () => is(await fate([node(null, 1100, 1200), node(null, 1101, 1201)], "sig", LAST), "failed", "both"));
Deno.test("two nodes, one cannot be reached: not decided - coins are not given back on one node's word", async () => is(await fate([node(null, 1100, 1200), dead], "sig", LAST), "unknown", "one dead"));
Deno.test("two nodes, one is behind: not decided", async () => is(await fate([node(null, 1100, 1200), node(null, 990, 1040)], "sig", LAST), "unknown", "one behind"));
Deno.test("two nodes, one has it in a block and the other never saw it: landed", async () => is(await fate([node(null, 1100, 1200), node({ err: null, confirmationStatus: "finalized" }, 1100, 1200)], "sig", LAST), "landed", "one saw it"));
Deno.test("two nodes, one has it in a block and the other cannot be reached: landed", async () => is(await fate([dead, node({ err: null, confirmationStatus: "confirmed" }, 900, 950)], "sig", LAST), "landed", "one saw it, one dead"));
Deno.test("two nodes, one saw it rejected for good and the other never saw it: failed", async () => is(await fate([node({ err: "x", confirmationStatus: "finalized" }, 1100, 1200), node(null, 1100, 1200)], "sig", LAST), "failed", "rejected and never"));
Deno.test("two nodes, rejected but not yet final on one: not decided", async () => is(await fate([node({ err: "x", confirmationStatus: "confirmed" }, 1100, 1200), node(null, 1100, 1200)], "sig", LAST), "unknown", "rejected, not final"));
Deno.test("two nodes that contradict each other: not decided", async () => is(await fate([node({ err: "x", confirmationStatus: "finalized" }, 1100, 1200), node({ err: null, confirmationStatus: "finalized" }, 1100, 1200)], "sig", LAST), "unknown", "contradiction"));
Deno.test("no node at all: not decided", async () => is(await fate([], "sig", LAST), "unknown", "none"));
Deno.test("one node only, never and over: failed", async () => is(await fate([node(null, 1100, 1200)], "sig", LAST), "failed", "alone"));
