# Agent appointment guide-flow extension — hand-merge guide (S-12)

Like `speech-bookingintent-fragment.md`, this is **not** a standalone flow — hand-merge this into
the already-committed `agent-handover-guide-flow` (see `agent-handover-whisper-flow.md`),
immediately after the existing authenticated-branch Detail-view **Show view** block. This
extension only runs for an authenticated transfer; an unauthenticated transfer stops at the
existing placeholder screen, unchanged.

## Block sequence

1. **Show view** (picker, per `../views/agent-appointment-picker-view.md`) —
   `title`: "Co chcesz zrobić?", `items`: `["Umów wizytę", "Odwołaj wizytę", "Przełóż wizytę"]`.
2. **Compare** on `$.Views.ViewResultData.selection` — `"1"` → create sub-sequence, `"2"` →
   cancel sub-sequence, `"3"` → reschedule sub-sequence.

Each sub-sequence alternates **Invoke AWS Lambda function** (`agent-appointment`, passing
`operation`, `step`, `patientId`, `authenticated`, and every parameter accumulated from earlier
screens in that sub-sequence) and **Show view** blocks, mirroring the step order the equivalent
precedent Lambda already proved (see `context/pending-verification/agent-appointment-management/plan.md` →
"Critical Implementation Details").

### Create sub-sequence (`operation: 'create'`)

1. Show view (picker) — specialty list → `specialty`.
2. Show view (picker) — time-of-day list → `timeOfDay`.
3. Invoke Lambda (`step: 'days'`) → Show view (picker, `day1`-`day3`) → `dayChoice`.
   - `available: 'false'` → Show view (message) "Brak dostępnych terminów.", loop back to step 2
     (fresh time-of-day search) — no attempt cap (see plan's Critical Implementation Details).
4. Invoke Lambda (`step: 'times'`) → Show view (picker, `time1`-`time3`) → `timeChoice`.
   - `available: 'false'` → same message + loop-back as step 3.
5. Invoke Lambda (`step: 'confirm'`) → Show view (confirm, `body`: Lambda's `message`).
   - Yes → Invoke Lambda (`step: 'book'`) → Show view (message, `body` derived from `booked`) →
     **end of guide flow**.
   - No → loop back to step 3 (fresh day search), `specialty`/`timeOfDay` retained.

### Cancel sub-sequence (`operation: 'cancel'`)

1. Invoke Lambda (`step: 'list'`) → Show view (picker, `appt1`-`appt4`) → `selectedSlot`.
   - `hasAppointments: 'false'` → Show view (message) "Brak zaplanowanych wizyt." →
     **end of guide flow**.
2. Invoke Lambda (`step: 'confirm'`) → Show view (confirm, `body`: Lambda's `message`).
   - `found: 'false'` (stale selection) → Show view (message) "Ta wizyta jest już nieaktualna.",
     loop back to step 1 with a fresh list.
   - Yes → Invoke Lambda (`step: 'cancel'`) → Show view (message, `body` derived from
     `cancelled`) → **end of guide flow**.
   - No → loop back to step 1 with a fresh list.

### Reschedule sub-sequence (`operation: 'reschedule'`)

1. Invoke Lambda (`step: 'list'`) → Show view (picker, `appt1`-`appt4`) → `selectedSlot`.
   - `hasAppointments: 'false'` → Show view (message) "Brak zaplanowanych wizyt." →
     **end of guide flow**.
2. Show view (picker) — time-of-day list → `timeOfDay`.
3. Invoke Lambda (`step: 'days'`) → Show view (picker, `day1`-`day3`) → `dayChoice`.
   - `found: 'false'` (stale selection) → loop back to step 1 with a fresh list.
   - `available: 'false'` → Show view (message) "Brak dostępnych terminów.", loop back to step 2.
4. Invoke Lambda (`step: 'times'`) → Show view (picker, `time1`-`time3`) → `timeChoice`.
   - `found: 'false'` → loop back to step 1. `available: 'false'` → loop back to step 3.
5. Invoke Lambda (`step: 'confirm'`) → Show view (confirm, `body`: Lambda's `message`).
   - `found: 'false'` → loop back to step 1. `available: 'false'` → loop back to step 3.
   - Yes → Invoke Lambda (`step: 'reschedule'`) → Show view (message, `body` derived from
     `rescheduled`) → **end of guide flow**.
   - No → loop back to step 3, `selectedSlot`/`timeOfDay` retained.

## After every sub-sequence

Every branch ends on a message-mode confirm/message view; the guide flow then ends normally —
no loop back to the operation chooser (PRD's "no agent workflow beyond the three operations").
A second request in the same call means re-triggering the guide, not looping inside it.

## Reference

- `../views/agent-appointment-picker-view.md`, `../views/agent-appointment-confirm-view.md` for
  the two View templates every screen above reuses.
- `agent-handover-whisper-flow.md` for where this extension attaches and why Show view blocks can
  only run from this flow.
- `context/pending-verification/agent-appointment-management/plan.md` for the Lambda's full per-step contract.
