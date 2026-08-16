## ADDED Requirements

### Requirement: Provisioning is enabled in production

With the Fly pods app and API token configured, the control plane SHALL report provisioning as
enabled and SHALL create real pods on launch.

#### Scenario: Launch creates a real machine

- **WHEN** an approved user launches an environment
- **THEN** a real pod machine SHALL be created in the pods app, a record SHALL be stored under the
  user, and they SHALL be routed to the pod workspace

#### Scenario: Provisioning reported enabled

- **WHEN** the control plane runs with a valid Fly token
- **THEN** the launcher SHALL show launch as enabled (no "not enabled" banner)

### Requirement: Pod base image boots the agent

The pod base image SHALL boot with the official CLIs installed, run first-boot seeding, and start
the in-pod agent, so a newly launched pod is ready for a terminal connection.

#### Scenario: A launched pod becomes reachable

- **WHEN** a pod is launched and reaches running
- **THEN** its `pod-agent` SHALL be serving on the pod-internal address and report ready

### Requirement: Gateway is reachable and authenticated

The deployed gateway SHALL accept authenticated WebSocket connections from the browser and proxy
to the target pod's `pod-agent`, refusing unauthenticated or cross-owner connections.

#### Scenario: Authenticated owner connects

- **WHEN** an approved user opens their pod's terminal in the browser
- **THEN** the gateway SHALL validate their session, authorize ownership, and stream the terminal

#### Scenario: Session validates across subdomains

- **WHEN** the browser connects to the gateway on a different subdomain than the app
- **THEN** the session cookie SHALL be sent and validated (cookie scoped to the parent domain)

### Requirement: End-to-end terminal works

A user SHALL be able to launch a pod and use an interactive terminal in the browser, including
signing into the agent CLI inside the pod.

#### Scenario: Launch to working terminal

- **WHEN** an approved user launches a pod and opens it
- **THEN** they SHALL see an interactive terminal, and SHALL be able to run the agent CLI login
  inside the pod
