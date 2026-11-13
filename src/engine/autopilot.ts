// The operations autopilot: intake reads every case with the model, code checks the reading and sets the deadline,
// people work a queue ordered by deadline, and effects leave through the outbox only after the rules allow them.
//
// Three designs share this code so they can be compared on the same cases:
//   manual     - no model; people read everything; first in, first out
//   autopilot  - model drafts, code checks, earliest deadline first, auto-send only for grounded replies
//   unchecked  - model drafts and its output is acted on without the code checks (the ablation)
import type {
  AccountFacts, AmlAlert, AmlReading, Case, Dispute, DisputeReading, DisputeReason, Enquiry, Kind, ReplyDraft,
} from "../domain/types.ts";
import { amlFacts, disagreements, riskScore } from "../checks/aml.ts";
import { endOfBusinessDays, reasonProblems, schemeDeadline, type LedgerView } from "../checks/dispute.ts";
import { actionProblems, factProblems } from "../checks/reply.ts";
import { goamlReport } from "../effects/goaml.ts";
import { Outbox } from "../effects/outbox.ts";
import type { ModelClient } from "../model/client.ts";
import type { Settings } from "../settings.ts";
import { Audit } from "../store/audit.ts";

export type Design = "manual" | "autopilot" | "unchecked";
export type Step = "aml_review" | "aml_second" | "dispute_review" | "enquiry_reply";

export interface Task {
  id: string;
  caseId: string;
  kind: Kind;
  step: Step;
  enqueuedAt: Date;
  deadline: Date;
  risk: number;
  remaining: number | null; // hours of work left; set when a person picks it up
  assisted: boolean; // a checked draft is attached
  problems: string[]; // what code found wrong with the draft, shown to the person
  draft?: AmlReading | DisputeReading | ReplyDraft;
  escalated: boolean;
}

export interface PersonOutcome {
  suspicious?: boolean;
  reason?: DisputeReason;
  reply?: string;
}

/** The people doing the work. The world supplies them; the autopilot only asks. */
export interface People {
  hoursFor(task: Task): number;
  decide(task: Task, c: Case): PersonOutcome;
}

export interface Systems {
  ledger: LedgerView;
  facts(account: string): AccountFacts;
}

const HOUR = 3_600_000;
const BUSINESS_START = 9;
const BUSINESS_END = 17;

export function businessDeadline(from: Date, hours: number): Date {
  const d = new Date(from);
  let left = hours * HOUR;
  for (;;) {
    const wd = d.getUTCDay();
    const h = d.getUTCHours() + d.getUTCMinutes() / 60;
    if (wd === 0 || wd === 6 || h >= BUSINESS_END) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(BUSINESS_START, 0, 0, 0);
      continue;
    }
    if (h < BUSINESS_START) d.setUTCHours(BUSINESS_START, 0, 0, 0);
    const untilClose = (BUSINESS_END - (d.getUTCHours() + d.getUTCMinutes() / 60)) * HOUR;
    if (left <= untilClose) return new Date(d.getTime() + left);
    left -= untilClose;
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(BUSINESS_START, 0, 0, 0);
  }
}

export class Autopilot {
  readonly audit = new Audit();
  readonly outbox = new Outbox(this.audit);
  readonly queue: Task[] = [];
  readonly cases = new Map<string, Case>();
  readonly refunded = new Set<string>();
  escalations = 0;
  readonly caught = new Map<string, number>(); // what the code checks found in the model's drafts, by kind
  hoursWorked = 0;
  autoHandled = 0;

  constructor(
    readonly design: Design,
    private readonly settings: Settings,
    private readonly model: ModelClient | null,
    private readonly systems: Systems,
    private readonly reportingEntityId = "SOLARIS-FIU-0001",
  ) {}

  private count(problems: string[]): void {
    for (const p of problems) {
      const kind = p.replace(/: .*$/, "").replace(/amount EUR [0-9.,]+/g, "an amount").replace(/EUR [0-9.,]+/g, "an amount").replace(/REF-[A-Z0-9]+/g, "a reference");
      this.caught.set(kind, (this.caught.get(kind) ?? 0) + 1);
    }
  }

  private enqueue(c: Case, step: Step, now: Date, deadline: Date, extra: Partial<Task> = {}): Task {
    const t: Task = {
      id: `${c.id}:${step}`, caseId: c.id, kind: c.kind, step, enqueuedAt: now, deadline, risk: 0,
      remaining: null, assisted: false, problems: [], escalated: false, ...extra,
    };
    this.queue.push(t);
    if (step !== "aml_second") this.count(t.problems);
    this.audit.record(now, c.id, "queued", { step, deadline: deadline.toISOString(), problems: t.problems });
    return t;
  }

  async intake(c: Case, now: Date): Promise<void> {
    this.cases.set(c.id, c);
    this.audit.record(now, c.id, "received", { kind: c.kind });
    if (c.kind === "aml") return this.intakeAml(c, now);
    if (c.kind === "dispute") return this.intakeDispute(c, now);
    return this.intakeEnquiry(c, now);
  }

  private async intakeAml(a: AmlAlert, now: Date): Promise<void> {
    const facts = amlFacts(a);
    const deadline = new Date(Date.parse(a.raisedAt) + this.settings.aml.decision_days * 24 * HOUR);
    if (this.design === "manual" || !this.model) {
      this.enqueue(a, "aml_review", now, deadline, { risk: riskScore(facts) });
      return;
    }
    const reading = await this.model.readAml(a);
    const problems = this.design === "autopilot" ? disagreements(reading, facts, a) : [];
    this.audit.record(now, a.id, "model_read", { suspicious: reading.suspicious, indicators: reading.indicators, problems });
    this.enqueue(a, "aml_review", now, deadline, {
      risk: riskScore(facts) + (reading.suspicious ? 1 : 0), assisted: true, problems, draft: reading,
    });
  }

  private async intakeDispute(d: Dispute, now: Date): Promise<void> {
    const s = this.settings.disputes;
    const scheme = new Date(schemeDeadline(d, s.scheme_deadline_days).getTime() - s.scheme_safety_days * 24 * HOUR);
    const refundBy = endOfBusinessDays(new Date(d.raisedAt), s.psd2_refund_business_days);
    if (this.design === "manual" || !this.model) {
      this.enqueue(d, "dispute_review", now, new Date(Math.min(scheme.getTime(), refundBy.getTime())));
      return;
    }
    const reading = await this.model.readDispute(d);
    const problems = this.design === "autopilot" ? reasonProblems(d, reading, this.systems.ledger) : [];
    this.audit.record(now, d.id, "model_read", { reason: reading.reason, evidence: reading.evidence, problems });
    if (reading.reason === "fraud" && problems.length === 0) this.refund(d, now, "model reading passed the checks");
    if (this.design === "unchecked") {
      this.fileChargeback(d, reading.reason, now, "model");
      this.autoHandled += 1;
      return;
    }
    const deadline = this.refunded.has(d.id) || reading.reason !== "fraud" ? scheme : new Date(Math.min(scheme.getTime(), refundBy.getTime()));
    this.enqueue(d, "dispute_review", now, deadline, { assisted: true, problems, draft: reading });
  }

  private async intakeEnquiry(e: Enquiry, now: Date): Promise<void> {
    const deadline = businessDeadline(new Date(e.raisedAt), this.settings.enquiries.first_response_hours);
    if (this.design === "manual" || !this.model) {
      this.enqueue(e, "enquiry_reply", now, deadline);
      return;
    }
    const facts = this.systems.facts(e.account);
    const draft = await this.model.draftReply(e, facts);
    if (this.design === "unchecked") {
      this.sendReply(e, draft.reply, now, "model");
      for (const a of draft.actions) this.outbox.put("account_action", e.id, a, now);
      this.autoHandled += 1;
      return;
    }
    const problems = [...factProblems(draft, facts), ...actionProblems(draft)];
    const auto = this.settings.enquiries.auto_send && problems.length === 0 &&
      this.settings.enquiries.auto_send_intents.includes(draft.intent);
    this.audit.record(now, e.id, "model_read", { intent: draft.intent, actions: draft.actions, problems, auto });
    if (auto) {
      this.sendReply(e, draft.reply, now, "checked draft");
      for (const a of draft.actions) this.outbox.put("account_action", e.id, a, now);
      this.autoHandled += 1;
      return;
    }
    this.enqueue(e, "enquiry_reply", now, deadline, { assisted: true, problems, draft });
  }

  /** Order the queue: by deadline (and risk) or first in, first out. */
  ordered(now: Date): Task[] {
    const slack = this.settings.scheduling.at_risk_slack_hours * HOUR;
    for (const t of this.queue) {
      const left = t.deadline.getTime() - now.getTime() - (t.remaining ?? 0) * HOUR;
      if (!t.escalated && left < slack) {
        t.escalated = true;
        this.escalations += 1;
        this.audit.record(now, t.caseId, "escalated", { step: t.step, hoursLeft: Math.round(left / HOUR) });
      }
    }
    const byDeadline = this.design !== "manual" && this.settings.scheduling.policy === "earliest_deadline";
    return [...this.queue].sort((a, b) =>
      byDeadline
        ? a.deadline.getTime() - b.deadline.getTime() || b.risk - a.risk || a.enqueuedAt.getTime() - b.enqueuedAt.getTime()
        : a.enqueuedAt.getTime() - b.enqueuedAt.getTime() || a.id.localeCompare(b.id),
    );
  }

  /** One hour of work by the team: `capacity` person-hours spread over the queue in order. */
  work(now: Date, capacity: number, people: People): void {
    let left = capacity;
    for (const t of this.ordered(now)) {
      if (left <= 0) break;
      if (t.remaining === null) t.remaining = people.hoursFor(t);
      const used = Math.min(left, t.remaining);
      t.remaining -= used;
      left -= used;
      this.hoursWorked += used;
      if (t.remaining <= 1e-9) this.complete(t, people.decide(t, this.cases.get(t.caseId)!), now);
    }
  }

  private complete(t: Task, out: PersonOutcome, now: Date): void {
    this.queue.splice(this.queue.indexOf(t), 1);
    const c = this.cases.get(t.caseId)!;
    this.audit.record(now, c.id, "decided", { step: t.step, by: "person", ...out });
    if (t.step === "aml_review") {
      if (!out.suspicious) return;
      if (this.settings.aml.four_eyes) {
        this.enqueue(c, "aml_second", now, new Date(now.getTime() + this.settings.aml.sar_filing_hours * HOUR), {
          draft: t.draft, assisted: t.assisted, risk: t.risk,
        });
      } else this.fileSar(c as AmlAlert, t.draft as AmlReading | undefined, now);
    } else if (t.step === "aml_second") {
      this.fileSar(c as AmlAlert, t.draft as AmlReading | undefined, now);
    } else if (t.step === "dispute_review") {
      const reason = out.reason!;
      if (reason === "fraud") this.refund(c as Dispute, now, "person");
      this.fileChargeback(c as Dispute, reason, now, "person");
    } else {
      this.sendReply(c as Enquiry, out.reply ?? "", now, "person");
    }
  }

  private fileSar(a: AmlAlert, reading: AmlReading | undefined, now: Date): void {
    const narrative = reading && disagreements(reading, amlFacts(a), a).length === 0 ? reading.narrative
      : `Alert ${a.scenario} on account ${a.account}; reviewed by two analysts.`;
    this.outbox.put("sar_filing", a.id, goamlReport(a, narrative, this.reportingEntityId, now.toISOString()), now);
  }

  private refund(d: Dispute, now: Date, why: string): void {
    if (this.refunded.has(d.id)) return;
    this.refunded.add(d.id);
    this.outbox.put("provisional_refund", d.id, JSON.stringify({ amountCents: Math.abs(d.txn.amountCents), why }), now);
  }

  private fileChargeback(d: Dispute, reason: DisputeReason, now: Date, by: string): void {
    this.outbox.put("chargeback", d.id, JSON.stringify({ txn: d.txn.id, reason, amountCents: Math.abs(d.txn.amountCents), by }), now);
  }

  private sendReply(e: Enquiry, reply: string, now: Date, by: string): void {
    this.outbox.put("reply", e.id, JSON.stringify({ reply, by }), now);
  }
}
