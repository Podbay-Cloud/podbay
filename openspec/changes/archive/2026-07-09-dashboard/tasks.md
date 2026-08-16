## 1. Environment catalog

- [x] 1.1 `apps/web/lib/environments.ts`: `listEnvironments(root)` — read `environments/*`,
  `validateEnvironment` each, return `{ name, description, tags }`; skip invalid
- [x] 1.2 Test against the real `environments/` dir (valid ones listed; a dir without podbay.yaml skipped)

## 2. Pod-service factory

- [x] 2.1 `apps/web/lib/pod-service.ts`: `getPodService()` — DrizzlePodStore (Neon) always,
  FlyProvider when `FLY_API_TOKEN` set; `isProvisioningEnabled()`
- [x] 2.2 Server-only; reads secrets from env, never client-exposed

## 3. Pod slugs (control-plane)

- [x] 3.1 Slug generator in `@podbay/control-plane` (`adjective-noun-4hex`); `launchPod` uses it
  instead of randomUUID; collision retry via store lookup
- [x] 3.2 Tests: shape, uniqueness across generations; existing control-plane tests stay green

## 4. Server actions

- [x] 4.1 `launchPod(environmentName)` — requireUser → getPodService → launch → redirect `/pods/[slug]`;
  guarded "not enabled" when provisioning off
- [x] 4.2 `wakePod` / `sleepPod` / `destroyPod` — requireUser + owner-scoped; `revalidatePath`
- [x] 4.3 Delete confirms before destroying

## 5. Pages

- [x] 5.1 Replace the `/dashboard` stub: the signed-in home — list the user's pods (status +
  last active) with Open / Wake / Sleep / Delete + a "New pod" link to `/new`
- [x] 5.2 `/new` launcher: catalog cards → launch action; `?env=` preselects; param survives the
  sign-in round-trip (signin callback returns to `/new?env=…`)
- [x] 5.3 Provisioning-disabled banner when Fly isn't configured; empty state points to `/new`

## 6. Docs

- [x] 6.1 Note `FLY_API_TOKEN` / provisioning gating; env catalog location; launch-link pattern
- [x] 6.2 Update docs/roadmap.md that the dashboard + launcher are implemented
