## ADDED Requirements

### Requirement: Services emit structured logs

The gateway, pod-agent, and provider SHALL emit structured JSON-line logs to stdout with at
least `ts`, `level`, `svc`, and `event` fields, plus relevant context (`podId`, `userId`,
`err`). Secrets and tokens SHALL never appear in log output.

#### Scenario: Gateway logs a rejected upgrade

- **WHEN** a WebSocket upgrade is rejected (unauthenticated, pod not found, pod won't start,
  upstream unreachable)
- **THEN** the gateway SHALL log one event naming the reason and HTTP status used

#### Scenario: Gateway logs an accepted session

- **WHEN** a client successfully attaches to a pod
- **THEN** the gateway SHALL log the attach (and later the detach) with pod and user context

#### Scenario: pod-agent logs its lifecycle

- **WHEN** the pod-agent starts, creates the tmux session, gains/loses a client, or sees the
  PTY exit
- **THEN** it SHALL log each event, so `fly logs` on the pods app explains what a pod did

#### Scenario: Provider logs Fly API failures

- **WHEN** a Fly API call is retried or fails terminally
- **THEN** the provider SHALL log the method, path, status, and attempt — with no token material

### Requirement: Pod server actions fail gracefully

Every pod-mutating server action SHALL catch errors, log them, and return a typed error result
instead of throwing to the framework error boundary.

#### Scenario: Delete fails mid-flight

- **WHEN** `destroyPod` hits a provider error
- **THEN** the dashboard stays functional and shows the error message inline

#### Scenario: Launch fails

- **WHEN** `launchPod` fails (provider down, quota, bad environment)
- **THEN** the launcher shows the error and the user can retry without a page reload

### Requirement: Unexpected errors show a branded page

Unhandled render/server errors in the web app SHALL show a branded error page with a retry
control and the error digest, never the framework's default error text.

#### Scenario: Unexpected crash on a page

- **WHEN** an unhandled error occurs rendering any page
- **THEN** the user sees the podbay error page with a "Try again" action and a digest they can
  report
