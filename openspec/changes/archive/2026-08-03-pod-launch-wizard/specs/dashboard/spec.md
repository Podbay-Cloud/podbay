## ADDED Requirements

### Requirement: Adding GitHub to an existing pod authorizes, chooses a repo, and clones it

Connecting GitHub to an already-running pod SHALL be a guided flow that authorizes the account, lets
the owner choose one of their repositories, and then places that repository in the pod — not merely a
token authorization. After authorization the flow SHALL present a repository picker (the owner's
repositories for the pod's connection) and, on selection, SHALL clone the repository into the pod's
`~/work`. The outcome SHALL be surfaced to the owner: a success when the repository is placed, or the
"one pod, one repo" refusal when `~/work` already has code. Only the pod's owner SHALL be able to
initiate the clone.

#### Scenario: Connect and clone on an empty pod

- **WHEN** the owner connects GitHub to a pod whose `~/work` is empty and picks a repository
- **THEN** the repository SHALL be cloned into `~/work` and the cockpit SHALL confirm it

#### Scenario: Connect on a pod that already has code

- **WHEN** the owner picks a repository for a pod whose `~/work` already contains a workspace
- **THEN** the cockpit SHALL show that the pod already has a workspace and no files SHALL be changed
