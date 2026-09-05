import type { GatewayConfig } from "./config.js";

export type MinerRecord = {
  miner_id: string;
  name: string | null;
  active: boolean;
  raw: Record<string, unknown>;
};

type Snapshot = { miners: MinerRecord[]; observedAt: string };

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
}

/** Pulls the miner list for an intent, tolerating the several shapes the free discovery endpoint has used. */
export function parseMiners(payload: unknown): MinerRecord[] {
  const container = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(container.miners)
      ? container.miners
      : Array.isArray(container.data)
        ? container.data
        : [];
  const out: MinerRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const id = asString(record.miner_id ?? record.id ?? record.minerId);
    if (!id) continue;
    const active = record.active ?? record.is_active ?? record.status;
    out.push({
      miner_id: id,
      name: asString(record.name ?? record.miner_name ?? record.slug),
      active: active === undefined ? true : active === true || active === "active" || active === "ACTIVE",
      raw: record
    });
  }
  return out;
}

/**
 * Caches free discovery for a short TTL and keeps the last good snapshot. The
 * registry answered in 0.9 s on most probes and 6.1 s on one, so a live lookup
 * on the paid path would be a needless source of timeouts.
 */
export class MinerRegistry {
  private readonly cache = new Map<string, { snapshot: Snapshot; expiresAt: number }>();
  private readonly lastGood = new Map<string, Snapshot>();

  constructor(
    private readonly config: GatewayConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now()
  ) {}

  async minersFor(intent: string): Promise<Snapshot> {
    const cached = this.cache.get(intent);
    if (cached && cached.expiresAt > this.now()) return cached.snapshot;
    const url = `${this.config.engineBaseUrl}/v1/intents/${encodeURIComponent(intent)}/miners`;
    try {
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`registry HTTP ${response.status}`);
      const snapshot: Snapshot = {
        miners: parseMiners(await response.json()),
        observedAt: new Date(this.now()).toISOString()
      };
      this.cache.set(intent, { snapshot, expiresAt: this.now() + this.config.registryTtlMs });
      this.lastGood.set(intent, snapshot);
      return snapshot;
    } catch (error) {
      const fallback = this.lastGood.get(intent);
      if (fallback) return fallback;
      throw error;
    }
  }

  /**
   * Picks a direct-fallback miner. Rank is deliberately not consulted: the one
   * settled routed call returned the observed rank two miner, so a cached
   * leaderboard position is not a reliable predictor of anything.
   */
  async fallbackCandidate(intent: string, exclude: string | null): Promise<MinerRecord | null> {
    const { miners } = await this.minersFor(intent);
    return miners.find((miner) => miner.active && miner.miner_id !== exclude) ?? null;
  }

  async health(): Promise<{ reachable: boolean; intents_cached: number; error: string | null }> {
    try {
      const response = await this.fetchImpl(`${this.config.engineBaseUrl}/v1/intents`, {
        signal: AbortSignal.timeout(10_000)
      });
      return { reachable: response.ok, intents_cached: this.cache.size, error: response.ok ? null : `HTTP ${response.status}` };
    } catch (error) {
      return { reachable: false, intents_cached: this.cache.size, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
