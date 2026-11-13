// A reply may state only what the ledger says, and may only trigger actions on the list.
import type { AccountFacts, ReplyDraft } from "../domain/types.ts";
import { formatEuro } from "./aml.ts";

export const ALLOWED_ACTIONS = new Set(["send_statement_copy"]); // everything else goes to a person

export function factProblems(draft: ReplyDraft, facts: AccountFacts): string[] {
  const out: string[] = [];
  const amounts = new Set([
    ...facts.lastTransfers.map((t) => formatEuro(t.amountCents)),
    formatEuro(facts.creditLimitCents),
  ]);
  for (const a of draft.reply.match(/EUR [0-9]+\.[0-9]{2}/g) ?? []) if (!amounts.has(a)) out.push(`amount ${a} is not in the ledger`);
  const refs = new Set(facts.lastTransfers.map((t) => t.reference));
  for (const r of draft.reply.match(/\bREF-[A-Z0-9]+\b/g) ?? []) if (!refs.has(r)) out.push(`reference ${r} is not in the ledger`);
  for (const iban of draft.reply.match(/\bDE[0-9]{20}\b/g) ?? []) if (iban !== facts.iban) out.push("an IBAN that is not the customer's");
  const statuses = ["booked", "pending", "returned"] as const;
  for (const s of statuses) {
    if (draft.reply.includes(`is ${s}`) && !facts.lastTransfers.some((t) => t.status === s))
      out.push(`says a transfer is ${s}; none is`);
  }
  if (draft.reply.includes("card is") && !draft.reply.includes(`card is ${facts.cardStatus}`)) out.push("card status differs from the card system");
  return out;
}

export function actionProblems(draft: ReplyDraft): string[] {
  return draft.actions.filter((a) => !ALLOWED_ACTIONS.has(a)).map((a) => `action ${a} is not something an assistant may do`);
}
