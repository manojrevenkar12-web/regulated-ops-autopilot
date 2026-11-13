// What code establishes about an AML alert from the transactions alone. The model's reading is compared with it;
// a person decides; nothing is filed without the facts below.
import type { AmlAlert, AmlReading, Txn } from "../domain/types.ts";

export const HIGH_RISK_COUNTRIES = new Set(["IR", "KP", "MM", "AF", "YE", "SY"]); // FATF call-for-action and similar
const CASH_THRESHOLD_CENTS = 1_000_000; // EUR 10,000: the identification threshold for cash
const STRUCTURING_BAND_CENTS = 100_000; // deposits within EUR 1,000 under the threshold
const STRUCTURING_MIN_COUNT = 3;
const PASS_THROUGH_SHARE = 0.9;
const PASS_THROUGH_HOURS = 48;

export interface AmlFacts {
  structuring: boolean;
  passThrough: boolean;
  highRiskCountry: boolean;
  totalInCents: number;
  totalOutCents: number;
}

export function amlFacts(alert: AmlAlert): AmlFacts {
  const t = alert.transactions;
  const cashNear = t.filter(
    (x) =>
      x.channel === "cash" &&
      x.amountCents > 0 &&
      x.amountCents < CASH_THRESHOLD_CENTS &&
      x.amountCents >= CASH_THRESHOLD_CENTS - STRUCTURING_BAND_CENTS,
  );
  const inflow = t.filter((x) => x.amountCents > 0);
  const totalIn = inflow.reduce((s, x) => s + x.amountCents, 0);
  const totalOut = -t.filter((x) => x.amountCents < 0).reduce((s, x) => s + x.amountCents, 0);
  const firstIn = inflow.length ? Math.min(...inflow.map((x) => Date.parse(x.at))) : Infinity;
  const outSoon = -t
    .filter((x) => x.amountCents < 0 && Date.parse(x.at) - firstIn <= PASS_THROUGH_HOURS * 3_600_000)
    .reduce((s, x) => s + x.amountCents, 0);
  return {
    structuring: cashNear.length >= STRUCTURING_MIN_COUNT,
    passThrough: totalIn > 0 && outSoon >= PASS_THROUGH_SHARE * totalIn,
    highRiskCountry: t.some((x: Txn) => HIGH_RISK_COUNTRIES.has(x.country)),
    totalInCents: totalIn,
    totalOutCents: totalOut,
  };
}

export function riskScore(f: AmlFacts): number {
  return Number(f.structuring) * 3 + Number(f.passThrough) * 2 + Number(f.highRiskCountry) * 2;
}

/** Amounts in a narrative that are not in the alert's transactions: a narrative may only cite real money. */
export function unsupportedAmounts(narrative: string, alert: AmlAlert): string[] {
  const known = new Set(alert.transactions.map((x) => Math.abs(x.amountCents)));
  const found = narrative.match(/EUR\s?[0-9][0-9,]*(?:\.[0-9]{2})?/g) ?? [];
  return found.filter((s) => !known.has(parseEuro(s)));
}

export function parseEuro(s: string): number {
  const digits = s.replace(/EUR\s?/, "").replace(/,/g, "");
  return Math.round(Number(digits) * 100);
}

export function formatEuro(cents: number): string {
  return `EUR ${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** Where the model and the facts disagree: shown to the reviewer first. */
export function disagreements(reading: AmlReading, f: AmlFacts, alert: AmlAlert): string[] {
  const out: string[] = [];
  if (!reading.suspicious && riskScore(f) >= 3) out.push("model says not suspicious, facts score high");
  if (reading.suspicious && riskScore(f) === 0) out.push("model says suspicious, no pattern in the transactions");
  const unsupported = unsupportedAmounts(reading.narrative, alert);
  if (unsupported.length) out.push(`narrative cites amounts not in the alert: ${unsupported.join(", ")}`);
  return out;
}
