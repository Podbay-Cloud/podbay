## Why

A user often wants to relay work between their own agents: "ask the makore.app pod to regenerate the
sitemap and tell me the count," or, from inside makore, "ask the podbay-dev pod to implement X." Today
the user is the router — they copy a request from one pod's terminal into another. This change
automates that relay **between a single user's own pods**, so agents can pass each other information
and requests like a lightweight inbox.

The hard part is NOT the mailbox — it is **waking an idle agent**. MCP (the obvious "shared server"
instinct) is request/response: an idle agent at its REPL is not consuming an MCP notification stream
and deciding to take a turn. A message only *becomes* action when something gives the agent a turn.
Podbay already has that primitive and the transport for it:

- the **in-pod scheduler**, **greeter**, and **session-handoff** already "wake" an agent by injecting
  a turn into its live tmux session (idle-gated);
- the **control plane already polls every pod on its reconcile loop** and drains what the pod reports
  (the fetch-memory pattern — the pod never calls out, so there is no per-pod outbound credential).

So messaging is a small, podbay-native build that reuses both halves. It is deliberately **not**
MCP-first: MCP can be a nicer interface later, but it cannot solve the wake, and a shared MCP server
would have to re-implement the owner-scoping the control plane already enforces for free.

## What Changes

- **A per-owner message store** (`agent_messages`) in the control plane, scoped so a message is only
  ever routed between pods of the **same owner**.
- **Sending needs no pod-outbound credential:** a pod appends to a local outbox on its volume; the
  reconcile poll drains it (exactly like fetch-memory reports).
- **Delivery wakes the recipient by injecting a turn** into its live agent session on the reconcile
  poll (the same tmux injection used for handoff), idle-gated and delivered at most once. The injected
  turn frames the message as **information/request from another of your agents — DATA, not
  authorization**: the receiving agent still needs the owner's explicit yes for any outward or
  irreversible action, per the standing runtime rules.
- **Suspended recipients queue** and receive on next wake (same re-delivery path as secrets/handoff).
- **A loop/rate guard** caps per-pair traffic and frames delivery so the recipient decides whether a
  reply/action is warranted rather than auto-acknowledging — preventing unbounded agent ping-pong.
- **In-pod CLI:** `podbay msg send <pod> "…"`, `podbay msg inbox`, `podbay msg reply <id> "…"`.

Explicitly NOT in this change: MCP transport; cross-user messaging; real-time (sub-poll) latency;
auto-execution of a relayed request without the owner's approval.

## Compliance dependency (read before building)

This feature rides podbay's existing **subscription-automation posture** — it injects turns into an
agent running on the user's personal Claude/OpenAI subscription, same as the scheduler already does.
That is defensible on **API-key pods** and genuinely gray on **consumer subscriptions** (see
[docs/plans/api-key-pod-mode.md](../../../docs/plans/api-key-pod-mode.md) and
[docs/plans/agent-auth-plan.md](../../../docs/plans/agent-auth-plan.md)). Messaging adds no *new* TOS
surface, but it makes agent-to-agent automation more visible, so: default to **user-initiated** relays
(not autonomous loops), and treat API-key mode as the clean-compliance home for messaging-heavy or
unattended pods.

## Capabilities

### New Capabilities
- `agent-messaging`: durable, owner-scoped message passing between a user's own pods, delivered by
  waking the recipient agent with an injected, clearly-framed turn.
