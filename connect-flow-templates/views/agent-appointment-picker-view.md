# Agent appointment picker view — hand-merge guide (S-12)

Not an importable resource — same caveat as `agent-handover-view.md`: this documents the
`ViewData` a human builds in the console for a customer-managed view (built via the No-Code UI
Builder), not a source of truth for exact syntax the way committed flow/module JSON is.

## Which managed view

**Customer-managed view**, built once, reused across every list-of-choices screen this slice
needs — the operation chooser, specialty, time-of-day, day, time, and the appointment list for
cancel/reschedule. A screen picker has no keypad-menu-length constraint, so it always renders
every item it's given (up to 4) in one screen.

## Fields

Every call site sets the same two inputs via the **Show view** block's Set JSON option:

- `title` — a short heading naming the current step (e.g. "Co chcesz zrobić?",
  "Wybierz specjalizację", "Wybierz termin").
- `items` — an array of 1-4 label strings, one per selectable row.

## Call sites and their `items`

| Screen | `items` content |
| --- | --- |
| Operation chooser | 3 fixed labels: create / cancel / reschedule |
| Specialty | the specialty list the caller-facing flows already offer |
| Time of day | the fixed time-of-day options the caller-facing flows already offer |
| Day | `day1`-`day3` from `agent-appointment`'s `days`/`times` step output |
| Time | `time1`-`time3` from `agent-appointment`'s `times` step output |
| Appointment list (cancel/reschedule) | `appt1`-`appt4` from `agent-appointment`'s `list` step output |

## Submission

The agent's selection reads back as `$.Views.ViewResultData.selection` — a 1-based index into
`items`, matching this codebase's existing position-based selection convention for
cancel/reschedule (`selectedSlot`, `dayChoice`, `timeChoice`).

## Where this actually gets shown

See `../flows/agent-appointment-guide-fragment.md` — every **Show view** block using this
template lives inside `agent-handover-guide-flow`, the only flow type this codebase can run a
Show view block from (see `agent-handover-whisper-flow.md`).

## Reference

- Underlying Lambda output fields: `agent-appointment`'s per-step contract, documented in
  `docs/reference/contract-surfaces.md`.
- AWS docs: "Show view" flow block, custom views (No-Code UI Builder).
