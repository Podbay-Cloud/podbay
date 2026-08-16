# Public documentation portal

## Purpose

Podbay SHALL provide public, task-oriented product documentation for early adopters at
`/docs`. The documentation SHALL explain the shipped platform in plain language and organize
capabilities around the outcomes a person can ask the agent to deliver.

## Requirements

### Requirement: Documentation is part of the public product site

The documentation SHALL be served by the existing web application at `podbay.cloud/docs`, share the
Podbay brand and public navigation, and remain readable without authentication. Public documentation
pages SHALL be included in the site map and carry page-specific title, description, canonical, and
Open Graph metadata.

#### Scenario: A signed-out visitor opens documentation

- **WHEN** a visitor opens `/docs` without a Podbay session
- **THEN** the documentation overview SHALL render without redirecting to sign-in
- **AND** it SHALL provide a visible route back to the product and a route to the dashboard

### Requirement: Documentation has a file-based source of truth

Public documentation SHALL be authored as Markdown or MDX under the web application rather than in
the repository's internal `docs/` planning and runbook tree. The content layer SHALL generate a page
tree, table of contents, and structured search data from those files at build time.

#### Scenario: A content page is added

- **WHEN** a valid MDX page is added to the public documentation collection and placed in navigation
- **THEN** the build SHALL generate a public route and include the page in documentation search

### Requirement: Readers can navigate and search the manual

The documentation SHALL provide responsive primary navigation, a hierarchical sidebar, per-page
table of contents where headings exist, previous/next navigation, and full-text search. Keyboard and
mobile users SHALL be able to open and use the navigation and search interfaces.

#### Scenario: A reader searches for a desired result

- **WHEN** a reader searches the docs for `weekly report`
- **THEN** search SHALL return scheduled-work content that explains how to ask Claude for that result

### Requirement: The first-run story uses Claude's official apps

Getting-started and self-host copy SHALL present the official Claude desktop and mobile apps as the
normal interface after sign-in. The browser terminal SHALL be described as an optional advanced,
diagnostic, or recovery surface—not as the default way to work with Claude.

#### Scenario: A new user follows the quick start

- **WHEN** the user finishes signing Claude in on a new pod
- **THEN** the next documented action SHALL be to continue the pod session in the official Claude app

### Requirement: Capability documentation starts with human outcomes

Primary documentation SHALL explain what the reader can ask Claude to accomplish, what information
to include in the request, what the reader receives, and which decisions remain under owner control.
It SHALL NOT require the reader to learn the in-pod CLI or present agent command syntax as the normal
workflow. Version-specific command help SHALL remain available to the agent inside the pod.

#### Scenario: A reader wants recurring work

- **WHEN** a reader opens the scheduled-work page
- **THEN** the page SHALL provide example outcomes and the timing, source, threshold, destination,
  and approval details worth giving Claude
- **AND** it SHALL NOT require the reader to translate that intent into a CLI command

### Requirement: Capability documentation distinguishes common runtime from prepared behavior

The manual SHALL cover persistent storage, services, databases, previews, secrets, schedules, run
tracking, health and recovery, web access, relay, and pod messaging. It SHALL describe the human
outcomes enabled by the pod's runtime tools while identifying features that vary by environment or
deployment, so readers do not assume every skill, monitor, or managed-cloud networking behavior
exists everywhere.

#### Scenario: A skill-backed monitor is described

- **WHEN** documentation describes a monitoring workflow supplied by a skill
- **THEN** it SHALL say that availability depends on the selected environment
- **AND** it SHALL distinguish that workflow from the runtime scheduler common to current pod images

### Requirement: Documentation is discoverable by agents

The web application SHALL expose `/llms.txt` as a plain-text index of public documentation pages,
with an accurate short product description and absolute links.

#### Scenario: An automated client reads the docs index

- **WHEN** a client requests `/llms.txt`
- **THEN** it SHALL receive UTF-8 plain text listing the current public documentation pages
