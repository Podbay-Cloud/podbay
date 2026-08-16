# terminal-gateway Specification

## Purpose
Is the control-plane gateway between the browser terminal and a pod: it accepts only authenticated connections, authorizes them by pod ownership, and proxies the terminal bidirectionally. Pods run 24/7 and suspend/resume are explicit user actions — the gateway never auto-suspends a pod on idleness and never auto-wakes a suspended pod on connect (it refuses the connection until the owner resumes). It never handles user credentials.
## Requirements
### Requirement: The owner's relay connects outbound to the gateway

The gateway SHALL accept a relay connection initiated BY the owner's machine, requiring no inbound
port, tunnel, or third-party service on their side. This is what lets a relay run behind a home router
or a corporate firewall without the owner configuring anything.

The connection SHALL be authenticated by a single-use pairing code presented at connect time rather
than by a browser session, because the relay is a command-line program on someone's machine. A
connection presenting no code SHALL be refused, and one presenting an unusable code SHALL be closed
rather than left open holding a socket.

The gateway SHALL greet an accepted relay BEFORE sending it any work, so a relay reconnecting with
queued requests can tell a job from a handshake. Work queued while the owner's machine was unavailable
SHALL be delivered once it connects.

Shutting the gateway down SHALL NOT wait indefinitely on connected relays: a single unresponsive one
must not block the process from stopping.

#### Scenario: A relay reconnects with work waiting

- **WHEN** a relay pairs and requests are already queued for that owner
- **THEN** it SHALL receive the greeting first, then the queued work

#### Scenario: An unusable pairing code

- **WHEN** a relay connects with a code that is unknown or already spent
- **THEN** the connection SHALL be closed rather than kept open

### Requirement: The gateway maintains a control socket to each running pod

The gateway SHALL open and hold one control WebSocket per running pod, reconciled as pods start and
stop: opening for pods newly running, closing for pods that stopped, and leaving a healthy connection
untouched rather than tearing it down and rebuilding it each pass. A connection that fails to open, or
drops, SHALL be retried on the next pass.

Over these sockets the gateway SHALL record the fetch outcomes a pod drains and push back the fleet's
current plan, sending the plan to a pod as soon as it connects rather than making it wait for the next
tick. The plan pushed over the socket SHALL be the same one the HTTP exchange pushes — computed once,
so the two transports cannot disagree.

The gateway SHALL confirm a connection is a real control socket before using it — the pod-agent
announces a control socket explicitly, and the gateway SHALL keep the connection only on seeing that.
A pod-agent too old to route the control path answers on its terminal handler instead; the gateway
SHALL reject such a connection rather than treat a terminal as a control link, and SHALL back off from
re-dialling a pod that keeps failing to confirm.

Dialling a pod SHALL time out rather than hang on an unreachable address, the reconcile pass SHALL be
robust to a pod leaving the running set while its connection is still being established, and overlapping
sweeps SHALL be prevented — a slow provider must not stack passes that wedge the loop.

This path SHALL be additive: when no fetch-memory sink is configured the gateway SHALL behave exactly
as it did without it, so the terminal and preview paths cannot be affected by it.

#### Scenario: A pod stops running

- **WHEN** a pod that had a control socket is no longer running
- **THEN** the gateway SHALL close that socket and stop tracking the pod

#### Scenario: A pod that was already connected

- **WHEN** the reconcile pass runs and a pod already has a healthy control socket
- **THEN** that socket SHALL be left open rather than replaced

#### Scenario: A pod too old to support the control socket

- **WHEN** the gateway dials the control path on a pod whose agent does not route it
- **THEN** the gateway SHALL reject the connection, keep no control socket to that pod, and fall back to
  the HTTP exchange

### Requirement: Authenticated connections only

The gateway SHALL require a valid Podbay session to open a terminal connection. Connections
without a valid session SHALL be refused before any proxying to `pod-agent`.

#### Scenario: Unauthenticated connection refused

- **WHEN** a client attempts to connect without a valid session
- **THEN** the gateway SHALL reject the connection and SHALL NOT open any connection to
  `pod-agent`

#### Scenario: Valid session resolves the user

- **WHEN** a client connects with a valid session
- **THEN** the gateway SHALL resolve it to the owning user id for authorization

### Requirement: Ownership authorization

A connection SHALL be permitted only for a pod the authenticated user owns. Requests for a pod
the user does not own SHALL be refused as not-found (no existence leak).

#### Scenario: Owner permitted

- **WHEN** an authenticated user connects to a pod they own
- **THEN** the gateway SHALL proceed to proxy that pod's terminal

#### Scenario: Cross-owner refused

- **WHEN** an authenticated user connects to a pod owned by someone else
- **THEN** the gateway SHALL refuse the connection as not-found and SHALL NOT reach `pod-agent`

### Requirement: No auto-wake on connect

Suspend and resume are explicit user actions. A connection attempt SHALL NOT wake a suspended pod;
the gateway SHALL refuse the connection until the owner explicitly resumes the pod. If a start is
already in flight (the owner has resumed, or the pod is still provisioning), the gateway SHALL wait
for it to become running and then proxy.

#### Scenario: Suspended pod is refused, not woken

- **WHEN** an authorized connection targets a suspended pod
- **THEN** the gateway SHALL refuse the connection (directing the user to resume) and SHALL NOT wake
  the pod

#### Scenario: In-flight start is awaited

- **WHEN** an authorized connection targets a pod that is already starting (resuming or provisioning)
- **THEN** the gateway SHALL wait until the pod is running and then proxy its terminal

### Requirement: Bidirectional terminal proxy

Once authorized, the gateway SHALL proxy the WebSocket bidirectionally between the browser and the
pod's `pod-agent`, preserving the wire protocol frames in both directions.

#### Scenario: Terminal round-trip

- **WHEN** an authorized client sends input through the gateway
- **THEN** the input SHALL reach `pod-agent` and the resulting output SHALL stream back to the
  client unchanged

#### Scenario: Upstream close ends the client connection

- **WHEN** the `pod-agent` connection closes
- **THEN** the gateway SHALL close the client connection cleanly

### Requirement: No credential handling

The gateway SHALL proxy only the terminal byte stream and SHALL NOT read, store, or transmit model
credentials.

#### Scenario: Credentials never touched

- **WHEN** the gateway proxies a terminal
- **THEN** it SHALL not access the pod's model-auth credentials in any way

