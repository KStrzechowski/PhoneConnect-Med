# Agent Appointment Management Implementation Plan

## Overview

Roadmap slice S-12 (FR-017): an agent handling a transferred, authenticated call gets an
interactive sequence in the Agent Workspace to create, cancel, or reschedule the caller's
appointment — reusing the exact shared functions the keypad and speech variants already call, and
extending the exact screen-pop mechanism S-11 already built rather than inventing a new one.

## Current State Analysis

Every prerequisite this plan depends on is code-complete and sitting in
`context/pending-verification/`, awaiting manual confirmation against a real call:

- **S-05/S-07/S-08** (`appointment-booking-both-variants`, `appointment-cancel`,
  `appointment-reschedule`) built every business-logic primitive this plan needs in
  `lambdas/appointment/index.ts` (the `@pcm/appointment` package): `findAvailableDays`,
  `findAvailableTimes`, `resolveDay`, `resolveTime`, `listAppointments`, `resolveAppointment`,
  `bookAppointment`, `cancelAppointment`, `rescheduleAppointment`, `formatDayLabel`. No HIS
  entity, migration, or endpoint is missing — this plan adds zero new business logic.
- **S-11** (`agent-call-handover`) built the only mechanism by which Connect can show a custom
  screen to an agent mid-call: a `Set event flow` block (on the agent-connected event) targeting
  an Inbound-type "guide flow" (`agent-handover-guide-flow`, documented in
  `connect-flow-templates/flows/agent-handover-whisper-flow.md`), which branches on
  `$.Attributes.authenticated` and shows one of two `ViewData` payloads via a **Show view**
  block (AWS-managed Detail view) — see `connect-flow-templates/views/agent-handover-view.md`.
  `patientId`, `firstName`, `lastName`, and `authenticated` all already arrive as contact
  attributes by the time this guide flow runs.

The roadmap's own "At a glance" table still shows S-12's prerequisites as `proposed`/`in-progress`
— that reflects `/10x-archive` not having run yet, not missing code. All four are functionally
present.

## Desired End State

An agent whose transferred call is authenticated sees, immediately after the existing
patient-identity screen-pop, a choice of three operations. Picking one walks the agent through a
short, guided sequence of screens (matching the shape of the equivalent caller-facing flow —
specialty/time-of-day/day/time for a new booking, a list-and-confirm for a cancellation, a
list-then-day/time-then-confirm for a reschedule) and ends with a plain success/failure message.
The underlying mutation is verifiable exactly the way every prior appointment slice's manual
verification already checks it (the slot is booked/freed/moved in `his/`). An unauthenticated
transfer shows only S-11's existing placeholder screen — no operation choice, no new logic.

**Verification:** place a real call that reaches an authenticated agent transfer, exercise all
three operations plus the zero-appointments and no-availability edge cases, and confirm each
mutation against the mock's data directly (same method S-05/S-07/S-08's own manual verification
already uses).

### Key Discoveries:

- Every business-logic primitive this plan needs already exists and is already tested —
  `lambdas/appointment/index.ts` (whole file). This plan's Lambda phase is a pure interaction-layer
  wrapper, not new domain logic.
- `infra/lib/infra-stack.ts:474-499` (the `appointmentCancel` `NodejsFunction` + `addPermission` +
  `CfnIntegrationAssociation` block) is the exact pattern to mirror for the new function — VPC
  placement, security group, timeout, log group, and Connect permission are all identical across
  every existing appointment Lambda.
- AWS Connect customer-managed Views support interactive form/button controls whose submission
  returns to the flow as `$.Views.ViewResultData.*` attributes, and a flow can alternate **Invoke
  AWS Lambda function** and **Show view** blocks repeatedly within one still-active contact —
  confirmed against AWS's own documentation this session (Custom views, Show view block, and the
  step-by-step guides walkthrough all describe exactly this multi-screen pattern). This is what
  makes the whole feature possible without a separate agent application.
- `docs/reference/contract-surfaces.md` documents S-11's `agent-handover-guide-flow` as the only
  place in this codebase a `Show view` block can legally run (Show view is restricted to Inbound
  flow type; Agent Whisper Flow, Transfer to agent flow, and Transfer to queue flow are all
  explicitly unsupported per AWS's own "Flow types" table) — this plan's guide-flow extension has
  nowhere else it could go.

## What We're NOT Doing

- No new HIS entity, migration, endpoint, or change to `AppointmentService` — every mutation this
  plan performs already exists and is already covered by S-05/S-07/S-08's own tests.
- No separate agent application, second login, or role/permission model — the agent's existing
  Connect Agent Workspace session is the entire authentication boundary (PRD §Non-Goals).
- No "do another operation" loop after a successful or declined action — the guide flow ends after
  one operation; a second request in the same call means re-triggering the guide (PRD's literal
  "no agent workflow beyond the three operations").
- No fallback identity lookup for an unauthenticated transfer — the agent sees S-11's existing
  placeholder only; there is no patient to act on and no new identity-search capability is built.
- No change to the caller-facing appointment list cap, the shared query's `limit(4)`, or any
  caller-facing Polish message string — this plan writes its own distinct, concise agent-facing
  copy and touches no caller-facing text.
- No pagination for the agent's specialty/time-of-day/day/time pickers — a screen list has no
  keypad-menu-length constraint, so all options render in one picker screen; no reserved
  "more" digit or paging state is needed.
- No changes to FR-019's onward-transfer capability — that is stock platform functionality already
  confirmed working by S-11.

## Implementation Approach

One new Lambda (`agent-appointment`) dispatches by an `operation` parameter (`create` / `cancel` /
`reschedule`) plus a `step` parameter, internally mirroring the step logic already proven in
`lambdas/booking`, `lambdas/appointment-cancel`, and `lambdas/appointment-reschedule` — each
operation branch calls the identical `@pcm/appointment` functions those Lambdas already call, so no
domain decision is duplicated (L-03 extends naturally: the agent surface is a third "variant" of
input collection over the same shared logic).

Two reusable, parameterized custom Views (a list/button **picker** and a **confirm-or-message**
view) serve every screen across all three operations — the content of each screen is supplied
per-call via the Show view block's Set JSON option, the same technique
`connect-flow-templates/views/agent-handover-view.md` already uses to branch Detail-view content on
`authenticated`. This directly targets the roadmap's own named risk for this slice ("the one place
in the project where an afternoon can quietly become interface work") by keeping the View-authoring
surface to two templates instead of one screen per step.

The interactive sequence is appended to S-11's existing `agent-handover-guide-flow`, gated behind
the same `$.Attributes.authenticated` branch that guide flow already has — an authenticated call
sees the existing screen-pop, then the new operation picker; an unauthenticated call is entirely
unchanged.

## Critical Implementation Details

- **Screen lists surface more than the caller-facing cap, without touching the shared query.** The
  caller-facing `appointment-list`/`appointment-cancel`/`appointment-reschedule` Lambdas cap what
  they *surface* at 3 appointments (`appt1`–`appt3`) even though `findAppointmentsForPatient`
  already returns up to 4 — that cap exists only because a spoken menu can't offer a 4th item
  cleanly. This plan's agent Lambda surfaces all rows the same unmodified query returns
  (`appt1`–`appt4`) since a screen picker has no such constraint. The underlying query and its
  `limit(4)` in `his/src/appointment/appointment.service.ts` are untouched.
- **L-05's 3-retry cap does not apply here.** That lesson governs voice-channel menu digits
  (no-input timeout, invalid-digit retry). A View submission has no equivalent failure mode — the
  agent either picks a valid option or doesn't submit — so no attempt counter is added anywhere in
  this plan; an agent can be routed back to a fresh list as many times as a selection turns out
  stale, with no cap.
- **The new screens can only live inside S-11's existing guide flow.** `Show view` blocks are
  restricted to Inbound flow type; Agent Whisper Flow and Transfer to agent/queue flow types are
  explicitly unsupported. `agent-handover-guide-flow` is therefore not just a convenient place to
  extend — for `Show view` blocks that need to render mid-call to a connecting agent, it is the
  only place in Connect's flow-type taxonomy this can run at all.

## Phase 1: Agent Appointment Lambda + Infrastructure Wiring

### Overview

A single new Lambda handles all three operations, reusing `@pcm/appointment` directly, and gets
registered in CDK following the existing appointment-Lambda pattern exactly.

### Changes Required:

#### 1. New shared-logic-consuming Lambda

**File**: `lambdas/agent-appointment/index.ts`

**Intent**: Dispatch on `operation` (`'create' | 'cancel' | 'reschedule'`) then `step`, mirroring
the step logic already proven in `lambdas/booking/index.ts` (create: `days`/`times`/`confirm`/
`book`), `lambdas/appointment-cancel/index.ts` (cancel: `list`/`confirm`/`cancel`), and
`lambdas/appointment-reschedule/index.ts` (reschedule: `list`/`days`/`times`/`confirm`/
`reschedule`) — each branch calling the identical `@pcm/appointment` functions its precedent
Lambda already calls. Guard on `authenticated !== 'true'` the same way every precedent Lambda
does, returning `needsAuth: 'true'`, even though the guide flow's own branch should never reach
this Lambda in that state — matches the "nothing enforces this; flows are hand-built" safety-net
pattern every other Lambda in this codebase already follows. Wrap the whole handler in
`measured('agent-appointment', ...)` from `@pcm/measure`, matching every sibling Lambda; this
Lambda naturally has no `variant` (keypad/speech) — it produces no A-vs-B comparison data, per
FR-017's own resolution, so its records are expected to be missing that field.

**Contract**: Input via `event.Details.Parameters`: `operation`, `step`, `patientId`,
`authenticated`, plus per-operation fields — `specialty`/`timeOfDay`/`dayChoice`/`timeChoice` for
`create`; `selectedSlot` for `cancel`; `selectedSlot`/`timeOfDay`/`dayChoice`/`timeChoice` for
`reschedule`. Output fields mirror each precedent step's exact shape (`available`, `day1`–`day3`,
`time1`–`time3`, `date`, `time`, `message`, `booked`, `found`, `cancelled`, `rescheduled`), with
one deviation: the `list` step (shared by `cancel` and `reschedule`) surfaces `appt1`–`appt4`
(all rows the query returns) instead of the caller-facing `appt1`–`appt3` + `hasMore` — see
Critical Implementation Details.

#### 2. Unit tests

**File**: `lambdas/agent-appointment/index.test.ts`

**Intent**: One test per step/outcome combination, structurally mirroring
`lambdas/appointment-cancel/index.test.ts` and `lambdas/appointment-reschedule/index.test.ts` —
same `node --test` + mock-fetch style already used across every Lambda's test file.

**Contract**: Co-located Node test file, `npm test` runnable from the package directory exactly
like every sibling Lambda.

#### 3. Package scaffolding

**Files**: `lambdas/agent-appointment/package.json`, `lambdas/agent-appointment/tsconfig.json`

**Intent**: Workspace package config identical in shape to `lambdas/appointment-cancel/package.json`
and its `tsconfig.json` — same `@pcm/measure` + `@pcm/appointment` dependencies, same `node --test`
script.

**Contract**: Copy the sibling files, renaming only `"name"`.

#### 4. CDK registration

**File**: `infra/lib/infra-stack.ts`

**Intent**: Register the new function and its Connect integration association, following the
`appointmentCancel`/`appointmentReschedule` block pattern exactly (VPC-attached, public subnet,
shared `functionSecurityGroup`, `MOCK_BASE_URL` environment variable, 2-second timeout, shared
`measurements` log group, JSON logging format), per L-04's naming rule.

**Contract**: New `NodejsFunction` construct id `AgentAppointment`, `functionName:
'phoneconnect-med-agent-appointment'`, entry `lambdas/agent-appointment/index.ts`; an
`addPermission('ConnectInvoke', ...)` call identical to the existing three; a new
`CfnIntegrationAssociation`; a new `CfnOutput('AgentAppointmentFunctionName', ...)`. Insert
alongside the existing appointment-* function block — mirror
`infra/lib/infra-stack.ts:474-499` (the `appointmentCancel` block) field-for-field.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test` in `lambdas/agent-appointment`
- Type checking passes: `npx tsc --noEmit` (or the repo's existing typecheck script) covers the
  new package
- CDK synth succeeds with the new function: `npx cdk synth` in `infra/`

#### Manual Verification:

- The deployed function can be invoked directly (Lambda console test event, using a
  `event.sample.json` per existing convention) for each of the three operations' first step, and
  returns output matching its mirrored precedent Lambda's equivalent step

---

## Phase 2: Reusable Agent-Side View Templates

### Overview

Two generic, parameterized custom Views serve every screen across all three operations, keeping
the View-authoring surface to two templates instead of one screen per step.

### Changes Required:

#### 1. Picker view guide

**File**: `connect-flow-templates/views/agent-appointment-picker-view.md`

**Intent**: Document a customer-managed view (built via the No-Code UI Builder, content supplied
per-call via the Show view block's Set JSON option — the same per-call `ViewData` technique
`agent-handover-view.md` already documents) taking a `title` and a list of 1-4 selectable items,
whose submission returns which item was picked. Reused, with different `title`/items content per
call site, for: the operation chooser (3 items), specialty selection, time-of-day selection, day
selection, time selection, and the appointment list (cancel/reschedule).

**Contract**: Follow `agent-handover-view.md`'s own doc shape (Fields section listing what each
call site sets, a note on where this gets shown, a Reference section). Submitted selection reads
back as `$.Views.ViewResultData.selection` (a 1-based index into the items list, matching this
codebase's existing position-based selection convention for cancel/reschedule).

#### 2. Confirm/message view guide

**File**: `connect-flow-templates/views/agent-appointment-confirm-view.md`

**Intent**: Document a second customer-managed view taking a `title`, a `body` read-back or result
message, and a `mode` (`'confirm'` → Yes/No buttons, `'message'` → a single OK/Done button). Used
for every confirm-before-mutating step and every final success/failure screen across all three
operations.

**Contract**: Same doc shape as the picker guide. Submitted choice reads back as
`$.Views.ViewResultData.action` (`'yes'` / `'no'` / `'ok'`).

### Success Criteria:

#### Automated Verification:

- None — console-authored artifacts; the `.md` files are documentation, not imported/tested code

#### Manual Verification:

- Both views built in the console per their guides and previewable in isolation (console's view
  preview) with representative sample content before being wired into any flow

---

## Phase 3: Guide Flow Wiring

### Overview

Extend S-11's existing `agent-handover-guide-flow` so an authenticated transfer continues past the
existing screen-pop into the new interactive sequence.

### Changes Required:

#### 1. Guide-flow extension guide

**File**: `connect-flow-templates/flows/agent-appointment-guide-fragment.md` (new)

**Intent**: Document the block sequence to hand-merge into `agent-handover-guide-flow`, immediately
after the existing authenticated-branch Detail-view Show view block: Show view (picker, chooser
content) → Compare on `$.Views.ViewResultData.selection` → three sub-sequences. Each sub-sequence
alternates **Invoke AWS Lambda function** (`agent-appointment`, with `operation`, `step`, and the
relevant accumulated parameters) and **Show view** (picker or confirm/message) blocks, following
each precedent operation's own step order (create: specialty → time-of-day → days → times →
confirm → book; cancel: list → confirm → cancel; reschedule: list → time-of-day → days → times →
confirm → reschedule). A declined confirmation or a `found: 'false'` / `available: 'false'` result
loops back to that operation's list/picker step with fresh data (no attempt cap — see Critical
Implementation Details). Every sub-sequence ends on a message-mode confirm/message view, after
which the guide flow ends (no loop back to the chooser).

**Contract**: Follow the naming and structure convention of the existing `speech-*-fragment.md`
docs (e.g. `speech-bookingintent-fragment.md`) — a fragment that extends an already-committed
flow's documentation rather than duplicating it.

#### 2. Pointer update in the existing guide-flow doc

**File**: `connect-flow-templates/flows/agent-handover-whisper-flow.md`

**Intent**: Add a short cross-reference to the new fragment, matching how other flow docs point to
their fragments.

**Contract**: One new line/section pointing to
`../flows/agent-appointment-guide-fragment.md`.

### Success Criteria:

#### Automated Verification:

- None — hand-built console flow extension, no automated check (same acknowledgment every prior
  slice's flow-wiring phase carries)

#### Manual Verification:

- An authenticated transferred call shows the operation picker immediately after the existing
  identity/reason screen-pop
- Each of the three operation branches completes its full screen sequence and correctly invokes
  `agent-appointment` between screens
- An unauthenticated transferred call is unchanged — only S-11's existing placeholder screen shows,
  with no operation picker

---

## Phase 4: Contract Documentation + End-to-End Verification

### Overview

Register the new contract surfaces and run the full manual matrix across all three operations and
their edge cases on a real transferred call.

### Changes Required:

#### 1. Contract surfaces registration

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Document the new Lambda's `Details.Parameters` shape and output fields, and the two
Views' `$.Views.ViewResultData` shape, following the file's existing entry format (Set by / Read
by / Why it matters) exactly.

**Contract**: New `##` entries: one for `Details.Parameters.operation` / `.step` (agent-appointment
Lambda), one for `$.Views.ViewResultData.selection` / `.action` (the two agent-appointment Views),
and one for the `appt1`–`appt4` surfacing divergence noted in Critical Implementation Details.

### Success Criteria:

#### Automated Verification:

- None new — covered by Phase 1's tests, typecheck, and synth

#### Manual Verification:

- **Create**: pick specialty → time-of-day → day → time → confirm → success message; a
  no-availability day/time outcome is announced and re-offered from a fresh search; declining
  confirm returns to the day picker with specialty/time-of-day retained
- **Cancel**: pick an appointment → confirm read-back → cancelled message; the freed slot is
  verifiably rebookable afterward; a stale/not-found selection returns to a fresh appointment list
- **Reschedule**: pick an appointment → time-of-day → day → time → confirm → rescheduled message;
  the old slot is verifiably free and the new one verifiably booked afterward; a stale/not-found
  selection returns to a fresh appointment list
- **Zero appointments**: cancel/reschedule with no upcoming appointments shows a clear message and
  ends cleanly, no crash
- **Unauthenticated transfer**: placeholder-only screen, no operation picker — S-11's existing
  behavior, unchanged

---

## Testing Strategy

### Unit Tests:

- One test per `(operation, step, outcome)` combination in `lambdas/agent-appointment/index.test.ts`
  — success, not-found/stale, no-availability, and downstream-failure outcomes for each operation,
  mirroring the existing coverage shape in `appointment-cancel`/`appointment-reschedule`'s own test
  files.

### Integration Tests:

- None beyond the existing HIS/mock test suite — no HIS code changes in this plan.

### Manual Testing Steps:

1. Place a real call, transfer to the agent queue from an already-authenticated point in the call.
2. Confirm the picker appears after the existing screen-pop; run all three operations end-to-end
   per Phase 4's matrix.
3. Repeat the transfer from an unauthenticated point (e.g. three failed auth attempts) and confirm
   only the existing placeholder shows.

## Performance Considerations

None beyond the existing per-Lambda 2-second timeout already applied uniformly across every
appointment Lambda; this plan adds no new latency-sensitive path since it produces no measured
A-vs-B comparison data.

## Migration Notes

None — no schema, entity, or endpoint change. This plan is purely an additive interaction layer
over already-existing, already-tested shared functions.

## References

- Prerequisite plans: `context/pending-verification/appointment-booking-both-variants/plan.md`,
  `context/pending-verification/appointment-cancel/plan.md`,
  `context/pending-verification/appointment-reschedule/plan.md`,
  `context/pending-verification/agent-call-handover/plan.md`
- Shared logic: `lambdas/appointment/index.ts`
- Precedent Lambdas: `lambdas/booking/index.ts`, `lambdas/appointment-cancel/index.ts`,
  `lambdas/appointment-reschedule/index.ts`
- Precedent infra block: `infra/lib/infra-stack.ts:474-499`
- Precedent View/flow docs: `connect-flow-templates/views/agent-handover-view.md`,
  `connect-flow-templates/flows/agent-handover-whisper-flow.md`
- Contract surfaces: `docs/reference/contract-surfaces.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Agent Appointment Lambda + Infrastructure Wiring

#### Automated

- [x] 1.1 Unit tests pass: `npm test` in `lambdas/agent-appointment` — 593084e
- [x] 1.2 Type checking passes — 593084e
- [x] 1.3 CDK synth succeeds with the new function — 593084e

#### Manual

- [ ] 1.4 Deployed function invokable directly for each operation's first step, matching its
      mirrored precedent Lambda's output

### Phase 2: Reusable Agent-Side View Templates

#### Manual

- [ ] 2.1 Both views built in the console per their guides and previewable with sample content

### Phase 3: Guide Flow Wiring

#### Manual

- [ ] 3.1 Authenticated transferred call shows the operation picker after the existing screen-pop
- [ ] 3.2 Each of the three operation branches completes its full screen sequence, invoking
      `agent-appointment` correctly between screens
- [ ] 3.3 Unauthenticated transferred call unchanged — only S-11's existing placeholder shows

### Phase 4: Contract Documentation + End-to-End Verification

#### Manual

- [ ] 4.1 Create: full flow including no-availability and declined-confirm outcomes
- [ ] 4.2 Cancel: full flow including stale-selection outcome; freed slot verifiably rebookable
- [ ] 4.3 Reschedule: full flow including stale-selection outcome; old slot free, new slot booked
- [ ] 4.4 Zero-appointments case for cancel/reschedule ends cleanly
- [ ] 4.5 Unauthenticated transfer shows placeholder-only screen
