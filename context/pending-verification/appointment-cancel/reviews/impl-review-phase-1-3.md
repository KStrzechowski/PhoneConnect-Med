<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Appointment Cancel

- **Plan**: context/pending-verification/appointment-cancel/plan.md
- **Scope**: Phase 1–3 of 4 (Shared business logic; Keypad Lambda; Speech intent — all Automated Progress fully checked). Phase 4 (Contact flow & hand-off) is excluded: its Automated Progress is checked but Manual Verification (4.4–4.10) is still entirely pending.
- **Date**: 2026-09-05
- **Verdict**: APPROVED
- **Findings**: [0 critical] [0 warnings] [5 observations]

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — `cancel()` inherits `book()`'s unenforced same-patient-same-slot uniqueness assumption

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: his/src/appointment/appointment.service.ts:94-109 (`cancel`)
- **Detail**: The plan states `cancel`'s contract omits a `specialty` parameter because "`patientId` + `date` + `time` is already the granularity `findAppointmentsForPatient` exposes... and a patient cannot hold two appointments at the same date and time." Nothing enforces that assumption: `book()` has no check preventing a patient from booking two different specialists' slots at the identical date+time via two separate calls. If that ever happened, `cancel`'s `findOne({ where: { date, time, patientId, taken: true } })` would non-deterministically match one of the two rows. No cross-patient risk — `patientId` is still part of the filter — and this ambiguity is inherited from `book()`'s pre-existing design, not introduced by this plan.
- **Fix**: No action required for this change. Worth a note if a future slice ever allows overlapping bookings; until then the assumption holds in practice.
- **Decision**: ACCEPTED — known limitation inherited from `book()`, not introduced by this plan; revisit only if overlapping bookings become possible.

### F2 — `handleCancelFulfillment` skips the `patientId` guard `handleBookingFulfillment` has

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: lambdas/facility-info-speech/index.ts:346 (`handleCancelFulfillment`) vs. :237 (`handleBookingFulfillment`)
- **Detail**: `handleBookingFulfillment` has an explicit `if (!incoming.patientId)` guard with a dedicated error message and `record.error = 'missing patientId'` before calling the shared layer. `handleCancelFulfillment` has no analogous guard — a missing `patientId` would silently become `NaN` and flow into `resolveAppointment`. Not exploitable today (the session attribute is server-set post-auth, same trust boundary as booking), but it's an asymmetry between two functions the plan explicitly designed as mirrors of each other.
- **Fix**: Add the same `if (!incoming.patientId)` guard at the top of `handleCancelFulfillment`, mirroring lines 237-243.
- **Decision**: FIXED — guard added, mirrored test `CancelIntent fulfillment reports a clean failure when patientId is missing` added, `lambdas/facility-info-speech` suite re-run green (46/46).

### F3 — `AppointmentCancel` has no dedicated infra test, unlike its siblings

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: infra/test/infra.test.ts:99, 108
- **Detail**: `Booking` (line 99) and `AppointmentList` (line 108) each get a dedicated test — `"<Name> is named per convention and reaches the mock over the VPC"` — asserting `FunctionName` and `VpcConfig`. `AppointmentCancel` has no equivalent; it's only indirectly covered by the aggregate 8-function count (line 230) and the `CfnIntegrationAssociation` construct-id-prefix check (line 238). The underlying code (`infra-stack.ts`'s `appointmentCancel` `NodejsFunction` block) is correct — this is a test-pattern gap, not a code defect.
- **Fix**: Add `test('AppointmentCancel is named per convention and reaches the mock over the VPC', ...)` mirroring the existing Booking/AppointmentList tests.
- **Decision**: FIXED — test added, `infra` suite re-run green (24/24).

### F4 — No mock-unreachable test for `CancelIntent`'s dialog/fulfillment stages

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: lambdas/facility-info-speech/index.test.ts
- **Detail**: `ListAppointmentsIntent` has a test asserting it transfers to an agent when the mock is unreachable. No equivalent exists for `CancelIntent`'s list stage, resolve stage, or fulfillment, even though the plan's Testing Strategy lists this as a required case ("Speech handler: ... fulfillment (cancel success/failure), auth gate, attempt-limit give-up" implies full-path coverage) and the catch blocks themselves (index.ts:314-319, 338-343, 375-380) are correctly implemented. This mirrors a pre-existing, identical gap for `BookingIntent` in the same file — not a regression specific to this feature.
- **Fix**: Add a mock-unreachable test for at least one `CancelIntent` stage, mirroring `ListAppointmentsIntent`'s pattern (index.test.ts:684).
- **Decision**: SKIPPED — mirrors a pre-existing `BookingIntent` gap in the same file, not a regression introduced by this feature.

### F5 — `infra.test.ts`'s function-count assertion lagged its own infra-stack change by one commit

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: infra/test/infra.test.ts:84
- **Detail**: Commit `73d89b5` (Phase 2) registered the `AppointmentCancel` function, permission, and integration association, bringing the keypad-invoked-function count to 8 — but `infra.test.ts` still asserted 7 at that commit; the bump to 8 didn't land until `983bce1` (Phase 3, an unrelated commit). Phase 2's stated success criteria only required `cdk synth` + typecheck/lint, not the full infra test suite, so no promise was broken, but `infra`'s own suite would have failed if run in isolation at `73d89b5`.
- **Fix**: No action needed now — already self-corrected. Process note for future slices: land the infra-test count bump in the same commit as the infra-stack change it verifies.
- **Decision**: SKIPPED — already self-corrected in the next commit; not worth tracking further.

## Automated Verification (re-run)

| Check | Command | Result |
|---|---|---|
| HIS unit tests | `cd his && npm test` | PASS (20/20) |
| `@pcm/appointment` unit tests | `cd lambdas/appointment && npm test` | PASS (15/15) |
| Keypad Lambda unit tests | `cd lambdas/appointment-cancel && npm test` | PASS (13/13) |
| Speech Lambda unit tests | `cd lambdas/facility-info-speech && npm test` | PASS (46/46 after F2 fix, incl. all `CancelIntent` cases) |
| `cdk synth` | `cd infra && npx cdk synth` | PASS |
| Infra tests | `cd infra && npm test` | PASS (24/24 after F3 fix) |
| Type checking | `npx tsc --noEmit` in `lambdas/appointment`, `lambdas/appointment-cancel`, `lambdas/facility-info-speech`, `infra` | PASS (all clean) |
| Linting | `npx eslint` on touched `his/src/appointment/*.ts` files | PASS (clean) |

Note: `his`'s repo-wide `npm run lint` reports pre-existing CRLF/prettier errors in `his/src/appointment/slot.entity.ts` (last touched 2026-09-03, before this feature). Not part of this change's diff — excluded from this review's findings.

## Plan Drift

No drift. Every planned change in Phases 1–3 (HIS service/controller/tests, `@pcm/appointment` wrappers, the keypad Lambda, the Lex intent, and the speech dialog/fulfillment handlers) matches its stated Intent/Contract exactly, including the deliberate deviations the plan itself calls out (reusing `selectedSlot`/`AMAZON.Number` instead of a raw `appointmentId` slot; never persisting resolved date/time across turns). No unplanned files or scope creep — `package-lock.json`'s update is mechanical (new package's dependencies), and `infra.test.ts`'s count-assertion bump is incidental test upkeep, not undocumented feature work.

## Architecture (L-03)

Verified directly: neither `lambdas/appointment-cancel/index.ts` nor `handleCancelDialog`/`handleCancelFulfillment` re-implement resolution logic. Both variants call only `resolveAppointment`/`cancelAppointment` in `@pcm/appointment` for every decision; local code is limited to display formatting. The auth gate (`needsAuth: 'true'`) is present on all three keypad steps and both dialog/fulfillment entry points. The data-mutating query (`appointment.service.ts:99-101`, `findOne({ where: { date, time, patientId, taken: true } })`) can only ever match a slot belonging to the requesting `patientId` — no cross-patient cancellation is possible.
