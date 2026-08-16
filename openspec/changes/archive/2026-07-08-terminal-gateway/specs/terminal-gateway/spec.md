## ADDED Requirements

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

### Requirement: Wake on connect

If the target pod is asleep, the gateway SHALL wake it before proxying, so a returning user's pod
resumes.

#### Scenario: Sleeping pod is woken

- **WHEN** an authorized connection targets a sleeping pod
- **THEN** the gateway SHALL wake it via the control plane and then proxy once it is running

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

### Requirement: Activity tracking and idle policy

The gateway SHALL update the pod's `lastActiveAt` on activity and SHALL run the control plane's
idle policy on a schedule, sleeping idle pods (skipping `keepAwake`).

#### Scenario: Activity updates last-active

- **WHEN** terminal activity flows through the gateway for a pod
- **THEN** that pod's `lastActiveAt` SHALL advance

#### Scenario: Idle policy sleeps an idle pod

- **WHEN** the idle policy runs and a pod has been idle beyond the threshold without `keepAwake`
- **THEN** the gateway SHALL cause that pod to be slept via the control plane

### Requirement: No credential handling

The gateway SHALL proxy only the terminal byte stream and SHALL NOT read, store, or transmit model
credentials.

#### Scenario: Credentials never touched

- **WHEN** the gateway proxies a terminal
- **THEN** it SHALL not access the pod's model-auth credentials in any way
