## ADDED Requirements

### Requirement: One credential grant per pod (never shared across concurrent pods)

Because Claude rotates the refresh token on every refresh, a login grant SHALL be owned by at most
one existing pod (running or sleeping) at a time, so it is only ever rotated by its owner and a pod
is never logged out by another pod's activity. The vault's shared grant SHALL be injected into a new
pod only when it is free (its previous owner has been destroyed); otherwise the new pod SHALL fall
back to interactive `/login` and own an independent grant.

#### Scenario: The free grant seeds a new pod without login

- **WHEN** a pod is launched and the vault grant has no existing owner
- **THEN** the pod is injected with the vault grant and becomes its owner (no login required)

#### Scenario: A concurrent pod gets its own login

- **WHEN** a pod is launched while another existing pod (running or sleeping) already owns the vault
  grant
- **THEN** the new pod is not injected and boots to `/login`, and the existing owner is never logged
  out

#### Scenario: Ownership frees on destroy

- **WHEN** the owner pod is destroyed
- **THEN** its latest credentials are captured back to the vault and the grant becomes free to seed
  the next new pod

#### Scenario: Only the owner writes back

- **WHEN** a pod that does not own the vault grant refreshes/rotates its credentials
- **THEN** its write-back is rejected so the owner's credentials remain authoritative
