# Agent appointment confirm/message view — hand-merge guide (S-12)

Not an importable resource — same caveat as `agent-handover-view.md`: this documents the
`ViewData` a human builds in the console for a customer-managed view, not a source of truth for
exact syntax the way committed flow/module JSON is.

## Which managed view

**Customer-managed view**, built once, reused for every confirm-before-mutating step and every
final success/failure screen across all three operations — a second reusable template alongside
`agent-appointment-picker-view.md`, keeping the View-authoring surface to two templates total.

## Fields

Every call site sets three inputs via the **Show view** block's Set JSON option:

- `title` — a short heading (e.g. "Potwierdź", "Gotowe").
- `body` — the read-back or result message: `agent-appointment`'s `message` field for a confirm
  step, or a plain success/failure sentence for a final screen.
- `mode` — `"confirm"` shows Yes/No buttons; `"message"` shows a single OK/Done button.

## Submission

The agent's choice reads back as `$.Views.ViewResultData.action`: `"yes"` / `"no"` in confirm
mode, `"ok"` in message mode.

## Where this actually gets shown

See `../flows/agent-appointment-guide-fragment.md` — every **Show view** block using this
template lives inside `agent-handover-guide-flow`, the only flow type this codebase can run a
Show view block from (see `agent-handover-whisper-flow.md`).

## Reference

- Underlying Lambda output fields: `agent-appointment`'s per-step contract, documented in
  `docs/reference/contract-surfaces.md`.
- AWS docs: "Show view" flow block, custom views (No-Code UI Builder).
