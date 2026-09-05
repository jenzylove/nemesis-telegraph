/**
 * How a Telegraph answer is allowed to read on screen.
 *
 * The rule this file exists to enforce: an external miner that found nothing,
 * failed, or would not commit must never render as an address being clean. Only
 * a real returned risk figure earns a risk verdict, and proof is only claimed
 * where Telegraph actually returned proof.
 */

export function telegraphVerdict(receipt) {
  if (!receipt || receipt.status !== "SUCCEEDED") return { tone: "failed", text: "No answer" };
  if (receipt.label === "NO_EXTERNAL_SIGNAL") return { tone: "unknown", text: "No external signal" };
  if (typeof receipt.risk_score === "number") {
    return { tone: receipt.risk_score >= 0.5 ? "risk" : "low", text: `${receipt.label || "Risk"} · ${receipt.risk_score.toFixed(2)}` };
  }
  return { tone: "info", text: receipt.label || "Answered" };
}

/** Proof is shown only when Telegraph returned something to point at. */
export function telegraphProof(receipt) {
  const settlement = receipt?.payment?.settlement_transaction || null;
  const signal = receipt?.signal_hash || null;
  return { settlement, signal, hasProof: Boolean(settlement || signal) };
}

export function shortHex(value) {
  if (!value) return "—";
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
