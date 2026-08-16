## ADDED Requirements

### Requirement: A running pod can clone an authorized repo into an empty workspace

The pod agent SHALL accept a request to clone a GitHub repository into the workspace at `~/work`, using
the GitHub credentials already installed in the pod (via the gh credential store, never a token in a
URL or on the command line), and running as the workspace-owning `dev` user. The clone SHALL target
`~/work` directly — never a per-repo subdirectory — so the workspace path is identical across pods.

Because one pod maps to one repository, the clone SHALL proceed only when `~/work` is empty. When
`~/work` already contains files, the request SHALL be refused with a clear message and SHALL NOT modify
or overwrite any existing file. The request SHALL be owner-gated upstream.

#### Scenario: Clone into an empty workspace

- **WHEN** a clone is requested for a pod whose `~/work` is empty
- **THEN** the repository SHALL be cloned into `~/work` and the request SHALL report success with the
  destination

#### Scenario: Refuse a non-empty workspace

- **WHEN** a clone is requested for a pod whose `~/work` already contains files
- **THEN** the request SHALL be refused with a "one pod, one repo" message
- **AND** no existing file in `~/work` SHALL be changed
