# Decisions

1. **The model never decides a regulated outcome.** AML dispositions, SAR filings and chargebacks are decided by
   people; the model's job is to make that decision faster and better informed. The ablation (`unchecked`) shows
   what changes when the drafts are acted on directly.
2. **Code checks look for facts, not for confidence.** A confidence threshold would let a confidently wrong draft
   through. The checks compare the draft with the transactions and the ledger instead, and every problem they find
   is shown to the person.
3. **Deadlines drive the queue.** First in, first out lets a 4-hour reply wait behind a 7-day alert and a next-day
   refund behind both. Earliest deadline first, with escalation when slack runs out.
4. **Checks both ways on AML.** The first version only flagged a draft that called a high-risk case harmless. The
   run showed the other direction mattered as much: false alarms became defensive SARs. Both are flagged now.
5. **Customer text is data.** Actions come from a fixed list; anything else, however it is phrased, goes to a person.
6. **An effect is done when it is confirmed.** A SAR that the FIU did not acknowledge has not been filed.
7. **Found by the simulation:** a narrative ending in a full stop ("EUR 9400.00.") failed amount parsing, so every
   AML draft was flagged and reviewers lost the benefit of the draft. `test/checks.test.ts` keeps the case.
