## ADDED Requirements

### Requirement: Every pod authenticates itself (no credential sharing)

Each pod SHALL obtain its own agent login via interactive `/login` on first boot and SHALL keep it
on its own volume for its lifetime. The platform SHALL NOT copy, capture, or inject agent
credentials between pods or through any shared store, so no pod's session can be invalidated by
another pod's activity.

#### Scenario: A new pod always starts at login

- **WHEN** a user launches a pod
- **THEN** no credentials are injected and the agent starts at `/login`

#### Scenario: A pod's login survives sleep/wake untouched

- **WHEN** a logged-in pod sleeps and later wakes
- **THEN** it resumes with its own credentials from its volume, still authenticated

#### Scenario: Concurrent pods never interfere

- **WHEN** multiple of a user's pods run concurrently (any mix of sleepy and always-on)
- **THEN** each holds an independent grant and none is ever logged out by another
