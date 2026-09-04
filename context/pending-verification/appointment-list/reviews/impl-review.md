<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Appointment List Implementation Plan

- **Plan**: context/pending-verification/appointment-list/plan.md
- **Scope**: Full plan (Phases 1-4)
- **Date**: 2026-09-05
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Pre-existing type-check failure in facility-info-speech test file

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: lambdas/facility-info-speech/index.test.ts (10 call sites, e.g. lines 148, 367, 532-533)
- **Detail**: `npx tsc --noEmit` in `lambdas/facility-info-speech` reports 10 `TS2339` errors: `result.messages[0].content` is accessed on the `LexResponse` union without narrowing, and `LexDelegateResponse` (one union member) has no `messages` field. Verified via a throwaway detached worktree at the pre-appointment-list commit (91870af) that this is **not a regression** — the identical error set (same count, same shape) already existed before this plan started. The plan's own Phase 3 success criterion ("Type checking passes across ... `lambdas/facility-info-speech`") is technically not met, but the new `ListAppointmentsIntent` tests didn't cause it — they only followed the file's pre-existing (broken) convention for asserting on `.messages[0].content`.
- **Fix**: Add a type guard/narrowing helper (e.g. `assertHasMessages(result)` or a discriminant check on `dialogAction.type`) at the top of the test file and use it in all ~10 call sites, or widen `LexDelegateResponse` to include an optional `messages` field. Out of scope for this plan — best tracked as its own small follow-up rather than folded into appointment-list.
- **Decision**: FIXED — added a `messageOf(result)` helper (a single narrowing cast) in `index.test.ts` and replaced all ~11 call sites with it. `tsc --noEmit` now passes cleanly and all 35 tests still pass.

### F2 — Patient-scoped read endpoint has no ownership check beyond caller-supplied `patientId`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: his/src/appointment/appointment.controller.ts:22-25, his/src/appointment/appointment.service.ts:44-58
- **Detail**: `GET /appointment/mine?patientId=<id>` trusts the caller-supplied `patientId` with no session/token check — any caller could read another patient's appointments by varying the query param. This exactly mirrors the existing `POST /appointment/book` endpoint's trust model: the mock HIS has no auth layer anywhere, and the real authorization boundary is "is the Connect caller `authenticated == 'true'`" enforced upstream in the Lambda/flow. Not a new pattern and not a regression introduced by this plan — the query itself is properly parameterized (`where('slot.patientId = :patientId', ...)`, no injection risk).
- **Fix**: None needed for this plan. If the mock's trust model is ever revisited, it should be addressed project-wide, not per-endpoint.
- **Decision**: SKIPPED

### F3 — Appointment-line formatting and overflow-cap logic independently duplicated per variant

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: lambdas/appointment-list/index.ts (formatAppointment), lambdas/facility-info-speech/index.ts:427 (inline `.map()`)
- **Detail**: Both variants independently build the string `"${specialty}, ${formatDayLabel(date)}, godzina ${time}"` and independently re-derive the "show 3, treat a 4th as overflow" rule from the same `LIMIT 4` array, rather than centralizing either in `@pcm/appointment`. This is a documented, precedented choice (contract-surfaces.md records it, and it mirrors how booking already renders shared date/time values with per-variant wording) rather than a leak of a domain decision into a flow — both variants still get their data exclusively through `listAppointments`. Minor drift risk only: if the cap-at-3 convention ever changes, both call sites need updating independently.
- **Fix**: None needed now. Worth centralizing only if a third variant or a change to the cap value arrives.
- **Decision**: SKIPPED

## Additional verification notes

- **Automated checks run and passing**: `lambdas/appointment` (11/11), `lambdas/appointment-list` (5/5, all planned branches: needs-auth, empty, under-cap, over-cap/overflow, downstream-error), `lambdas/booking` (11/11, unchanged after `formatDayLabel` import switch), `lambdas/facility-info-speech` (35/35, including all 5 new `ListAppointmentsIntent` branches), `infra/test/infra.test.ts` (23/23, including new `AppointmentList` and `ListAppointmentsIntent` assertions), `cdk synth` (succeeds). Type checking passes cleanly for `his`, `lambdas/appointment`, `lambdas/appointment-list`, `lambdas/booking`, `infra` — only `lambdas/facility-info-speech` fails, per F1 above (pre-existing).
- **`his/` unit tests: INCONCLUSIVE, not FAIL** — `appointment.service.spec.ts` requires a live Postgres via `docker-compose.yml`; Docker Desktop is not running in this environment, so all 10 tests (pre-existing + 2 new `findAppointmentsForPatient` cases) time out on `beforeAll`'s DB connection, including tests unrelated to this change. The plan-drift sub-agent confirmed the new test cases (booked slot, empty, cap-at-4, past-excluded) exist and match the plan's described contract by reading the file directly; execution could not be verified in this environment.
- **Manual verification items** (Phase 1.5, 2.4, 3.4, all of Phase 4): still `- [ ]` in the plan's Progress section, as expected — these require a real call against a deployed instance and are correctly deferred (this change already sits in `context/pending-verification/` for exactly that reason).
