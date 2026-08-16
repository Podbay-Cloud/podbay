## ADDED Requirements

### Requirement: The local dashboard explains the relay and reports its real state

The owner dashboard SHALL lead with whether the relay daemon is running and whether its gateway link is connected, reconnecting, or unavailable. It SHALL explain in plain language that the owner's pods may borrow this computer's public internet connection, distinguish page fetches from tunnel connections, distinguish residential-IP use from signed-in-session use, and state that the detailed view is stored locally.

Every summary value SHALL have its own label, unit where applicable, and selected time range. A value SHALL NOT rely on its visual position between columns to communicate what it measures.

The dashboard SHALL keep relay state, local-only disclosure, and the global Stop action visible across four job-oriented tabs: Overview, Activity, Pods, and Controls. The active tab SHALL survive refresh through the local URL, support browser navigation and keyboard tab behavior, and expose attention counts without requiring the owner to open every tab.

#### Scenario: Running and connected

- **GIVEN** the relay daemon is running with an open gateway link
- **WHEN** the owner opens the local dashboard
- **THEN** the page SHALL report that the relay is connected, explain both relay modes, and show explicitly labeled values for the selected time range

#### Scenario: Owner switches between dashboard jobs

- **GIVEN** the owner is viewing the dashboard on a desktop computer
- **WHEN** they switch among Overview, Activity, Pods, and Controls
- **THEN** only the selected job panel SHALL be presented while relay state, local-only disclosure, Stop, and any attention badge remain visible

#### Scenario: Saved history while stopped

- **GIVEN** the relay is not running and retained events exist
- **WHEN** the owner runs `relay dashboard`
- **THEN** the page SHALL state that the relay is stopped and that it is showing saved local history without implying that pods can currently use it

### Requirement: Local history answers which pod did what

For every new relay event, the local history SHALL retain the gateway-authoritative source pod id when available, mode, safe target, start/end timing, outcome, refusal/error reason, signed-in-session use, HTTP status when applicable, and directional bytes when applicable. The dashboard SHALL provide chronological activity, per-pod summaries, per-site summaries, live in-flight fetches and tunnel connections, and filters for time range, pod, mode, outcome, and site.

Unknown-source and system health-check events SHALL be labeled honestly and SHALL NOT be attributed to a pod.

#### Scenario: Two pods use one relay

- **GIVEN** two pods owned by the user fetch or tunnel through the same relay
- **WHEN** the owner views pod summaries or filters activity to either pod
- **THEN** each event and rollup SHALL be attributed to the correct gateway-supplied pod id

#### Scenario: Live tunnel activity

- **GIVEN** a pod has an open tunnel connection
- **WHEN** the dashboard refreshes
- **THEN** the live view SHALL show its pod, target host and port, elapsed duration, and current bytes up and down without waiting for the connection to close

#### Scenario: Old event has no source

- **GIVEN** an event predates pod attribution or arrives from an older gateway
- **WHEN** it is displayed
- **THEN** it SHALL appear as “Unknown pod” rather than being omitted or guessed

### Requirement: The dashboard directs attention to meaningful outcomes

The dashboard SHALL distinguish successful work, site refusals, owner blocks, safety blocks, rate limits, and network errors. When attention-worthy events exist in the selected range, it SHALL summarize them in plain language and link each summary to the matching filtered activity. Empty and healthy states SHALL explain what will appear next rather than rendering an empty table.

#### Scenario: Private-network target is blocked

- **GIVEN** a relay request was refused by a private-network safety guard
- **WHEN** the owner opens the dashboard
- **THEN** the attention area SHALL identify a safety-blocked attempt, its source pod when known, its safe target, and the reason without displaying it as a generic failed count

#### Scenario: No relay use yet

- **GIVEN** no retained or active events exist
- **WHEN** the owner opens the dashboard
- **THEN** it SHALL explain that activity will appear when a pod fetches a page or uses its relay proxy and SHALL still show how to stop the relay and manage signed-in sites

### Requirement: The owner can narrow or stop relay authority locally

The running dashboard SHALL let the owner stop the entire relay, pause and resume relay access for an observed pod, block and unblock a site across pods, and revoke signed-in-session use for a site. Pausing or blocking SHALL be an explicit deny layered on top of clean public-web access; the owner SHALL NOT have to maintain an allowlist or approve individual requests.

An owner-denied request SHALL do no browser or socket work, SHALL return an actionable refusal to the requesting pod, and SHALL be recorded locally as owner-blocked. Revoking signed-in use SHALL affect subsequent fetches immediately and SHALL be presented separately from blocking clean access to the site.

#### Scenario: Owner pauses one pod

- **GIVEN** two pods have used the relay
- **WHEN** the owner pauses one pod from the local dashboard
- **THEN** later fetch and tunnel requests from that pod SHALL be refused as owner-blocked while the sibling pod remains eligible

#### Scenario: Owner blocks a site

- **GIVEN** multiple pods use the relay
- **WHEN** the owner blocks a domain
- **THEN** later fetch and tunnel requests to that domain from any of those pods SHALL be refused locally until the owner unblocks it

#### Scenario: Owner revokes signed-in use

- **GIVEN** a domain is configured to fetch using the owner's relay profile
- **WHEN** the owner revokes signed-in access for that domain
- **THEN** subsequent fetches to that domain SHALL use a clean context, while clean access remains available unless the domain is separately blocked

### Requirement: The owner controls local retention and portability

The relay SHALL keep a bounded local event history with a 30-day default and selectable 7-, 30-, and 90-day retention. The dashboard SHALL disclose the on-disk location and current size and SHALL let the owner export the retained sanitized events or clear history independently of pairing, signed-in sites, and deny rules.

Old audit rows and protocol frames without newer fields SHALL remain readable with unavailable values labeled unknown. The event query path SHALL NOT rescan an unbounded complete log on every dashboard refresh.

#### Scenario: Retention expires

- **GIVEN** local event partitions exceed the selected retention period
- **WHEN** retention maintenance runs
- **THEN** expired partitions SHALL be deleted without changing relay pairing, sessions, or deny rules

#### Scenario: Owner clears history

- **GIVEN** the owner confirms Clear history
- **WHEN** the action completes
- **THEN** retained and indexed events SHALL be removed while the relay remains paired and its access settings remain unchanged

#### Scenario: Owner exports history

- **GIVEN** retained events exist
- **WHEN** the owner requests an export
- **THEN** the browser SHALL download the same sanitized event fields available to the local dashboard without response content, credentials, query strings, or fragments

### Requirement: Detailed history remains private and safe on the owner's computer

The dashboard and its APIs SHALL bind only to loopback and SHALL NOT emit permissive cross-origin headers. Local files SHALL use owner-only permissions. State-changing endpoints SHALL require an unguessable per-process route, same-origin request, per-process CSRF token, POST method, and exact JSON content type. Event values SHALL be rendered as text, not executable markup.

Before writing a fetch target, the relay SHALL remove URL username, password, query, and fragment. It SHALL never write response/request bodies, cookies, authorization headers, or browser storage. Podbay SHALL NOT receive the locally retained path, pod history, or exported events.

#### Scenario: URL contains credentials and a query token

- **GIVEN** a pod requests `https://user:pass@example.com/private/report?token=secret#row`
- **WHEN** the relay records the event
- **THEN** local history MAY retain `https://example.com/private/report` but SHALL NOT retain `user`, `pass`, `token=secret`, or `#row`

#### Scenario: Hostile website posts to localhost

- **GIVEN** a page from another origin attempts a state-changing request to the dashboard's loopback port
- **WHEN** its origin, route token, or CSRF token is absent or invalid
- **THEN** the dashboard SHALL reject the request without changing relay state or local data

### Requirement: Opening the local dashboard is reliable across environments

`relay dashboard` SHALL keep serving the page when a supported desktop browser opener succeeds, when no opener is installed, and when the environment is headless. It SHALL always print the local URL. The daemon SHALL prefer the documented port but SHALL use another loopback port when that port is unavailable and publish the actual URL through owner-only runtime state.

#### Scenario: Linux has no xdg-open

- **GIVEN** `xdg-open` is unavailable
- **WHEN** the owner runs `relay dashboard`
- **THEN** the command SHALL print an actionable URL and continue serving rather than terminating with an unhandled child-process error

#### Scenario: Default port is occupied

- **GIVEN** another process owns the preferred dashboard port
- **WHEN** the relay dashboard starts
- **THEN** it SHALL bind another loopback port and print the actual URL

### Requirement: The dashboard is accessible and responsive

The local dashboard SHALL support keyboard operation, visible focus, semantic control names, non-color-only status, reduced-motion preferences, and narrow viewports without horizontal page overflow. Dense desktop activity rows SHALL become labeled stacked records or selectively hide secondary detail on narrow screens rather than detaching numbers from their headings.

#### Scenario: Owner uses a phone-sized viewport

- **GIVEN** a viewport 375 CSS pixels wide
- **WHEN** the dashboard contains multi-pod activity
- **THEN** primary status, pod attribution, outcomes, and controls SHALL remain readable and operable without horizontal page scrolling
