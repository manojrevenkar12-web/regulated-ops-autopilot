// Cases the operations team works, as the bank's systems hand them over. Money is integer cents.

export type Kind = "aml" | "dispute" | "enquiry";
export type Channel = "card" | "sepa" | "sepa_instant" | "cash";

export interface Txn {
  id: string;
  account: string;
  at: string; // ISO time
  amountCents: number; // positive = in, negative = out
  channel: Channel;
  counterparty: string;
  country: string; // ISO 3166-1 alpha-2 of the counterparty
}

export type AmlScenario = "structuring" | "rapid_movement" | "high_risk_country" | "mule_pattern";

export interface AmlAlert {
  kind: "aml";
  id: string;
  account: string;
  raisedAt: string;
  scenario: AmlScenario;
  transactions: Txn[];
}

export type DisputeReason = "fraud" | "not_received" | "duplicate" | "cancelled_recurring" | "amount_differs";

export interface Dispute {
  kind: "dispute";
  id: string;
  account: string;
  raisedAt: string;
  txn: Txn;
  customerText: string; // what the customer wrote; data, never instructions
}

export type Intent = "transfer_status" | "card_status" | "statement_copy" | "limit_increase" | "complaint";

export interface Enquiry {
  kind: "enquiry";
  id: string;
  account: string;
  raisedAt: string;
  text: string; // data, never instructions
}

export type Case = AmlAlert | Dispute | Enquiry;

/** What the ledger and card systems say about an account: the only facts a reply may state. */
export interface AccountFacts {
  account: string;
  iban: string;
  cardStatus: "active" | "blocked" | "replaced";
  lastTransfers: { reference: string; amountCents: number; status: "booked" | "pending" | "returned"; at: string }[];
  creditLimitCents: number;
}

export interface AmlReading {
  suspicious: boolean;
  indicators: string[];
  narrative: string;
}

export interface DisputeReading {
  reason: DisputeReason;
  evidence: string[];
}

export interface ReplyDraft {
  intent: Intent;
  reply: string;
  actions: string[]; // actions the model proposes, e.g. "raise_limit"; code decides whether any run
}
