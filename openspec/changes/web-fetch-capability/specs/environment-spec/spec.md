## ADDED Requirements

### Requirement: Environment declares web-fetch capability

An environment SHALL be able to declare `capabilities.webFetch`, default OFF, opting the env into
the web-fetch capability and stating which rungs it may use. When absent or false, the agent SHALL
NOT reach for the web-fetch skill unprompted. The capability summary shown for the env SHALL reflect
the declaration.

#### Scenario: Env omits the declaration

- **WHEN** an environment does not set `capabilities.webFetch`
- **THEN** it SHALL resolve to off, and the web-fetch skill SHALL NOT be presented as available

#### Scenario: A research env opts in

- **WHEN** an environment sets `capabilities.webFetch` on with a set of allowed rungs
- **THEN** resolution SHALL preserve it and the web-fetch skill SHALL be available to that env's agent
