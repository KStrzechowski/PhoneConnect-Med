<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Appointment Booking, Both Variants

- **Plan**: context/changes/appointment-booking-both-variants/plan.md
- **Scope**: Phase 1–2 of 6 (Scheduling data model; `@pcm/appointment` shared module — the only phases with fully-checked Automated Progress; Phase 2's checkbox is checked in the working tree but not yet committed)
- **Date**: 2026-09-03
- **Verdict**: APPROVED
- **Findings**: [0 critical] [1 warning] [2 observations]

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Seed migration mixes local and UTC calendar days

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: his/src/migrations/1788469015011-CreateAppointment.ts:49-59
- **Detail**: `forwardWeekdays` filters with `cursor.getDay()` (local calendar day) but stores the date via `cursor.toISOString().slice(0, 10)` (UTC calendar day). No `TZ` is pinned anywhere in the repo. When the migration runs close to local midnight on a host with a non-zero UTC offset, the weekday check can pass on the local day while the stored ISO date is actually the adjacent day — a seeded slot's `date` column can silently land on a Saturday/Sunday, or the 10-day forward window can be off by one relative to what "tomorrow" means when the migration actually runs.
- **Fix**: Build the stored `YYYY-MM-DD` string from the same local calendar fields `getDay()` already reads (e.g. local `getFullYear()`/`getMonth()`/`getDate()`), instead of `toISOString()`.
- **Decision**: FIXED — `toLocalDateString` added, migration reverted and re-applied against the local test DB, `his/` test suite re-run green.

### F2 — `slot.patientId` has no FK constraint, unlike `slot.doctorId`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: his/src/appointment/slot.entity.ts:9-14 vs. :28-29 (also his/src/migrations/1788469015011-CreateAppointment.ts:75-86)
- **Detail**: `doctorId` is a real `@ManyToOne` relation with a DB `FOREIGN KEY`. `patientId` is a bare nullable `int` column with no relation and no constraint, even though `Patient` exists in the same database. `AppointmentController.book()` writes whatever `patientId` the caller sends straight into this column. In practice `patientId` only ever arrives from the already-authenticated session (per `docs/reference/contract-surfaces.md`), so this isn't reachable with untrusted input today — but nothing in `his/` itself would catch a bad id if that ever changed. No other table in `his/` establishes a precedent either way for this column.
- **Fix**: Add a FK constraint on `slot.patientId → patient.id`, mirroring `doctorId`, or leave as is if the asymmetry is accepted as intentional for this mock.
- **Decision**: ACCEPTED — kept as-is. Not reachable with untrusted input (`patientId` only ever arrives from the already-authenticated session), and no other cross-domain FK exists between `his/`'s domains today; adding one here alone would be inconsistent precedent rather than a genuine safety net.

### F3 — `@pcm/appointment` empty-search test only covers `resolveDay`, not `resolveTime`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: lambdas/appointment/index.test.ts
- **Detail**: Phase 2's Automated Verification promises coverage for "an empty search (unseeded specialty and fully-booked doctor both)." The file has one empty-search test, on `resolveDay` only (labeled via a `reumatolog`-named call) — there's no equivalent empty-search test for `resolveTime`, and no test that distinguishes the unseeded-specialty scenario from the fully-booked-doctor scenario at this layer (both collapse to the same mocked empty array here; that distinction is genuinely exercised instead at Phase 1's `appointment.service.spec.ts` layer). Not a correctness gap — `resolveTime` and `resolveDay` share the same `?? null` fallback logic — but the promised coverage isn't literally present in this file.
- **Fix**: Add a `resolveTime` empty-search test mirroring the existing `resolveDay` one.
- **Decision**: FIXED — test added, `@pcm/appointment` suite re-run green (10/10).
