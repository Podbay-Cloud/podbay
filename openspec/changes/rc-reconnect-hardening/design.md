## Context

Podbay launches the official Claude Code interactive TUI, resumes its local transcript with
`--continue`, and drives Remote Control through `/remote-control <pod title>`. This is the only
documented mode that simultaneously provides subscription authentication, Claude app connectivity,
and local prompt injection for kickoff/resume/automation.

The current pod-base pins Claude Code 2.1.215. Anthropic has since documented different interactive
resume outcomes in 2.1.232 and later, while reports on 2.1.233 still show stale-binding failures. The
latest version at proposal time is 2.1.246. A live experiment on 2.1.215 proved that server mode can
reattach a server-owned session, but also proved that its worker is headless and has no documented
local prompt-injection seam. Server mode therefore does not fit Podbay's control model.

The current implementation also conflates lifecycle events. Incus Suspend is a plain VM stop followed
by a cold boot, not a process thaw. Conversely, the pod-agent service can restart while the tmux-hosted
Claude process remains alive. A `coldStart` boolean derived from the pod-agent process cannot tell
whether Claude reattached an existing RC session or created a replacement, and can overwrite a title
the owner set in Claude's app.

Two production reports expose related state-boundary failures outside boot itself:

- On `test:1`, health reports Claude `authed: true`, `rcActive: false`, while the live pane is blocked
  on `OAuth error: Invalid code … Press Enter to retry`. The credential-file signal wins over the
  current TUI, so the cockpit says “Signed in — turning on remote control…”, doctor reports a bridge
  failure, and automatic restore submits `/remote-control` into the blocking dialog three times.
- On `first10`, “I've paired this” successfully writes the `Work Desktop` device record but leaves the
  full-page wizard open. The shared panel calls an optional `onPaired`, but the full-page wrapper does
  not supply it and does not inspect action errors. Separately, the normal Control tab auto-opens the
  full-page pairing wizard whenever the loaded remembered-device list is empty. Its dismissal guard is
  component memory, so Back survives only until refresh. This also makes a new Claude+Codex pod appear
  ready and then unexpectedly replace its cockpit once Codex becomes live.

## Goals / Non-Goals

**Goals:**

- Establish the exact interactive RC behavior of the candidate pinned Claude version before writing
  recovery logic around it.
- Keep the local Claude conversation across every recovery path.
- Preserve an owner rename when the same RC session survives, while naming a genuinely fresh or
  replacement session after the pod.
- Represent RC state honestly and give `podbay doctor --fix` a bounded recovery path when the login is
  valid.
- Give the cockpit the same state-specific recovery semantics as doctor, including blocked login UI.
- Make Codex pairing explicit, error-aware, and complete its full-page transition predictably.
- Separate simulated Podbay orchestration tests from real Anthropic broker/app acceptance evidence.

**Non-Goals:**

- Migrating the working session to `claude remote-control` server mode, the Agent SDK, or a private API.
- Automating `/login`, extending the subscription's hard login lifetime, or sharing credentials.
- Depending on `bridge-pointer.json`, debug-log wording, or other undocumented Claude internals.
- Adding a secondary chat/channel product or changing the Codex daemon/OpenAI pairing protocol.

## Decisions

### 1. Gate implementation on an authenticated candidate-version matrix

Before changing the recovery state machine, update a designated test pod from the shipped 2.1.215 pin
to the exact candidate version (2.1.246 at proposal time) and exercise:

1. pod-agent-only restart while Claude/tmux remains alive;
2. graceful Claude exit followed by the existing resume path;
3. forced Claude exit followed by the existing resume path;
4. Incus Suspend/wake (a cold boot with persistent home);
5. image Update/recreate (a cold boot with persistent home).

For each row, record the prior and resulting RC session URL identity, whether the local transcript was
resumed, whether the app session became reachable, the resulting title, and the TUI outcome text. Set
an owner-supplied title before the first row so title preservation is tested, not inferred.

The existing real-CLI golden path remains the unauthenticated build gate for login/menu drift. The new
matrix is a designated-test-pod release gate because CI and scratch pods intentionally hold no owner
credentials. If the candidate cannot meet the specs through documented interactive behavior, stop the
pin bump and record the failing row; do not compensate with daemon internals.

The first apply run found that `cli-drift-canary.sh` attempted the global npm upgrade as the unprivileged
`dev` user and swallowed install failure with `|| true`, so a nominal “latest” canary could silently
probe the old pins. The canary must install with sufficient privileges, fail closed on install or exact
version mismatch, and accept an exact candidate version for reproducible evidence.

**Alternative considered:** design against 2.1.215 and add bridge-pointer reattachment. Rejected because
the pin is substantially behind, upstream changed this lifecycle explicitly, and bridge-pointer is an
undocumented server-mode artifact.

### 2. Model RC lifecycle outcomes, not provider lifecycle labels

The pod-agent will use a small RC lifecycle state:

- `active`: current evidence says the interactive bridge is live;
- `recovering`: a bounded native reconnect/recovery attempt is in progress;
- `down`: the login is valid but RC is confirmed unavailable;
- `login-required`: RC cannot start until the owner completes `/login`;
- `unknown`: the pinned CLI exposes insufficient current evidence.

For compatibility, `rcActive` is true only for `active`. Consumers must not turn `unknown` or a stale
captured URL into true. The state classifier is shared by health reporting, automatic recovery, and
doctor so they cannot disagree. A recognized blocking login or OAuth error dialog is
`login-required` even if the credential file has not expired; current interactive state outranks a
historical credential artifact.

**Alternative considered:** keep a boolean and treat any captured URL as active. Rejected because a
URL survives after its worker dies and was the source of false-healthy cockpit/doctor reports.

### 3. Determine title ownership by RC session transition

Podbay will keep a mode-0600 state record containing a hash of the last successfully observed RC
session ID, never the URL or credential. After native resume/recovery:

- same session ID: preserve its existing title and do not send `/rename`;
- different ID or no prior ID: treat it as fresh/replacement and apply the sanitized pod title;
- no observable ID: do not send `/rename`, because Podbay cannot prove the session is new; pass the pod
  title through the documented `/remote-control <name>` interface as best effort and report the
  transition as `unknown` until current liveness is observable.

This replaces `coldStart`. Suspend, Update, crash, and service restart are inputs to the test matrix,
not proxies for session identity.

**Alternative considered:** always rename on every pod-agent boot. Rejected because a pod-agent-only
restart can leave the same user-renamed Claude session alive.

### 4. Prefer Claude's native resume before Podbay recovery

On a cold Claude launch, Podbay will let `claude --continue` finish its documented reconnect outcome
before driving `/remote-control`. The classifier then handles the result:

- native reattach/replacement is active: capture the current session identity and apply the title rule;
- RC is down with a valid login: perform the matrix-verified, documented interactive recovery sequence;
- login is invalid, a blocking OAuth error is visible, or login UI is active: stop and surface
  `login-required`;
- the outcome cannot be classified: surface `unknown` and preserve the conversation/title rather than
  blindly navigating a TUI menu.

Recovery is capped and backed off. It never drops the local transcript, starts a fresh conversation
merely to repair RC, clears credentials, or retries forever. Claude's existing fast-fail fallback for
an actually unreadable local transcript remains separate. Before every recovery attempt it must
reclassify the pane and must never submit `/remote-control` into a known blocking dialog or menu.

**Alternative considered:** immediately send `/remote-control` on every boot. Rejected because it can
interfere with native reconnect, open the active-session status modal, and obscure the outcome needed
for safe naming and diagnosis.

### 5. Doctor and the cockpit consume the same state and fix primitive

`podbay doctor` will report `down`, `login-required`, and `unknown` distinctly. `doctor --fix` may call
the same bounded RC restore primitive only for `down` with a valid login and when RC has not been
deliberately yielded to T3. It cannot modify credentials. After the attempt it re-runs the classifier
and reports the observed result rather than declaring success from command submission.

The Control tab maps the same state rather than inventing a second timer-based interpretation:

- `active`: offer the live Claude session;
- `recovering`: show bounded progress without a second concurrent action;
- `down`: offer **Restore remote control**, call the shared primitive, then render its observed result;
- `login-required`: offer **Reconnect Claude** and do not attempt RC repair first;
- `unknown`: say that RC could not be verified and offer diagnosis, not a success or endless spinner.

### 6. Codex pairing is explicit enrollment, not a readiness gate

Podbay cannot observe OpenAI-side device enrollment. Its `codexDevices` list contains only owner
confirmations, so an empty list means “Podbay remembers no labels,” not “no app is paired” and not
“launch is incomplete.” The normal cockpit will therefore never auto-open pairing from this list.
The Control card always provides the explicit **Pair a device** action when Codex RC is on; this is the
only way the full-page pairing wizard opens.

“I've paired this” remains the honest completion signal. The panel must await and inspect the action
result. On success it invalidates/refetches the shared device query and closes the wizard so the named
pill is visible in the cockpit. On failure it keeps the wizard and entered label in place and displays
the error. Back closes the URL-backed wizard; because there is no ambient auto-open rule, refresh stays
in the cockpit. Multi-agent launch onboarding remains provider authentication, not device enrollment:
once Claude and Codex are usable, optional app pairing is offered from Control rather than appearing
later as a surprise takeover.

**Alternative considered:** persist a “pairing dismissed” flag while retaining auto-open. Rejected
because it preserves the false premise that an empty, self-reported list proves enrollment is needed,
adds durable state for an optional action, and still cannot reflect pairings completed outside Podbay.

### 7. Split fake-stack coverage from external acceptance

Unit tests cover classification, retry bounds, prior/current ID comparison, and title ownership. The
fake provider exposes deterministic reattached/replacement/down/login-required outcomes so Playwright
can verify Podbay's UI and doctor orchestration. Those tests are explicitly simulated and do not claim
the Anthropic broker or Claude app reattached. Only the authenticated test-pod matrix supplies that
evidence.

## Risks / Trade-offs

- **[Upstream TUI or state signal changes again]** -> Keep the CLI pinned, add captured fixtures for the
  candidate version, and run both the sign-in golden path and RC matrix before a pin is promoted.
- **[Interactive mode still exposes no reliable liveness signal]** -> Report `unknown`, never infer
  active from history, and avoid destructive/menu-driving fixes when the outcome is ambiguous.
- **[A replacement app session omits earlier remote history]** -> Preserve the full local transcript,
  name the replacement recognizably, and report it as replacement rather than claiming seamless
  reattachment.
- **[The session-ID state becomes sensitive]** -> Persist only a hash in a Podbay-owned mode-0600 file
  and never log the URL or raw ID.
- **[The matrix perturbs a real workload]** -> Use only a designated test pod, preserve its workspace,
  record the prior CLI version, and restore the prior pin if the candidate fails.
- **[Tri-state rollout surprises older consumers]** -> Add `rcState` additively and retain `rcActive` as
  the compatibility projection (`true` only for known-active).
- **[Removing Codex auto-open makes pairing easier to overlook]** -> Keep the explicit Pair a device
  action prominent in the Codex row, but do not trade discoverability for repeated cockpit takeover.
- **[A new Claude dialog string escapes classification]** -> Keep captured pane fixtures from the exact
  candidate version and fall back to `unknown`; never type recovery commands through ambiguity.

## Migration Plan

1. Run the existing latest-CLI sign-in canary and the authenticated RC matrix on the designated test
   pod; save the evidence and select only documented recovery outcomes.
2. Replace `coldStart` naming with session-transition comparison and add the lifecycle classifier plus
   unit fixtures.
3. Route boot recovery, health, automatic repair, doctor, and the cockpit through the shared
   classifier/restore primitive.
4. Remove ambient Codex pairing auto-open and make full-page confirmation/error transitions complete.
5. Extend the fake provider and Playwright suite for the modeled outcomes and reported cockpit flows,
   with assertions scoped to Podbay behavior.
6. Update both pod-base build pins to the exact tested Claude version and run the package build/tests,
   real-CLI golden path, and full matrix once more on the resulting image.
7. Follow the shipping runbook for cloud and self-host parity. Promote only after real-pod verification;
   roll back by restoring the previous image alias/digest and CLI pin.

## Open Questions

No product decision is left open before apply. The candidate-version matrix is an explicit engineering
gate: it chooses among documented interactive recovery outcomes, but it cannot authorize a daemon or
undocumented fallback if those outcomes fail.
