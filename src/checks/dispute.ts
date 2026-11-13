// A dispute reason is accepted only if the ledger supports it; the scheme and the law set the deadlines.
import type { Dispute, DisputeReading, DisputeReason, Txn } from "../domain/types.ts";

const DUPLICATE_WINDOW_HOURS = 48;
const DAY_MS = 86_400_000;

export interface LedgerView {
  transactionsOf(account: string): Txn[];
}

export function reasonProblems(d: Dispute, reading: DisputeReading, ledger: LedgerView): string[] {
  const out: string[] = [];
  const t = d.txn;
  const r: DisputeReason = reading.reason;
  if (r === "fraud" && t.channel !== "card") out.push("fraud reason on a transaction that is not a card payment");
  if (r === "fraud" && !reading.evidence.includes("customer_denies_authorisation"))
    out.push("fraud reason without the customer denying they authorised it");
  if (r === "duplicate") {
    const twin = ledger
      .transactionsOf(d.account)
      .some(
        (x) =>
          x.id !== t.id &&
          x.counterparty === t.counterparty &&
          x.amountCents === t.amountCents &&
          Math.abs(Date.parse(x.at) - Date.parse(t.at)) <= DUPLICATE_WINDOW_HOURS * 3_600_000,
      );
    if (!twin) out.push("duplicate reason but no second charge of the same amount from the same merchant in 48 h");
  }
  if (r === "not_received" && !reading.evidence.includes("expected_date_passed"))
    out.push("not-received reason without an expected delivery date that has passed");
  if (r === "cancelled_recurring" && !reading.evidence.includes("cancellation_before_charge"))
    out.push("cancelled-recurring reason without a cancellation before the charge");
  if (r === "amount_differs" && !reading.evidence.includes("amount_on_receipt_differs"))
    out.push("amount-differs reason without a receipt showing another amount");
  return out;
}

export function schemeDeadline(d: Dispute, deadlineDays: number): Date {
  return new Date(Date.parse(d.txn.at) + deadlineDays * DAY_MS);
}

/** End of the n-th business day after `from` (Mon–Fri; public holidays are not modelled). */
export function endOfBusinessDays(from: Date, n: number): Date {
  const d = new Date(from);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  d.setUTCHours(23, 59, 59, 0);
  return d;
}
