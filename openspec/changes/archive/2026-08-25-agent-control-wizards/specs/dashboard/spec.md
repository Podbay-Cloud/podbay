## ADDED Requirements

### Requirement: Agent sign-in and reconnect run as a full-page wizard

When an owner signs a pod's Claude agent in (or reconnects it) from the Control tab, the cockpit SHALL present a **full-page takeover** flow that replaces the normal cockpit tabs (the same pattern as pod update / T3-enable), not a block squeezed inside the agent card. The wizard SHALL show a header (a status dot, the pod name, and a "Claude sign-in" label), the line "Sign this pod in to Claude so you can drive it from the Claude app or browser." (no additional reassurance copy), a **Step 1** that opens the agent's sign-in page (the OAuth URL) with the caption "Approve it, then Claude shows you a code to paste back.", and a **Step 2** with a paste-the-code input and a submit control. After the code is submitted it SHALL show a "Signing in…" progress state, and SHALL return to the cockpit automatically once the agent reports authed. Reconnect SHALL reuse the same screen titled "Reconnect Claude". The sign-in mechanics (OAuth URL, code submission, reconnect action) are unchanged — only the presentation moves to full-page.

#### Scenario: Signing in takes over the cockpit and returns on success

- **WHEN** the owner starts (or reconnects) Claude sign-in on a running pod
- **THEN** the cockpit SHALL replace its tabs with the full-page sign-in wizard (open-sign-in-page + paste-code + "Signing in…"), and SHALL return to the normal cockpit automatically once the agent is authed

#### Scenario: The wizard omits the removed reassurance copy

- **WHEN** the Claude sign-in wizard renders
- **THEN** it SHALL NOT show a "files/git/settings are untouched" reassurance line or a "safe to close this tab" note

### Requirement: Codex pairing runs as a full-page wizard

Connecting the ChatGPT app to a pod's Codex agent SHALL be presented as a **full-page takeover** wizard (like update/T3-enable), not an inline card block. It SHALL keep the existing Phone/Desktop step-1 pairing instructions (how to reach the pair screen and enter the code, with the QR on a wide viewport + Phone), a **step 2 "Open your session"** that renders the shared "continue this Codex session" guidance (below), and SHALL refer to the **ChatGPT app** (not "Codex app"). It SHALL NOT show a "Remote control needs the pod awake…" footer line.

#### Scenario: Pairing takes over the cockpit and keeps the pairing steps

- **WHEN** the owner opens Codex pairing on a running pod
- **THEN** the cockpit SHALL show the full-page pairing wizard with the Phone/Desktop step-1 pairing instructions intact and step-2 "Open your session" showing the shared continue-session guidance, and no "pod awake" footer

### Requirement: One shared "Continue this Codex session" guidance

The guidance for continuing a Codex session in the ChatGPT app SHALL be defined ONCE and rendered verbatim by BOTH the Codex info "(i)" modal and the Codex pairing wizard's "Open your session" step, so the two cannot drift. It SHALL be titled "Continue this Codex session" and cover the **ChatGPT app** on mobile and desktop: on **mobile**, once paired the pod appears automatically under Remote → Projects as a project named "work" with the pod name shown underneath, and the owner taps it; on **desktop**, the pod is added once as a remote project (+ next to Projects → Remote → name it after the pod → pick the pod as Remote host → set Source folder to `work`, replacing the `/home/dev` default → Add project), and thereafter opened from the sidebar. The pod name SHALL be interpolated wherever "[pod name]" appears.

#### Scenario: The info modal and the pairing wizard show identical continue-session copy

- **WHEN** the owner opens the Codex "(i)" info modal OR reaches step 2 of the pairing wizard
- **THEN** both SHALL render the same "Continue this Codex session" mobile + desktop guidance from a single shared source, referring to the ChatGPT app and naming the pod where "[pod name]" appears
