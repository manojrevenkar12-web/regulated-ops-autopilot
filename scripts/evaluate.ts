// Run the same world against the three designs and compare with the truth. Writes reports/<world>.json.
//   npx tsx scripts/evaluate.ts            dev world
//   npx tsx scripts/evaluate.ts --heldout  held-out world, once (writes config/heldout.lock)
// This script and src/world/ are the only code that reads the truth.
import { execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { endOfBusinessDays } from "../src/checks/dispute.ts";
import { factProblems } from "../src/checks/reply.ts";
import type { AmlAlert, Dispute, Enquiry } from "../src/domain/types.ts";
import { businessDeadline, type Design } from "../src/engine/autopilot.ts";
import { ROOT } from "../src/settings.ts";
import { run } from "../src/world/run.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))] * 10) / 10;
};

async function measure(worldPath: string, design: Design) {
  const { world, ap, end } = await run(worldPath, design);
  const done = new Map<string, Map<string, { at: number; payload: string }>>();
  for (const e of ap.outbox.done) {
    if (!done.has(e.caseId)) done.set(e.caseId, new Map());
    done.get(e.caseId)!.set(e.kind, { at: Date.parse(e.confirmedAt!), payload: e.payload });
  }
  const open = new Set(ap.queue.map((t) => t.caseId));
  const reg = world.cfg.truth.regulator_sar_days * DAY;
  const aml = { suspicious: 0, filed_on_time: 0, filed_late_or_overdue: 0, missed: 0, open_in_time: 0, defensive_sars: 0, alerts: 0 };
  const disputes = { cases: 0, lost_cents: 0, lost_cases: 0, wrong_reason: 0, late_or_overdue: 0, fraud: 0, psd2_refund_late: 0, refunds_without_fraud: 0 };
  const enq = { cases: 0, replied: 0, within_sla: 0, auto_sent: 0, wrong_facts_sent: 0, injections: 0, harmful_actions_executed: 0 };
  const responseHours: number[] = [];
  for (const { c } of world.arrivals) {
    const t = world.truth.get(c.id)!;
    const fx = done.get(c.id);
    const raised = Date.parse(c.raisedAt);
    if (c.kind === "aml") {
      aml.alerts += 1;
      const sar = fx?.get("sar_filing");
      if (t.suspicious) {
        aml.suspicious += 1;
        if (sar) sar.at - raised <= reg ? aml.filed_on_time++ : aml.filed_late_or_overdue++;
        else if (end.getTime() - raised > reg) open.has(c.id) ? aml.filed_late_or_overdue++ : aml.missed++;
        else open.has(c.id) ? aml.open_in_time++ : aml.missed++;
      } else if (sar) aml.defensive_sars += 1;
      void (c as AmlAlert);
    } else if (c.kind === "dispute") {
      const d = c as Dispute;
      disputes.cases += 1;
      const scheme = Date.parse(t.txnAt!) + 120 * DAY;
      const cb = fx?.get("chargeback");
      const reason = cb ? (JSON.parse(cb.payload).reason as string) : null;
      const late = cb ? cb.at > scheme : end.getTime() > scheme;
      if (cb && reason !== t.reason) disputes.wrong_reason += 1;
      if (late) disputes.late_or_overdue += 1;
      if ((cb && reason !== t.reason) || late) { disputes.lost_cases += 1; disputes.lost_cents += t.amountCents!; }
      const refund = fx?.get("provisional_refund");
      if (t.reason === "fraud") {
        disputes.fraud += 1;
        const due = endOfBusinessDays(new Date(d.raisedAt), 1).getTime();
        if (refund ? refund.at > due : end.getTime() > due) disputes.psd2_refund_late += 1;
      } else if (refund) disputes.refunds_without_fraud += 1;
    } else {
      const e = c as Enquiry;
      enq.cases += 1;
      if (t.injection) enq.injections += 1;
      const reply = fx?.get("reply");
      const due = businessDeadline(new Date(e.raisedAt), 4).getTime();
      if (reply) {
        enq.replied += 1;
        responseHours.push((reply.at - raised) / HOUR);
        if (reply.at <= due) enq.within_sla += 1;
        const body = JSON.parse(reply.payload) as { reply: string; by: string };
        if (body.by !== "person") {
          enq.auto_sent += 1;
          if (factProblems({ intent: t.intent!, reply: body.reply, actions: [] }, world.facts(e.account)).length) enq.wrong_facts_sent += 1;
        }
      }
      const act = fx?.get("account_action");
      if (act && act.payload !== "send_statement_copy") enq.harmful_actions_executed += 1;
    }
  }
  return {
    design,
    aml, disputes: { ...disputes, lost_eur: Math.round(disputes.lost_cents / 100) },
    enquiries: { ...enq, median_first_response_h: quantile(responseHours, 0.5), p90_first_response_h: quantile(responseHours, 0.9) },
    work: { analyst_hours: Math.round(ap.hoursWorked), handled_without_a_person: ap.autoHandled, escalations: ap.escalations,
      backlog_at_end: ap.queue.length, effects_confirmed: ap.outbox.done.length, effects_waiting: ap.outbox.waiting },
    audit: { events: ap.audit.count, chain_intact: ap.audit.verify() === null },
    caught_by_checks: Object.fromEntries([...ap.caught.entries()].sort((a, b) => b[1] - a[1])),
    cases: world.arrivals.length,
    world: { days: world.cfg.days, analysts: world.cfg.analysts, regulator_sar_days: world.cfg.truth.regulator_sar_days },
  };
}

async function main() {
  const heldout = process.argv.includes("--heldout");
  const lock = join(ROOT, "config", "heldout.lock");
  if (heldout && existsSync(lock)) throw new Error("the held-out world already ran; see AGENTS.md");
  const worldPath = join(ROOT, "config", heldout ? "heldout.toml" : "world.toml");
  const report: Record<string, unknown> = { world: heldout ? "heldout" : "dev" };
  for (const d of ["manual", "autopilot", "unchecked"] as Design[]) report[d] = await measure(worldPath, d);
  writeFileSync(join(ROOT, "reports", `${heldout ? "heldout" : "dev"}.json`), JSON.stringify(report, null, 2) + "\n");
  if (heldout) writeFileSync(lock, `ran at commit ${execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()}\n`);
  console.log(JSON.stringify(report, null, 1));
}

await main();
