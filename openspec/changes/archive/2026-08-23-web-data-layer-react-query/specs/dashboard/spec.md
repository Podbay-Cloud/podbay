## ADDED Requirements

### Requirement: Cockpit and pod-list data is near-realtime, renders immediately, and never gets stuck

The dashboard pod list and the pod cockpit SHALL present live data that is near-realtime, renders
without a jarring empty-then-populate jump, refreshes in the background, and never leaves a surface
stuck on a loading state when a fetch fails or is slow.

#### Scenario: Data is shown immediately, not after a fetch round-trip

- **WHEN** the owner opens a pod's cockpit, or switches to a cockpit tab, they have viewed this session
- **THEN** the surface renders its last-known data immediately from cache rather than a blank/loading
  first paint, and updates in place once fresh data arrives (a genuine cold first load shows a skeleton)

#### Scenario: Displayed data stays near-realtime, never silently stale

- **WHEN** a surface is shown from cache
- **THEN** it refetches in the background right away so what is displayed reflects the current state
  within about a second — it SHALL NOT present cached, minute-old data as if it were current

#### Scenario: A failed or slow fetch never sticks on loading

- **WHEN** a data fetch rejects, times out, or returns a transient empty result
- **THEN** the surface does not hang on a loading placeholder forever — it retries (bounded), keeps
  the last-known data visible rather than clobbering it with an empty result, and surfaces an error
  state only when there is genuinely nothing to show

#### Scenario: Switching tabs does not lose or wrongly reset data

- **WHEN** the owner navigates away from a cockpit tab and back
- **THEN** that tab shows its data immediately (not "Status unavailable" / a fresh loading spinner),
  because the data is cached rather than cold-refetched from scratch on every switch

### Requirement: Loading placeholders are skeletons, not blank space or a bare spinner

While a surface has no data to show yet (a first-ever load with no cache/prefetch), it SHALL present a
skeleton that mirrors the shape of the content, not an empty panel or a lone centered spinner.

#### Scenario: First load shows a skeleton

- **WHEN** a pod card, or a cockpit tab, has no cached or prefetched data yet
- **THEN** it renders a skeleton placeholder matching the content layout, replaced in place when data
  arrives
