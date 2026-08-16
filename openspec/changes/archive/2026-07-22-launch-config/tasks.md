## 1. Control-plane: launch with config

- [x] 1.1 `PodService.launchPod(ownerId, env, opts?: { name?: string; secrets?: Record<string,string> })`
  — backward-compatible (opts optional)
- [x] 1.2 Validate `opts.secrets` against `resolved.secrets`: reject unknown keys, trim + drop blanks
  (`ControlError(..., "invalid")`) — BEFORE provisioning. Required-ness is enforced in the launch UI
  (Launch disabled until filled), not hard-blocked server-side, so "run now, add later" still works.
- [x] 1.3 Store provided secrets in the `SecretVault` under the new pod id (persist for wake
  re-injection), then pass them to `createPod({ …, secrets })` for boot injection
- [x] 1.4 Set the pod `name` on the record (trim, ≤60, empty ⇒ null); reuse existing name rules
- [x] 1.5 Unit tests: name set; secrets persisted + handed to provider; required-secret rejection;
  unknown-key rejection; no-opts launch unchanged

## 2. Web: launch dialog

- [x] 2.1 `launchPod` server action accepts `{ name?, secrets? }`; passes through; owner-scoped
- [x] 2.2 Launch dialog component: name field + one field per declared secret (required marked,
  write-only), Launch disabled until required secrets filled; envs with no secrets ⇒ name-only dialog
- [x] 2.3 Gallery/LaunchButton opens the dialog instead of launching immediately; keep the
  "pod ready → open terminal" hand-off
- [x] 2.4 Fetch an env's declared secrets for the dialog (server action / prop from the gallery)

## 3. Tests + e2e

- [x] 3.1 Web action unit test (validation surfaced; values never logged)
- [ ] 3.2 e2e (Playwright): open dialog for ai-chat → fill name + ANTHROPIC_API_KEY → launch →
  pod record has the name and the secret is set (never rendered back)
- [x] 3.3 Leak-scan; `pnpm -r build` + all suites green

## 4. Verify

- [ ] 4.1 Real launch of ai-chat with a key at launch → pod boots with the key present in the app
  (chat streams on first try, no post-launch secret step)
