// A suspicious-activity report in the shape of the FIU's goAML XML (report code STR), built only from facts.
import type { AmlAlert } from "../domain/types.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function goamlReport(alert: AmlAlert, narrative: string, reportingEntityId: string, at: string): string {
  const txns = alert.transactions
    .map(
      (t) =>
        `    <transaction><transactionnumber>${esc(t.id)}</transactionnumber>` +
        `<date_transaction>${t.at}</date_transaction><amount_local>${(Math.abs(t.amountCents) / 100).toFixed(2)}</amount_local>` +
        `<transmode_code>${t.channel}</transmode_code><counterparty>${esc(t.counterparty)}</counterparty>` +
        `<country>${t.country}</country><direction>${t.amountCents > 0 ? "in" : "out"}</direction></transaction>`,
    )
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<report>",
    `  <rentity_id>${esc(reportingEntityId)}</rentity_id>`,
    "  <submission_code>E</submission_code>",
    "  <report_code>STR</report_code>",
    `  <entity_reference>${esc(alert.id)}</entity_reference>`,
    `  <submission_date>${at}</submission_date>`,
    "  <currency_code_local>EUR</currency_code_local>",
    `  <reason>${esc(narrative)}</reason>`,
    `  <account>${esc(alert.account)}</account>`,
    "  <transactions>",
    txns,
    "  </transactions>",
    "</report>",
  ].join("\n");
}
