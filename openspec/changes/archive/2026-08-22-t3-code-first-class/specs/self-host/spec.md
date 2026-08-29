## ADDED Requirements

### Requirement: The T3 Code backend URL is edition-correct

The pairing token and backend URL that connect the T3 Code app to a pod SHALL be derived from the same
public address the pod's preview actually uses for the running edition — cloud's preview host for a
cloud pod, and the self-host published address (`LocalProvider.publishedAddress`) for an OSS/`local`
pod — never assuming the cloud `PODBAY_PREVIEW_BASE` on self-host. When the running edition cannot
expose a URL a remote device can reach (e.g. a plain loopback `local` pod with no public deployment
mode), the platform SHALL refuse to enable T3 Code with an honest message rather than mint a pairing
token against an unreachable URL.

#### Scenario: Self-host uses its published address

- **WHEN** an OSS/`local` pod in a public-reachable deployment mode enables T3 Code control
- **THEN** the backend URL and pairing token are built from the self-host published address, and the
  T3 app can reach the pod at that URL

#### Scenario: Honest refusal when no reachable URL exists

- **WHEN** a pod's edition/deployment cannot produce a URL reachable from a remote device
- **THEN** enabling T3 Code is refused with a clear explanation, and no pairing token is minted
  against an unreachable address

#### Scenario: Cloud is unaffected

- **WHEN** a cloud pod enables T3 Code control
- **THEN** the backend URL is built from the cloud preview host as before
