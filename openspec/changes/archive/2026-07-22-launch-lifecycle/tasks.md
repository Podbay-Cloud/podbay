## 1. Schema + resolve
- [x] 1.1 `lifecycle` accepts policy | `{ default, locked }`; `ResolvedPod.lifecycle` = `{ default, locked }`
- [x] 1.2 resolve normalizes both forms; shared tests green

## 2. Control-plane (enforce the lock)
- [x] 2.1 `LaunchOptions.lifecycle`; `launchPod` computes effective policy, rejects a locked override
- [x] 2.2 `setLifecycle` resolves the pod's env and rejects a change when locked
- [x] 2.3 Tests: unlocked launch override; locked forces + rejects; setLifecycle blocked when locked

## 3. Web
- [x] 3.1 Catalog carries `{ default, locked }`; launch dialog lifecycle picker (disabled when locked)
- [x] 3.2 Pod card lifecycle control → setLifecycle, read-only when locked
- [x] 3.3 pnpm -r build + suites green; leak-scan

## 4. Verify
- [ ] 4.1 Deploy web; launch an unlocked env → pick always-on → card shows it; change back to auto
