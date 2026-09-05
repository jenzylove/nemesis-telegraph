/**
 * Spend ceilings for real money. The ledger is in memory, so a restart forgets
 * history; the ceilings still bound any single running instance and the daily
 * limit is deliberately small. Firestore-backed accounting is the follow-up if
 * the gateway ever scales past one instance.
 */
export class SpendLimitExceeded extends Error {
  readonly code = "SPEND_LIMIT_EXCEEDED";
}

type Ceilings = { perCallUsd: number; perCaseEventUsd: number; dailyUsd: number };

export class SpendLedger {
  private readonly perCaseEvent = new Map<string, number>();
  private dayKey = "";
  private dayTotal = 0;

  constructor(private readonly ceilings: Ceilings, private readonly now: () => Date = () => new Date()) {}

  private rollDay(): void {
    const key = this.now().toISOString().slice(0, 10);
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.dayTotal = 0;
    }
  }

  /** Throws before a call is made if it would breach any ceiling. */
  authorize(caseEventKey: string, quotedUsd: number): void {
    this.rollDay();
    if (quotedUsd > this.ceilings.perCallUsd) {
      throw new SpendLimitExceeded(`Quote ${quotedUsd} exceeds the ${this.ceilings.perCallUsd} per-call ceiling`);
    }
    const spentOnEvent = this.perCaseEvent.get(caseEventKey) ?? 0;
    if (spentOnEvent + quotedUsd > this.ceilings.perCaseEventUsd) {
      throw new SpendLimitExceeded(`Case event ${caseEventKey} would reach ${spentOnEvent + quotedUsd}, over the ${this.ceilings.perCaseEventUsd} ceiling`);
    }
    if (this.dayTotal + quotedUsd > this.ceilings.dailyUsd) {
      throw new SpendLimitExceeded(`Daily spend would reach ${this.dayTotal + quotedUsd}, over the ${this.ceilings.dailyUsd} ceiling`);
    }
  }

  /** Records a call that actually settled. Only settled spend counts. */
  record(caseEventKey: string, usd: number): void {
    this.rollDay();
    this.perCaseEvent.set(caseEventKey, (this.perCaseEvent.get(caseEventKey) ?? 0) + usd);
    this.dayTotal += usd;
  }

  snapshot() {
    this.rollDay();
    return { day: this.dayKey, spent_today_usd: Number(this.dayTotal.toFixed(6)), ceilings: this.ceilings };
  }
}

/**
 * Payments run one at a time. Parallel settlement behaviour is untested, and a
 * nonce race would cost real money to diagnose.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  get pending(): number {
    return this.depth;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    this.depth += 1;
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result.finally(() => {
      this.depth -= 1;
    });
  }
}
