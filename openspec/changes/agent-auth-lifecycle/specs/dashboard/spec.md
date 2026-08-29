## ADDED Requirements

### Requirement: The owner is warned of an expiring agent login before it lapses, in-app and by email

Because pods run unattended and a subscription login expires on a fixed cadence that nothing on the pod can
extend, the dashboard SHALL warn the owner before the active login lapses, both in-app and off-pod. In the
cockpit, the affected agent card SHALL show the remaining days and a primary reconnect/renew action; the pods
list SHALL show an amber "reconnect needed / expiring in N days" chip on the pod and a fleet-level summary of
how many pods need attention, linking to them. Podbay SHALL also email the owner: a single email per owner
per warning window that lists every one of their pods with an expiring login and a per-pod link to renew, sent
at most about twice per window (an early notice and a final one). The warning copy SHALL be honest — it names
the periodic login limit and the reconnect action, and never claims an automatic refresh will keep the login
alive.

#### Scenario: An expiring login surfaces in the cockpit, the pods list, and one batched email

- **WHEN** a pod's active agent login enters its warning window
- **THEN** the cockpit agent card SHALL show the days-remaining + a reconnect/renew action, the pods list SHALL
  show an amber chip on that pod plus a fleet "N pods need reconnect" summary, and the owner SHALL receive a
  single batched email listing every expiring pod with a renew link — not one email per pod

#### Scenario: Reminders are honest and de-duplicated

- **WHEN** the owner is emailed about an expiring login
- **THEN** the email SHALL name the periodic re-login limit and the fix (no "we keep it alive" claim), and a
  given pod SHALL NOT be emailed more than about twice within one warning window

### Requirement: Renewing an agent login is a full-page cockpit action for both login types

The cockpit SHALL let the owner renew an agent login as a full-page takeover flow (the same pattern as the
sign-in/reconnect and update flows). For a subscription `/login` pod it SHALL be the reconnect flow (open the
sign-in page, approve, paste the code). For a long-lived `setup-token` pod it SHALL be a "renew token" flow
that runs `claude setup-token` on the pod, presents the owner the one-time browser-approval URL, captures the
returned code, and stores the resulting `CLAUDE_CODE_OAUTH_TOKEN` durably for the pod — kept out of `~/work`,
file-mode restricted, and never logged. Both flows SHALL return to the cockpit once the agent reports
authenticated. Both inherently require the owner's one-time browser approval; the flow SHALL NOT claim a
headless renewal is possible.

#### Scenario: Renewing a setup-token pod

- **WHEN** the owner renews the login on a `setup-token` (1-year) pod
- **THEN** the cockpit SHALL run `claude setup-token`, show the owner the approval URL, capture the code, store
  the new long-lived token securely for the pod, and return to the cockpit once the agent is authenticated
