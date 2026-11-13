import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "smol-toml";
import { z } from "zod";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const Settings = z.object({
  aml: z.object({ decision_days: z.number(), sar_filing_hours: z.number(), four_eyes: z.boolean() }),
  disputes: z.object({
    scheme_deadline_days: z.number(),
    scheme_safety_days: z.number(),
    psd2_refund_business_days: z.number(),
  }),
  enquiries: z.object({
    first_response_hours: z.number(),
    auto_send: z.boolean(),
    auto_send_intents: z.array(z.string()),
  }),
  scheduling: z.object({ policy: z.enum(["earliest_deadline", "fifo"]), at_risk_slack_hours: z.number() }),
  work_hours: z.object({
    aml_review: z.number(),
    aml_second_approval: z.number(),
    dispute_review: z.number(),
    enquiry_review: z.number(),
  }),
  model: z.object({
    provider: z.enum(["simulated", "anthropic"]),
    anthropic_model: z.string(),
    min_confidence_to_skip_review: z.number(),
  }),
});
export type Settings = z.infer<typeof Settings>;

export function loadSettings(path = join(ROOT, "config", "ops.toml")): Settings {
  return Settings.parse(parse(readFileSync(path, "utf8")));
}
