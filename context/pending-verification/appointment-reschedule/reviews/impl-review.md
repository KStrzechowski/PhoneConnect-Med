<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Appointment Reschedule Implementation Plan

- **Plan**: context/pending-verification/appointment-reschedule/plan.md
- **Scope**: Phase 1-4 of 4 (full plan review)
- **Date**: 2026-09-05
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — infra.test.ts has no dedicated naming-convention test for AppointmentReschedule

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: infra/test/infra.test.ts:99-125, 247-248
- **Detail**: Every other appointment-related Lambda (`Booking` line 99, `AppointmentList` line 108, and — newly added in this same diff — `AppointmentCancel` line 117) gets a dedicated `'<Name> is named per convention and reaches the mock over the VPC'` test. `AppointmentReschedule` only gets the shared count bump (8→9 functions/associations) and a `targets.some((t) => t.startsWith('AppointmentReschedule'))` check at line 248. The newest Lambda is the one left without the symmetric per-function test its siblings all have.
- **Fix**: Add a parallel `'AppointmentReschedule is named per convention and reaches the mock over the VPC'` test mirroring the `AppointmentCancel` block at line 117.
- **Decision**: FIXED — added at infra/test/infra.test.ts:126-133; `npx jest` in `infra/` now passes 25/25.

### F2 — `handleRescheduleDialog`'s day/time stages give up immediately on a stale appointment resolution, with no test pinning that behavior

- **Severity**: OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria / Safety & Quality
- **Location**: lambdas/facility-info-speech/index.ts:505, 549
- **Detail**: In the `'day'` stage (line 505) and the final `'time'`/fulfillment-adjacent stage (line 549), when `resolveAppointment(patientId, apptChoice, ...)` returns `null` (the `rescheduleApptSelection`-resolved appointment has gone stale — e.g. cancelled or altered mid-call), the code calls `giveUp()` unconditionally. This differs from the `'select'`/`'confirm'` stage (line 450) and from booking's own day/time stages (lines 162, 195, 221), which all retry up to their attempt limit before giving up. No test in the diff exercises this null-appointment branch at the `day`/`time` stages, so the asymmetry is unverified — it could be an intentional "this shouldn't happen once already resolved, escalate immediately" design choice, or an oversight from copy-adapting the booking stage shape where `resolveDay`/`resolveTime` returning `null` (not `resolveAppointment`) is the expected retry case.
- **Fix A ⭐ Recommended**: Leave the immediate-escalation behavior as is (a resolved appointment going stale mid-flow is a genuine anomaly, not caller input error, so failing safe to an agent is defensible) and add a unit test pinning it, so future changes don't silently alter this behavior.
  - Strength: No behavior change to a working system; makes the current (arguably correct) choice explicit and regression-proof.
  - Tradeoff: A caller who hits this rare race is transferred rather than retried, slightly less lenient than every other retry path in this same file.
  - Confidence: MED — the asymmetry is plausible by design (an appointment vanishing is a different failure class than a bad digit), but nothing in the plan documents it as deliberate.
  - Blind spot: Haven't confirmed with the author whether this was a conscious decision or an artifact of adapting `handleBookingDialog`'s shape.
- **Fix B**: Make it consistent with the `'select'`/`'confirm'` stage by adding the same `attempts + 1 >= RESCHEDULE_ATTEMPT_LIMIT` bounded retry before giving up.
  - Strength: Full symmetry with every other retry path in this handler and with booking's precedent; a rare race gets one more chance instead of an immediate transfer.
  - Tradeoff: Slightly more code for an edge case that's already accepted as rare; the plan doesn't ask for this.
  - Confidence: LOW — this is genuinely more lenient than the plan specifies anywhere, and expands behavior beyond what was asked.
  - Blind spot: Unclear whether a stale appointment mid-day/time-stage can even recur across a retry (the appointment already vanished; retrying elicits a new day/time choice, not a new appointment choice), so the retry may not meaningfully help the caller.
- **Decision**: FIXED via Fix A — added two tests pinning the immediate-giveup behavior at `lambdas/facility-info-speech/index.test.ts` ("...transfers immediately when the appointment resolution goes stale at the day stage" / "...at the time stage"); `npm test` in `lambdas/facility-info-speech` now passes 66/66 (was 64).

## Automated Verification (re-run, not just trusted from checked boxes)

| Check | Result |
|---|---|
| `cd lambdas/appointment && npm test` | PASS (18/18) |
| `cd lambdas/appointment-reschedule && npm test` | PASS (24/24) |
| `cd lambdas/facility-info-speech && npm test` | PASS (66/66, after F2 fix) |
| `npm test --workspaces` | PASS (all lambda packages) |
| `cd infra && npx cdk synth` | PASS |
| `cd infra && npx jest` | PASS (25/25, after F1 fix) |
| `tsc --noEmit` (appointment, appointment-reschedule, facility-info-speech, infra) | PASS, clean |
| `his/` Jest suite (`npm run test`) | Fails locally — Postgres/Docker not running in this environment; `his/` is untouched by this plan's diff, so this is environmental, not a regression |
| Lint | No lint script exists for the touched lambda/infra packages (only `his/`, which is untouched); no new lint issues introduced |

Manual Progress rows (4.4-4.12) correctly remain unchecked — no rubber-stamping found, consistent with `pending-verification` status.
