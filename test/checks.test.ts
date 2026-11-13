import { describe, expect, it } from "vitest";
import { amlFacts, disagreements, riskScore, unsupportedAmounts } from "../src/checks/aml.ts";
import { endOfBusinessDays, reasonProblems } from "../src/checks/dispute.ts";
import { actionProblems, factProblems } from "../src/checks/reply.ts";
import type { AccountFacts, AmlAlert, Dispute, Txn } from "../src/domain/types.ts";

const tx = (id: string, cents: number, channel: Txn["channel"], hours: number, country = "DE", cp = "CP-1"): Txn => ({
  id, account: "A", at: new Date(Date.UTC(2026, 0, 5) + hours * 3_600_000).toISOString(), amountCents: cents, channel, counterparty: cp, country,
});
const alert = (t: Txn[]): AmlAlert => ({ kind: "aml", id: "AML-1", account: "A", raisedAt: "2026-01-10T06:00:00Z", scenario: "structuring", transactions: t });

describe("AML facts", () => {
  it("finds cash deposits kept just under the threshold", () => {
    const f = amlFacts(alert([tx("1", 950_000, "cash", 0), tx("2", 990_000, "cash", 20), tx("3", 945_000, "cash", 40)]));
    expect(f.structuring).toBe(true);
    expect(riskScore(f)).toBe(3);
  });
  it("finds money passed straight through and high-risk counterparties", () => {
    const f = amlFacts(alert([tx("1", 2_000_000, "sepa_instant", 0), tx("2", -1_900_000, "sepa_instant", 10, "IR")]));
    expect(f.passThrough && f.highRiskCountry).toBe(true);
  });
  it("flags narratives that cite money not in the alert, and disagreement either way", () => {
    const a = alert([tx("1", 50_000, "sepa", 0)]);
    expect(unsupportedAmounts("moved EUR 500.00 then EUR 9999.00.", a)).toEqual(["EUR 9999.00"]);
    const quiet = amlFacts(a);
    expect(disagreements({ suspicious: true, indicators: [], narrative: "EUR 500.00" }, quiet, a)).toEqual([
      "model says suspicious, no pattern in the transactions",
    ]);
  });
});

describe("dispute rules", () => {
  const card = tx("T1", -2_500, "card", 0, "DE", "Streaming Plus");
  const d: Dispute = { kind: "dispute", id: "D1", account: "A", raisedAt: "2026-01-06T10:00:00Z", txn: card, customerText: "x" };
  it("accepts a duplicate only if the ledger has the second charge", () => {
    const reading = { reason: "duplicate" as const, evidence: [] };
    expect(reasonProblems(d, reading, { transactionsOf: () => [card] })).toHaveLength(1);
    const twin = { ...card, id: "T2", at: tx("x", 0, "card", 3).at };
    expect(reasonProblems(d, reading, { transactionsOf: () => [card, twin] })).toHaveLength(0);
  });
  it("needs the customer's denial for fraud", () => {
    expect(reasonProblems(d, { reason: "fraud", evidence: [] }, { transactionsOf: () => [] })).toHaveLength(1);
  });
  it("counts business days over a weekend", () => {
    expect(endOfBusinessDays(new Date("2026-01-09T15:00:00Z"), 1).toISOString()).toBe("2026-01-12T23:59:59.000Z");
  });
});

describe("reply checks", () => {
  const facts: AccountFacts = { account: "A", iban: "DE00123456789012345678", cardStatus: "active", creditLimitCents: 300_000,
    lastTransfers: [{ reference: "REF-ABC", amountCents: 12_345, status: "pending", at: "2026-01-05T10:00:00Z" }] };
  it("passes a reply built from the ledger", () => {
    expect(factProblems({ intent: "transfer_status", reply: "Your transfer REF-ABC of EUR 123.45 is pending.", actions: [] }, facts)).toEqual([]);
  });
  it("catches a wrong amount, a wrong status and a made-up reference", () => {
    const p = factProblems({ intent: "transfer_status", reply: "Your transfer REF-XYZ of EUR 133.45 is booked.", actions: [] }, facts);
    expect(p).toHaveLength(3);
  });
  it("refuses actions an assistant may not take", () => {
    expect(actionProblems({ intent: "limit_increase", reply: "", actions: ["raise_limit", "send_statement_copy"] })).toHaveLength(1);
  });
});
