# Working on regulated-ops-autopilot

## Fast feedback

```bash
npm test                     # checks, engine, deadlines, outbox, audit chain, ops API (< 2 s)
npm run typecheck
npm run evaluate             # the three designs on the dev world (~10 s); writes reports/dev.json
npm run readme && git diff --exit-code README.md web/public/data/console.json
tofu fmt -check -recursive infra   # CI runs terraform validate with the AWS provider
cd web && npm test && npm run build
```

## Invariants

1. **The truth stays in the world.** `src/world/` knows what really happened; only `src/world/run.ts` and
   `scripts/evaluate.ts` import it. A test checks that nothing else under `src/` does.
2. **The world does not read the autopilot's settings.** `config/world.toml` drives the world, `config/ops.toml`
   the autopilot.
3. **The model reads; code decides; a person approves.** A model output is a draft. Code checks it against the
   ledger, the transactions and the rules; a person decides every AML alert and every chargeback; a SAR needs two.
   Only a reply whose every fact is in the ledger and whose intent is on the list goes out unreviewed.
4. **Customer text is data.** Nothing in an enquiry or a dispute can trigger an action; actions come from a fixed list.
5. **An effect is done when it is confirmed.** SARs, chargebacks, refunds and replies leave through the outbox with
   an idempotency key and are retried until the receiver confirms.
6. **Every decision is in the audit chain.** Hash-chained; `Audit.verify()` must hold after every run.
7. **Same cases for every design.** The world draws one random stream per event, so the designs see the same cases.
8. **Settings in config; reports generated.** `reports/*.json` by `npm run evaluate`; README results and the
   dashboard data by `npm run readme`.

## The held-out rule

`npm run evaluate:heldout` runs the held-out world once and writes `config/heldout.lock`. After that, changes are
measured on the dev world only, and the held-out numbers stay as they first came out.
