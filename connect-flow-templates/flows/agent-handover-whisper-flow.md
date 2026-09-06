# Agent handover guide flow — hand-merge guide (S-11)

Named to match the plan's original label, but the actual Amazon Connect mechanism is **not** a
classic Agent Whisper Flow. AWS's own **Show view** block documentation lists supported flow
types explicitly, and Agent whisper flow (along with Transfer to agent flow, Transfer to queue
flow, and every hold/whisper type) is **not** on it — only Inbound flow is. A Show view block
placed in an Agent Whisper Flow will not import/run as intended.

## The actual mechanism

1. In the inbound flow that hands off to `agent-handover-module.json` (or inside the module
   itself, before the `TransferContactToQueue` block), add a **Set event flow** block targeting
   the agent-connected event, pointing at a new Contact Flow of type Inbound — call it
   `agent-handover-guide-flow`.
2. That guide flow contains one **Compare** block on `$.Attributes.authenticated`, feeding two
   **Show view** blocks (Detail view, Set JSON) with the two `ViewData` payloads described in
   `../views/agent-handover-view.md`.
3. Assign no separate "Agent Whisper Flow" on the queue for this purpose — the module's own
   `TransferContactToQueue` still does the actual transfer; the guide flow only supplies the
   agent-side screen.

## Fallback if the target instance lacks Views / the unified Agent Workspace

Per the plan's own contingency: skip this file's mechanism entirely and rely on the CCP's native
"Additional attributes" panel, which shows contact attributes with no extra build. Phase 5's
manual verification checks this first and records which path was actually used.

## Extended by S-12

For an authenticated transfer, the guide flow continues past the existing screen-pop into the
interactive appointment-management sequence — see `agent-appointment-guide-fragment.md`.

## Reference

- AWS docs: "Show view" flow block → "Flow types" table (Inbound flow: Yes; every other type:
  No), "Set event flow" flow block.
- `../views/agent-handover-view.md` for the `ViewData` content.
