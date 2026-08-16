Ship order: A → B → E → D → C. Each phase is its own branch, pushed for diff-panel review; per phase:
build + browser click-through (`webapp-testing`) + real-pod check where relevant; specs kept current
in the same commit; `0audit.md` updated before each push; leak-scan staged diffs.

## A. Launch wizard (adaptive steps + reload-durable draft)

- [ ] A1 `apps/web/components/launch-configure.tsx`: `LaunchStep = "basics"|"github"|"settings"|"review"`;
  adaptive `steps` (drop `github` unless `byoRepo`, `agent` unless `agentIds>1`); Back/Next with
  per-step gating (github → repo picked; settings → required secrets filled); Review step reuses the
  existing fields + `submit()` and `launchPod(...)` payload unchanged.
- [ ] A2 sessionStorage draft `podbay:launch-draft:<env>`: persist/restore `{step,name,size,agent,
  githubRepo,values}` on change; clear on successful launch; mirror `step` → `?step=` (`router.replace`).
- [ ] A3 inline sub-step indicator ("Step 2 of 3 — GitHub"); keep the shared 5-dot
  `WizardProgress current="configure"` for the whole pre-create wizard.
- [ ] A4 spec `launch-config`; verify: reload on any step restores step + fields; non-BYO env has no
  GitHub step; provisioning view + post-create cockpit phases byte-for-byte unchanged.

## B. Secrets tab + `.env` paste

- [ ] B1 `apps/web/components/secrets-panel.tsx`: render inline (drop the `<Dialog>`/`onClose` wrapper);
  logic (`load`/`save`/`clear`/`addArbitrary`/requests) unchanged.
- [ ] B2 `apps/web/components/pod-cockpit.tsx`: add `"secrets"` to `COCKPIT_TABS` + a `<TabsTrigger>` +
  an inline `<TabsContent>` panel; remove `secretsOpen` state, the Secrets `SettingRow`, and the modal
  mount. Tab always visible.
- [ ] B3 `apps/web/lib/env-paste.ts`: `parseEnvBlob(text)` + `looksLikeEnvBlob(text)` (reuse the regex
  at `packages/pod-agent/src/secret-requests.ts:91`; skip blank/`#` lines, strip quotes/`export`).
  `apps/web/components/ui/secret-input.tsx`: optional `onPasteEnv`; wire it in the secrets panel and
  the launch Settings step (unknown valid `UPPER_SNAKE` keys become new vars; invalid skipped w/ note).
- [ ] B4 spec `pod-secrets`; verify: `?tab=secrets` deep-links; pasting a multi-line `.env` sets/creates
  multiple keys; single-value typing still works; write-only masking preserved.

## E. Continue-in-Claude — DESCOPED (researched 2026-08-03)

- [x] E1 Researched: no documented Claude desktop URL scheme; a browser click can't reliably reach a
  desktop app, and a wrong scheme risks a Safari error dialog. The button KEEPS opening the web session
  in a new tab (the correct cross-platform behavior; mobile OS already routes it to the app). No code
  change to `agent-cards.tsx`. The desktop-app path is surfaced as guidance in the Phase-D walkthrough.
  Spec `session-handoff` updated to the honest behavior.

## D. Connect walkthrough (anchored coach-marks)

- [ ] D1 `pnpm dlx shadcn add popover` (Base UI — positioner + arrow). `apps/web/components/connect-walkthrough.tsx`:
  a coach-mark tour driven by a `steps` array anchored (via `data-tour` refs) to the Continue-in-Claude
  button, the web-connect link, and the Admin tab; Back/Next/Done + counter. Copy MUST name both ways to
  open the session — in the browser or the Claude desktop app — plus the Admin-terminal advanced path.
- [ ] D2 `packages/db/src/schema.ts`: `pods.walkthroughSeenAt timestamp` + drizzle migration (applied to
  Neon). Action `markWalkthroughSeen(slug)` in `apps/web/lib/actions.ts`.
- [ ] D3 `apps/web/app/dashboard/pods/[slug]/page.tsx` + `pod-cockpit.tsx`: run the tour once when
  `phase === "ready"` and `walkthroughSeenAt` is null; Done calls the action. Spec `session-handoff` +
  `dashboard`; verify arrows anchor correctly, mobile reflow (Base UI flip/shift), seen persists.

## C. Add GitHub to an existing pod → clone into `~/work`

- [ ] C1 pod-agent `POST /clone-repo {repo}` in `packages/pod-agent/src/server.ts` (+ helper beside
  `gh-auth.ts`): as dev, existing gh credential store, never token-in-URL; empty `~/work` → clone; a
  non-empty `~/work` → refuse ("one pod, one repo").
- [ ] C2 `apps/web/lib/actions.ts`: `githubConnRepos(slug)` (mirror `githubAccountRepos`) +
  `cloneRepoIntoPod(slug, repo)` (owner-gated → provider → pod-agent).
- [ ] C3 `apps/web/components/github-connect.tsx`: after `connected`, render `RepoPicker` (fed by
  `githubConnRepos`) → on pick `cloneRepoIntoPod` → show "Cloned to `~/work`" or the refuse message.
- [ ] C4 spec `pod-agent` + `dashboard`; verify on a real pod: clone lands at `~/work`; a pod with
  existing code is refused, files untouched; non-owner rejected.
