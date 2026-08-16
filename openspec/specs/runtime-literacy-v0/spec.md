# runtime-literacy-v0 Specification

## Purpose
Makes a pod self-documenting about its own runtime through a `podbay` CLI (info and preview commands) and universal runtime rules that point the agent at that CLI. It exposes a running app on port 3000 at a preview URL, with access restricted to the owner unless the pod is explicitly made public.
## Requirements
### Requirement: The pod self-documents its runtime via a CLI

Every pod SHALL provide a `podbay` command on PATH that prints the pod's live runtime facts read
from local metadata, so the agent never relies on a hardcoded or drifting description.

#### Scenario: `podbay info` reports the environment

- **WHEN** `podbay info` runs in a pod
- **THEN** it prints the slug, environment name, preview URL, what persists (`~/work`) versus what
  resets, egress policy, and the agent

#### Scenario: `podbay info` always surfaces the owner's dashboard link

- **WHEN** `podbay info` runs in a pod that has a preview URL
- **THEN** it prints the owner's control-page (`cockpit:`) URL — where secrets and settings are
  managed — using the spec's `cockpitUrl` when present, and otherwise DERIVING it from the preview
  URL, so the link is never silently omitted for an older pod whose spec predates the field

#### Scenario: `podbay preview` reports the URL for a port

- **WHEN** `podbay preview` runs (optionally with a port; default 3000)
- **THEN** it prints the preview URL for that port and notes it is owner-only until made public

### Requirement: Every pod carries universal runtime rules

A podbay-authored runtime-rules document SHALL be present at the user-level `~/.claude/CLAUDE.md`
in every pod, stating the disposable-pod facts and pointing at the `podbay` CLI for live values,
without clobbering a file the user already has.

#### Scenario: Rules are present and point at the CLI

- **WHEN** a pod boots
- **THEN** `~/.claude/CLAUDE.md` exists and references `podbay info` for the environment/preview URL

#### Scenario: Rules state the user is not on the machine

- **WHEN** the runtime rules are read by the agent
- **THEN** they SHALL tell it that the user reaches the pod remotely and cannot open `localhost`
  URLs, pod file paths, or (for a document) the preview URL — and to surface content by printing it
  into the conversation or committing and sharing the repo link, reserving the preview URL for a
  running app and only when reachable

### Requirement: The always-loaded rules enumerate the podbay capability surface

The runtime rules (always in the agent's context, not an on-demand skill) SHALL name the `podbay`
capabilities an agent is otherwise liable to overlook and reinvent, so an agent reaches for the
built-in before improvising, installing a system package, or standing up its own tunnel. At minimum
they SHALL cover: the owner's **relay** as the sanctioned residential egress (`podbay relay status`,
`$PODBAY_RELAY_PROXY`), inter-pod **messaging** (`podbay msg`), sanctioned web **fetch**
(`podbay fetch`), the **secrets** command family (`podbay secrets`), and durable **schedule/startup**.
The guidance SHALL NOT be gated behind an environment capability flag.

#### Scenario: An agent restoring egress is pointed at the relay, not a foreign tunnel

- **WHEN** the always-loaded rules address network egress
- **THEN** they SHALL name the owner's relay (`$PODBAY_RELAY_PROXY` / `podbay relay status`) as the
  sanctioned path and SHALL distinguish it from evasion, so the agent does not reach for tailscale,
  a VPN, or a hand-rolled tunnel — and `podbay info` SHALL surface the relay's presence and state

#### Scenario: An agent can discover inter-pod messaging without prior knowledge

- **WHEN** the always-loaded rules or `podbay info` are read
- **THEN** they SHALL reference `podbay msg` (and `podbay --help` for the full surface), so an agent
  learns it can message the owner's other pods without being told out of band

#### Scenario: A workload can verify its live egress identity, not just "connected"

- **WHEN** a workload requires the owner's residential egress and needs to confirm its traffic is
  actually diverted there (not silently exiting the datacenter)
- **THEN** `podbay relay check` SHALL measure the LIVE exit IP end-to-end through
  `$PODBAY_RELAY_PROXY`, classify it as residential vs hosting/datacenter (by hosting/ASN, so a
  normal residential-IP rotation is NOT flagged), compare it to the pod's own datacenter egress, and
  exit non-zero unless egress is genuinely diverted — so a workload can gate on it rather than
  hand-rolling an IP check that misreads a rotated address as a datacenter fallback

#### Scenario: The agent hands the user a working file link, never a dead pod path

- **WHEN** the agent needs the user to open a file that lives on the pod
- **THEN** it SHALL give a reference the user's own device can resolve — for a committed file,
  `podbay link <path>` prints the file's **GitHub URL** — or hand the file over (file-send tool) or
  paste it inline; it SHALL NOT present a pod path (absolute like `/home/dev/…` or repo-relative like
  `docs/x.md`) as something to click, because such a path resolves against the user's device and fails

#### Scenario: A pod asks the owner for a secret via the dashboard, never a raw command

- **WHEN** the agent needs a secret the owner has not set
- **THEN** the guidance and CLI SHALL direct it to `podbay secrets request KEY "why"` (which records
  the ask and prints the dashboard link), and there SHALL be no pod-writable `secrets set`; an
  attempt at `podbay secrets set` (or another unknown subcommand) SHALL fail with a message naming
  `podbay secrets request` and stating the owner adds secrets in the dashboard — so a user is never
  told to run a raw CLI command to store a secret

### Requirement: A running app on port 3000 is reachable at a preview URL

The gateway SHALL serve `<slug>.preview.podbay.cloud` by proxying HTTP and WebSocket traffic to the
pod's port 3000 over the private network.

#### Scenario: Owner opens the preview

- **WHEN** the authenticated owner requests the pod's preview URL and an app is listening on 3000
- **THEN** the gateway proxies the response (including WebSocket upgrades for HMR)

#### Scenario: A suspended pod is not served (resume required)

- **WHEN** a preview request arrives for a suspended pod
- **THEN** the gateway refuses the request and SHALL NOT wake the pod — the owner must resume it first

### Requirement: Preview access is owner-authed unless made public

A preview SHALL require the pod owner's authenticated session by default; a per-pod public toggle
SHALL allow unauthenticated access when the owner opts in.

#### Scenario: Non-owner is blocked on a private pod

- **WHEN** a logged-out or non-owner client requests a private pod's preview
- **THEN** the request is rejected

#### Scenario: Public toggle allows anonymous access

- **WHEN** the owner marks the pod public
- **THEN** an unauthenticated client can load the preview

