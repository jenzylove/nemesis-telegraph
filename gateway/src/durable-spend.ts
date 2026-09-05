/**
 * A daily spend ceiling that survives restarts.
 *
 * The in-memory ledger bounds one container lifetime. On Cloud Run with
 * min-instances 0 the container is torn down whenever it goes idle, so every
 * cold start began the day again at zero and the daily cap stopped meaning
 * anything. That is not a theoretical gap: it let a run settle more calls than
 * the ceiling allowed.
 *
 * The counter therefore lives in Firestore, incremented server-side so
 * concurrent writers cannot lose an update. Reads are cached briefly because
 * payments are serialized anyway.
 */
const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

export class DurableDailySpend {
  private cachedToken: { value: string; expiresAt: number } | null = null;
  private cachedTotal: { day: string; value: number; readAt: number } | null = null;

  constructor(
    private readonly projectId: string,
    private readonly database: string,
    private readonly collection = "telegraph_spend",
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date()
  ) {}

  get configured(): boolean {
    return Boolean(this.projectId && this.database);
  }

  private day(): string {
    return this.now().toISOString().slice(0, 10);
  }

  private base(): string {
    return `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/${this.database}/documents`;
  }

  private async token(): Promise<string | null> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) return this.cachedToken.value;
    try {
      const response = await this.fetchImpl(METADATA_TOKEN_URL, {
        headers: { "Metadata-Flavor": "Google" },
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { access_token?: string; expires_in?: number };
      if (!body.access_token) return null;
      this.cachedToken = {
        value: body.access_token,
        expiresAt: Date.now() + Math.max(60, (body.expires_in ?? 600) - 60) * 1000
      };
      return this.cachedToken.value;
    } catch {
      return null;
    }
  }

  /**
   * Today's settled spend, or null when the store cannot be reached.
   *
   * Null is not zero. The caller must refuse to pay rather than assume the
   * budget is untouched.
   */
  async total(): Promise<number | null> {
    const day = this.day();
    if (this.cachedTotal && this.cachedTotal.day === day && Date.now() - this.cachedTotal.readAt < 2000) {
      return this.cachedTotal.value;
    }
    const access = await this.token();
    if (!access) return null;
    try {
      const response = await this.fetchImpl(`${this.base()}/${this.collection}/${day}`, {
        headers: { authorization: "Bearer " + access },
        signal: AbortSignal.timeout(8000)
      });
      if (response.status === 404) {
        this.cachedTotal = { day, value: 0, readAt: Date.now() };
        return 0;
      }
      if (!response.ok) return null;
      const body = (await response.json()) as { fields?: { spent_usd?: { doubleValue?: number; integerValue?: string } } };
      const field = body.fields?.spent_usd;
      const value = field?.doubleValue ?? (field?.integerValue ? Number(field.integerValue) : 0);
      this.cachedTotal = { day, value, readAt: Date.now() };
      return value;
    } catch {
      return null;
    }
  }

  /** Adds settled spend atomically. Returns false if it could not be recorded. */
  async add(amountUsd: number): Promise<boolean> {
    const access = await this.token();
    if (!access) return false;
    const day = this.day();
    const name = `projects/${this.projectId}/databases/${this.database}/documents/${this.collection}/${day}`;
    try {
      const response = await this.fetchImpl(
        `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/${this.database}/documents:commit`,
        {
          method: "POST",
          headers: { authorization: "Bearer " + access, "content-type": "application/json" },
          body: JSON.stringify({
            writes: [
              {
                transform: {
                  document: name,
                  fieldTransforms: [{ fieldPath: "spent_usd", increment: { doubleValue: amountUsd } }]
                }
              }
            ]
          }),
          signal: AbortSignal.timeout(8000)
        }
      );
      if (!response.ok) return false;
      this.cachedTotal = null;
      return true;
    } catch {
      return false;
    }
  }
}
