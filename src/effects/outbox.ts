// Effects (a SAR to the FIU, a chargeback to the card scheme, a refund, a reply) leave through the outbox. One is
// done when the receiver confirms it; until then it is retried with the same key, so it happens once.
import type { Audit } from "../store/audit.ts";

export type EffectKind = "sar_filing" | "chargeback" | "provisional_refund" | "reply" | "account_action";

export interface Effect {
  key: string; // idempotency key
  kind: EffectKind;
  caseId: string;
  payload: string;
  createdAt: string;
  confirmedAt?: string;
  attempts: number;
}

export interface Transport {
  send(e: Effect, now: Date): { confirmed: boolean };
}

export class Outbox {
  private readonly pending = new Map<string, Effect>();
  readonly done: Effect[] = [];

  constructor(private readonly audit: Audit) {}

  put(kind: EffectKind, caseId: string, payload: string, now: Date): Effect {
    const key = `${kind}:${caseId}`;
    const existing = this.pending.get(key) ?? this.done.find((e) => e.key === key);
    if (existing) return existing;
    const e: Effect = { key, kind, caseId, payload, createdAt: now.toISOString(), attempts: 0 };
    this.pending.set(key, e);
    this.audit.record(now, caseId, "effect_queued", { key, kind });
    return e;
  }

  flush(transport: Transport, now: Date): number {
    let n = 0;
    for (const [key, e] of this.pending) {
      e.attempts += 1;
      if (transport.send(e, now).confirmed) {
        e.confirmedAt = now.toISOString();
        this.pending.delete(key);
        this.done.push(e);
        this.audit.record(now, e.caseId, "effect_confirmed", { key, attempts: e.attempts });
        n += 1;
      }
    }
    return n;
  }

  get waiting(): number {
    return this.pending.size;
  }
}
