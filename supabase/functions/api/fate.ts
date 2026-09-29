// What became of a transaction that was handed to the network. Kept apart from everything else so that it can be tested on its own (../tests/fate_test.ts).
export type Fate = "landed" | "failed" | "unknown";
/** landed: it is in a block. rejected: it ran, was refused, and that is final. never: it was not seen and its time is over. unknown: it may still go either way. */
export type Seen = "landed" | "rejected" | "never" | "unknown";
const short = (e: unknown) => String(e).slice(0, 300);

/**
 * What one node says.
 * "rejected" is only answered when the transaction ran, was refused, and that is final: before that, its block can still be dropped and the transaction run again.
 * "never" is only answered when it was not seen and can no longer run at all: a final block past the last one it was valid for exists,
 * and the node that says "not seen" has itself seen that block. A node that is merely behind therefore answers "unknown".
 */
// deno-lint-ignore no-explicit-any
export async function look(conn: any, sig: string, lastValid: number | null): Promise<Seen> {
  const final = await conn.getEpochInfo("finalized");                          // a slot and its block height, out of one answer
  const res = await conn.getSignatureStatuses([sig], { searchTransactionHistory: true });
  const st = res?.value?.[0];
  if (st) {
    if (st.confirmationStatus === "finalized") return st.err ? "rejected" : "landed";
    return !st.err && st.confirmationStatus === "confirmed" ? "landed" : "unknown";
  }
  if (lastValid == null || !Number.isFinite(final?.blockHeight) || !Number.isFinite(final?.absoluteSlot) || !Number.isFinite(res?.context?.slot)) return "unknown";
  return final.blockHeight > lastValid && res.context.slot >= final.absoluteSlot ? "never" : "unknown";
}

/**
 * What every node there is says, taken together. Coins go back only when every single one says that the transfer did not and cannot happen.
 * A node that holds the transaction in a block outweighs one that never saw it: the first has a record, the second only lacks one.
 * A node that cannot be reached, or two that contradict each other outright, leave the question open.
 */
// deno-lint-ignore no-explicit-any
export async function fate(all: any[], sig: string, lastValid: number | null): Promise<Fate> {
  if (!all.length) return "unknown";
  const said = await Promise.all(all.map((c) => look(c, sig, lastValid).catch((e) => { console.error("fate", short(e)); return "unreachable"; })));
  const landed = said.includes("landed");
  if (landed && said.includes("rejected")) { console.error("fate: the nodes contradict each other about " + sig, said.join(", ")); return "unknown"; }
  if (landed) return "landed";
  return said.every((s) => s === "rejected" || s === "never") ? "failed" : "unknown";
}
