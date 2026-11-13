// Every decision and effect is a row in a hash chain (node:sqlite): who or what decided, on which facts, when.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export class Audit {
  private readonly db: DatabaseSync;
  private last = "genesis";
  private readonly insert;
  count = 0;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "create table if not exists audit (seq integer primary key, at text, case_id text, event text, body text, prev text, hash text)",
    );
    this.insert = this.db.prepare("insert into audit (at, case_id, event, body, prev, hash) values (?, ?, ?, ?, ?, ?)");
  }

  record(now: Date, caseId: string, event: string, body: unknown): void {
    const at = now.toISOString();
    const text = JSON.stringify(body);
    const hash = createHash("sha256").update(`${this.last}|${at}|${caseId}|${event}|${text}`).digest("hex");
    this.insert.run(at, caseId, event, text, this.last, hash);
    this.last = hash;
    this.count += 1;
  }

  /** Recompute the chain; returns the first broken sequence number, or null. */
  verify(): number | null {
    let prev = "genesis";
    const rows = this.db.prepare("select seq, at, case_id, event, body, prev, hash from audit order by seq").all() as {
      seq: number; at: string; case_id: string; event: string; body: string; prev: string; hash: string;
    }[];
    for (const r of rows) {
      const h = createHash("sha256").update(`${prev}|${r.at}|${r.case_id}|${r.event}|${r.body}`).digest("hex");
      if (r.prev !== prev || r.hash !== h) return r.seq;
      prev = r.hash;
    }
    return null;
  }

  events(caseId: string): { at: string; event: string; body: unknown }[] {
    return (this.db.prepare("select at, event, body from audit where case_id = ? order by seq").all(caseId) as {
      at: string; event: string; body: string;
    }[]).map((r) => ({ at: r.at, event: r.event, body: JSON.parse(r.body) }));
  }

  tamper(seq: number, body: string): void {
    this.db.prepare("update audit set body = ? where seq = ?").run(body, seq);
  }
}
