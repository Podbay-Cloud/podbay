# first-10-customers — "Win your first 10 customers"

Playbook A ([docs/playbook-first-10-customers.md](../../docs/playbook-first-10-customers.md)).
Rides the web-app engine; the agent is a growth partner and the pod is a **living pipeline**.

## Kill-test (5 minutes, run before trusting the env)

Launch → sign in → in the first session, without leaving the pod, you reach an **observable win**:

1. The agent greets in one line and asks what you're building + who for.
2. You pick a first move; within a few minutes you have **one** of:
   - a **live campaign landing page** at the preview URL aimed at a named ICP, or
   - **~10 personalized outreach drafts** to real, specific prospects.
3. A **CRM-lite** exists at the preview URL with those prospects as leads + their drafted messages
   logged.
4. **Persistence check:** sleep the pod, wake it, reopen — the leads + drafts are still there and
   the agent resumes with the pipeline state ("N contacted, M replied…").

**Pass** = all four, in one session, on a phone-shareable preview. The outcome metric beyond the
kill-test: a real customer conversation (target: 10), then KPI the conversion.

## What's wired

- **Kickoff:** growth-partner persona, self-scaffolds Next.js + Tailwind + shadcn/ui if needed,
  drives toward 10 conversations, keeps the pipeline current.
- **Skills:** `crm-lite` (first-party, shipped here). Sourced growth/design skills
  (`icp-outreach`, `marketing-growth`, `frontend-design`, `impeccable`, `shadcn-ui`) land here
  once vetted — see [skills/registry.yaml](../../skills/registry.yaml).
- **Rules:** `no-spam` (outreach honesty), `spec-driven` (OpenSpec on significant changes),
  `preview-first`.

## Status

Recipe authored (kickoff + rules + crm-lite skill + this kill-test). **Pending before it fully
ships:** vetting-pass the sourced skills (fork/pin/review → `passed`), and either bake a prebuilt
`web-app` template or lean on the kickoff's self-scaffold. Usable now for the podbay dogfood run
(drop these into a web-app pod; add sourced skills with `npx skills add` for your own pod).
