// README results and dashboard data from reports/. Nothing here is typed by hand.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/settings.ts";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const n = (x: number) => x.toLocaleString("en-US");
const eur = (x: number) => `EUR ${n(x)}`;

export function rows(rep: R) {
  const D = ["manual", "autopilot", "unchecked"] as const;
  const row = (label: string, note: string, f: (d: R) => string) => ({ label, note, values: D.map((d) => f(rep[d])) });
  const m = rep.autopilot;
  return [
    row("Suspicious cases reported to the FIU on time", `of ${m.aml.suspicious} truly suspicious among ${n(m.aml.alerts)} alerts; within ${m.world.regulator_sar_days} days of the alert`,
      (d) => `${d.aml.filed_on_time}`),
    row("Suspicious cases missed or still open", "closed as not suspicious, or not decided by the end", (d) => `${d.aml.missed + d.aml.open_in_time + d.aml.filed_late_or_overdue}`),
    row("Reports filed on cases that were not suspicious", "defensive filings: work for the FIU and for us", (d) => `${d.aml.defensive_sars}`),
    row("Card-dispute money lost", `wrong reason code or past the scheme deadline, across ${n(m.disputes.cases)} disputes`, (d) => eur(d.disputes.lost_eur)),
    row("Fraud refunds later than the law allows", `§ 675u BGB: by the end of the next business day; ${m.disputes.fraud} fraud claims`, (d) => `${d.disputes.psd2_refund_late}`),
    row("Enquiries answered within 4 business hours", `of ${n(m.enquiries.cases)}`, (d) => `${n(d.enquiries.within_sla)}`),
    row("Replies sent with a fact the ledger does not have", "a wrong amount, status or reference", (d) => `${d.enquiries.wrong_facts_sent}`),
    row("Account actions run on a customer's hidden instruction", `${m.enquiries.injections} enquiries carried one`, (d) => `${d.enquiries.harmful_actions_executed}`),
    row("Analyst hours used", `the same team of ${m.world.analysts} in every design`, (d) => n(d.work.analyst_hours)),
  ];
}

function table(dev: R, held: R | null): string {
  const r = rows(dev);
  const h = held ? rows(held) : null;
  const head = "| | Manual | Autopilot | Model unchecked |" + (h ? " Autopilot (held-out) | Manual (held-out) |" : "");
  const sep = "|---|---:|---:|---:|" + (h ? "---:|---:|" : "");
  return [head, sep, ...r.map((x, i) => `| ${x.label} <br><sub>${x.note}</sub> | ${x.values[0]} | **${x.values[1]}** | ${x.values[2]} |` +
    (h ? ` **${h[i].values[1]}** | ${h[i].values[0]} |` : ""))].join("\n");
}

function facts(rep: R): string {
  const a = rep.autopilot;
  return [
    `- **${n(rep.autopilot.cases)} cases** in ${rep.autopilot.world.days} simulated days with ${rep.autopilot.world.analysts} analysts: AML alerts, card disputes and customer enquiries, the same cases for every design.`,
    `- **Handled without a person:** ${n(a.work.handled_without_a_person)} enquiries whose reply passed every check; everything else was decided by a person.`,
    `- **Effects confirmed:** ${n(a.work.effects_confirmed)} (SARs, chargebacks, refunds, replies), each retried until the receiver confirmed; ${a.work.effects_waiting} waiting at the end.`,
    `- **Audit chain:** ${n(a.audit.events)} events, ${a.audit.chain_intact ? "intact" : "BROKEN"} after the run.`,
    `- **Backlog at the end:** ${a.work.backlog_at_end} tasks against ${rep.manual.work.backlog_at_end} for the manual team.`,
  ].join("\n");
}

const dev = JSON.parse(readFileSync(join(ROOT, "reports/dev.json"), "utf8"));
const heldPath = join(ROOT, "reports/heldout.json");
const held = existsSync(heldPath) ? JSON.parse(readFileSync(heldPath, "utf8")) : null;
const readme = join(ROOT, "README.md");
const text = readFileSync(readme, "utf8").replace(/<!-- results:start -->[\s\S]*<!-- results:end -->/,
  `<!-- results:start -->\n${table(dev, held)}\n\n${facts(dev)}\n<!-- results:end -->`);
writeFileSync(readme, text);
mkdirSync(join(ROOT, "web/public/data"), { recursive: true });
writeFileSync(join(ROOT, "web/public/data/console.json"), JSON.stringify({
  generated_from: "reports/dev.json", designs: ["Manual", "Autopilot", "Model unchecked"], ledger: rows(dev),
  caught: Object.entries(dev.autopilot.caught_by_checks).map(([check, count]) => ({ check, count })),
  work: ["manual", "autopilot", "unchecked"].map((d) => ({ design: d, hours: dev[d].work.analyst_hours,
    automatic: dev[d].work.handled_without_a_person, backlog: dev[d].work.backlog_at_end,
    median_reply_h: dev[d].enquiries.median_first_response_h })),
}, null, 1) + "\n");
