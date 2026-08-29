# Tasks

Order: ownership-yield (image) → async enable + disable (control-plane) → wizard + modals + banner
(web) → self-host parity → verify. Each behavior-changing commit updates its spec + `0audit.md`.
Matches the owner-approved UX mock (Settings row → confirm → wizard → pair; in-control banner; turn-off
confirm).

## 1. Ownership yield — Podbay stops driving both agents (image-baked, D2)

- [x] 1.1 Add a Claude-side RC off switch (`CLAUDE_RC_OFF`, mirror `CODEX_RC_OFF`) honored at the top
      of `startGreeter` + `reenableRemoteControl` (the resume watcher calls the latter, so it's gated
      too). — pod-agent/src/server.ts
- [x] 1.2 Pod-agent `POST /agent/rc-yield {yield}` → `yieldAgentControl()` writes BOTH sentinels +
      `pkill`s the live codex daemon; `resumeAgentControl()` clears both + re-drives Claude RC +
      restarts the codex daemon. (Control-plane exec-curl wrapper wired in §2.)
- [x] 1.3 `yieldAgentControl`/`resumeAgentControl` touch ONLY the two sentinel files — never the
      credential paths — so agents stay signed in (#6 guarantee). Real-pod assertion in §6.2 (the
      endpoint writes hardcoded `/home/dev` paths + the server harness needs a PTY, so it's verified
      on a live pod, not a polluting unit test).
- [x] 1.4 Yield survives resume: the resume watcher's only RC calls (`reenableRemoteControl`,
      `ensureCodexDaemon`) both short-circuit on their sentinels, so a wake won't re-drive either.

## 2. Async enable + the missing disable (control-plane, D1/D3)

- [x] 2.1 `startT3Enable` (fast, marks t3Since/t3Stage + detaches `runT3Enable`) + `t3Progress(slug)`
      poll. runT3Enable emits stages preparing → downloading → starting → ready. — service.ts
- [x] 2.2 runT3Enable yields RC (`execRcYield(true)`) during "preparing"; keeps the durable `t3 serve`
      startup + `previewAppAuth=true` flip; sets `t3Control=true` on ready. Pairing token is transient
      (cockpit mints via `mintT3Pairing` when ready — never stored).
- [x] 2.3 `disableT3Backend`: startup remove + pkill t3 serve, `setPreviewAppAuth(false)`, `podbay dev
      enable`, `execRcYield(false)` (hand RC back), `t3Control=false`. Idempotent; port freed + auth
      flipped BEFORE the dev server restarts.
- [x] 2.4 Durable `t3Control`/`t3Since`/`t3Stage` on the pod row (migration 0047 + schema.ts +
      types.ts + drizzle-store map + createPod default). Nullable/default-false → backward-compatible;
      gateway-before-web at deploy.

## 3. Web UX — match the approved mock (D1/D4 + house conventions)

- [x] 3.1 `t3-connect-panel.tsx` reworked into a Settings ROW; enable trigger = tinted-outline
      `Enable T3 Code…` (sky), not blue.
- [x] 3.2 Enable confirm modal (`AlertDialog`) with the approved copy ("Let T3 Code control this
      pod?" + 3 bullets, first amber; "You can turn off T3 at any time…").
- [x] 3.3 `<T3Enabling>` full-page flow via the cockpit early-return (mirrors PodUpdating), seeded from
      durable `t3Since`, polling `t3Progress`; stages + elapsed; approved subhead.
- [x] 3.4 Pairing shown in the panel once in-control (reuse QR/code/copy-link; approved copy "In the T3
      app, select Add Environment…") — token minted on demand.
- [x] 3.5 In-control banner ("T3 Code is in control") on the cockpit; Open-in-Claude + Codex-pairing
      hidden via `externalControl` prop to AgentCards.
- [x] 3.6 "Turn off T3 control" row (tinted-outline warn) + its own confirm modal (approved copy) →
      `disableT3Code`.
- [x] 3.7 `enableT3Code`/`disableT3Code` non-blocking (kick off; the cockpit poll + optimistic
      onEnableStarted/onDisableStarted drive the wizard).

## 4. Self-host parity (D5)

- [x] 4.1 `t3BackendUrl` edition-aware: cloud → `PODBAY_PREVIEW_BASE`; self-host → `localPreviewUrl`
      (`LocalProvider.publishedAddress`); branch on `editionOss()`. — actions.ts
- [x] 4.2 Refuse with an honest message (`t3UnreachableMessage`) when the URL is loopback/unset — never
      mint a token against an unreachable URL.
- [ ] 4.3 Confirm the delegated-auth gateway path + the ownership yield behave on `local`/self-host.
      (real-pod / editionOss verification — §6.3)

## 5. Agent-update lockstep note (D6, #9 — docs only)

- [ ] 5.1 Keep/refresh the `0audit.md` + a runbook note: on a T3-backend pod run `podbay agent update
      codex` to move the npm codex + Podbay's pinned standalone RC daemon together (T3's in-app update
      bumps only npm; init.sh re-pins the standalone on reboot). No code change.

## 6. Verify end-to-end + ship

- [ ] 6.1 `pnpm -r build` green; unit tests (yield sets/clears both flags + leaves creds untouched;
      `t3BackendUrl` edition branch; disable idempotency).
- [ ] 6.2 Test pod (cloud): enable → watch the wizard; confirm Podbay STOPS driving Claude+Codex yet
      both stay SIGNED IN and T3 drives them; pair; then disable → confirm Podbay RC + dev server +
      hidden controls all return, agents still signed in.
- [ ] 6.3 Reason through / test self-host (`editionOss()` on, a `local` pod): correct backend URL or an
      honest refusal.
- [ ] 6.4 Update `openspec/specs/{dashboard,pod-agent,self-host}` in the same commits; `0audit.md` on
      every push; image rebuild via `build-and-record.sh` + digest bump; gateway-before-web for the
      §2.4 schema add.
- [ ] 6.5 `openspec archive t3-code-first-class` once shipped.
