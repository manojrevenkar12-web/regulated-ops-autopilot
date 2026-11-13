// The ops API: cases in, the ordered queue out, decisions by people back in, the audit trail per case.
// Run with `npm run serve` (Claude through ANTHROPIC_API_KEY; config/ops.toml decides the model).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Case, DisputeReason } from "../domain/types.ts";
import { Autopilot, type People, type Task } from "../engine/autopilot.ts";
import { AnthropicClient } from "../model/client.ts";
import { loadSettings } from "../settings.ts";

type Json = Record<string, unknown> | unknown[];

export function handler(ap: Autopilot) {
  const decisions = new Map<string, { suspicious?: boolean; reason?: DisputeReason; reply?: string }>();
  // A person's decision arrives over the API; work() then completes the task with it.
  const people: People = {
    hoursFor: () => 0,
    decide: (t: Task) => decisions.get(t.id) ?? {},
  };
  const view = (t: Task) => ({ id: t.id, case: t.caseId, step: t.step, deadline: t.deadline.toISOString(),
    problems: t.problems, draft: t.draft ?? null, escalated: t.escalated });
  return async (method: string, path: string, body: Json | null): Promise<[number, Json]> => {
    const now = new Date();
    if (method === "POST" && path === "/cases") {
      await ap.intake(body as unknown as Case, now);
      return [202, { accepted: (body as { id: string }).id }];
    }
    if (method === "GET" && path === "/queue") return [200, ap.ordered(now).map(view)];
    const decide = path.match(/^\/tasks\/([^/]+)\/decision$/);
    if (method === "POST" && decide) {
      const task = ap.queue.find((t) => t.id === decodeURIComponent(decide[1]));
      if (!task) return [404, { error: "no such open task" }];
      decisions.set(task.id, body as never);
      task.remaining = 0;
      ap.work(now, Number.EPSILON, people);
      return [200, { done: task.id }];
    }
    const audit = path.match(/^\/cases\/([^/]+)\/audit$/);
    if (method === "GET" && audit) return [200, ap.audit.events(decodeURIComponent(audit[1]))];
    return [404, { error: "not found" }];
  };
}

async function readBody(req: IncomingMessage): Promise<Json | null> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as Json) : null;
}

if (process.argv[1]?.endsWith("server.ts")) {
  const s = loadSettings();
  const ap = new Autopilot("autopilot", s, new AnthropicClient(s.model.anthropic_model), {
    ledger: { transactionsOf: () => [] }, // wire to the core-banking read API
    facts: () => { throw new Error("wire to the account read API"); },
  });
  const handle = handler(ap);
  createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const [status, out] = await handle(req.method ?? "GET", req.url ?? "/", await readBody(req));
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(out));
  }).listen(Number(process.env.PORT ?? 8080));
}
