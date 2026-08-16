## ADDED Requirements

### Requirement: Launch is a guided, adaptive, multi-step wizard

The launch flow SHALL present configuration one step at a time rather than as a single form, and SHALL
show only the steps a given environment actually needs. The steps are Basics (name, size), GitHub
(connect + choose repo), Settings (agent, secrets), and a read-only Review that launches. The GitHub
step SHALL be present only when the environment is bring-your-own-repo; the agent choice SHALL appear
only when the environment offers more than one agent. Advancing SHALL be gated per step (a BYO repo
must be chosen; required secrets must be filled); going back SHALL never re-validate. Reaching Review
and launching SHALL send the same launch request as before and hand off to the existing post-create
phases (creating → login → agent → ready) unchanged.

#### Scenario: An environment with no repo and one agent

- **WHEN** a user launches a non-BYO, single-agent environment
- **THEN** the wizard SHALL show Basics → Settings → Review, with no GitHub step and no agent choice

#### Scenario: A bring-your-own-repo environment

- **WHEN** a user launches a BYO-repo environment
- **THEN** a GitHub step SHALL appear, and Next SHALL be disabled until a repository is chosen
- **AND** the Review step SHALL show the chosen repository before launch

#### Scenario: Launch is unchanged downstream

- **WHEN** the user confirms launch from the Review step
- **THEN** the same launch request SHALL be sent as the single-form flow sent
- **AND** the post-create provisioning and setup phases SHALL behave identically

### Requirement: The launch wizard survives a page reload

An in-progress launch configuration SHALL be restored after a page reload — both the current step and
the fields already entered — so a refresh does not discard the user's input. The draft SHALL be scoped
to the environment being launched, SHALL be cleared once a pod is successfully created, and SHALL NOT
persist beyond the browser tab.

#### Scenario: Reload mid-configuration

- **WHEN** a user has filled fields on a step and reloads the page
- **THEN** the wizard SHALL return to that step with the entered fields still populated

#### Scenario: Draft cleared after launch

- **WHEN** a pod is successfully created from the wizard
- **THEN** the saved draft for that environment SHALL be cleared
