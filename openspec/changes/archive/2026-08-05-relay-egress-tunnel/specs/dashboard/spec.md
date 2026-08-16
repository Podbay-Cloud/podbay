## ADDED Requirements

### Requirement: The cockpit relay row explains itself and shows the one command

The cockpit relay indicator row SHALL let the owner start and understand the relay without leaving the
app or reading a manual. It SHALL show the relay's live state, a short human explanation of what the
relay does and its limits (an **(i)** the owner can open), and — when no relay is running — the exact
one-line command to start it, with the pairing code pre-filled, ready to copy to the owner's machine.
The explanation SHALL state the boundary plainly: the owner lends their own connection to their own pod,
only while they run it, for public sites only (never the owner's private network), logged for the owner
(domain only), and rate-limited — not an anonymous proxy. It SHALL link to fuller docs without requiring
them.

#### Scenario: Owner opens the relay explanation

- **WHEN** the owner opens the relay row's **(i)**
- **THEN** they SHALL see a plain-language description of what the relay does and its guards, and a link
  to fuller documentation

#### Scenario: No relay running

- **WHEN** no relay is connected for the owner's pod
- **THEN** the relay row SHALL show the exact copy-paste command (with pairing code) to start one

### Requirement: The relay row shows tunnel liveness and usage

When a relay is running, the cockpit SHALL show whether the egress tunnel is actually reachable (a
health signal — a canary through the tunnel) and that owner's usage headline: connections carried and
data moved. The platform SHALL run the canary once when a relay connects, and on the owner's demand;
NOT on a repeating schedule, and always against a **platform-owned** host rather than a third party.

> AMENDED 2026-08-04 during implementation: the row shows a usage **headline** (connections + bytes),
> not a top-domains breakdown. A one-line settings row is the wrong surface for a per-site table, and
> the owner already has the full detail — with URLs — in `pb relay dashboard` on their own machine.
> Keeping the breakdown there is the privacy boundary, not a shortcut.

#### Scenario: Tunnel is live

- **WHEN** a relay is running and its tunnel is reachable
- **THEN** the relay row SHALL indicate the tunnel is working and show connections carried and data
  moved

#### Scenario: Connected but not carrying

- **WHEN** the relay's websocket is up but connections through the tunnel fail
- **THEN** the relay row SHALL distinguish that from a working tunnel, rather than showing only
  "connected"

### Requirement: Relay activity is metered by connection and bytes, domain-only

The platform SHALL meter relay activity across BOTH consumers (dispatch fetches and tunnel connections):
connections, bytes transferred, and per-domain connection rate. The admin relay dashboard SHALL present
this per owner/pod/domain, unifying fetch and tunnel. The metered record SHALL remain domain-only — never
the URL path, never content, never who-asked persisted — and per-pod attribution SHALL stay live-only
(derived from currently-open connections), not persisted. A pod that only tunnels SHALL still appear.

#### Scenario: Admin sees unified relay usage

- **WHEN** an admin opens the relay dashboard
- **THEN** it SHALL show fetch + tunnel usage per owner/pod/domain (connections, bytes, rate, denials),
  domain-only, with per-pod attribution live-only
