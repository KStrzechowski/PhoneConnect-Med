# Agent handover view — hand-merge guide (S-11)

Not an importable resource. Views (Detail/List/Form/Confirmation/Cards) aren't hand-authored
JSON imported the way flows/modules are — they're either AWS-managed views referenced by ARN
(`arn:aws:connect:<region>:aws:view/<type>:<version>`) with content supplied per-block via the
**Show view** block's *Set JSON* option, or fully custom "customer-managed views" built in a
separate UI Builder tool outside this repo's flow-JSON convention. This guide documents the
`ViewData` a human builds in the console; it is not a source of truth for exact syntax the way
the committed flow/module JSON is.

## Which managed view

**Detail view** — built for exactly this case (surface information plus a list of actions at
call connect; see AWS's own guidance, "a common use case of the Detail view is to surface a
screen-pop to the agent at the start of a call").

## Fields

When `$.Attributes.authenticated` equals `"true"`:

- Heading: `$.Attributes.firstName` `$.Attributes.lastName`
- Attribute bar: PESEL (`$.Attributes.pesel`), phone (`$.Attributes.phone`)
- Body text: `$.Attributes.transferReason`

When not authenticated (any other value, including unset):

- Heading: "Tożsamość nie została jeszcze potwierdzona."
- Body text: `$.Attributes.transferReason`

Build both as two literal `ViewData` JSON payloads (Set JSON option on the **Show view** block),
selected by a `Compare` block on `$.Attributes.authenticated` immediately before it — same
branching shape as every other `authenticated` check in this repo's committed flows.

## Where this actually gets shown

See `../flows/agent-handover-whisper-flow.md` — the **Show view** block that renders this
content cannot live in a classic Agent Whisper Flow (unsupported flow type for that block); it
runs from a **Set event flow** target instead.

## Reference

- Underlying attributes: `docs/reference/contract-surfaces.md` → `transferReason` contact/session
  attribute (S-11), and the `authenticated`/`patientId`/`firstName`/`lastName` entries above it.
- AWS docs: "Show view" flow block, "Set up AWS managed views for an agent's workspace".
