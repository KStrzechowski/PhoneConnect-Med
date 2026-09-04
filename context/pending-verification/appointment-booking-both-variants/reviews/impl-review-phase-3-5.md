<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Appointment Booking, Both Variants

- **Plan**: context/pending-verification/appointment-booking-both-variants/plan.md
- **Scope**: Phase 3–5 of 6 (Keypad Lambda; Speech fulfillment; Infrastructure — all Automated Progress fully checked), plus the already-committed Phase 6 console/doc artifacts (flow JSON, contract-surfaces.md) reviewed for structural consistency with the plan even though Phase 6's Manual Verification is still entirely pending. Phase 1–2 already reviewed and triaged in `reviews/impl-review.md` (all 3 findings resolved: F1 fixed, F2 accepted, F3 fixed) — re-verified those fixes are still present, not re-reviewed from scratch.
- **Date**: 2026-09-04
- **Verdict**: NEEDS ATTENTION
- **Findings**: [0 critical] [1 warning] [3 observations]

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Speech fulfillment books an appointment without re-checking authentication

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: lambdas/facility-info-speech/index.ts:232-257 (`handleBookingFulfillment`)
- **Detail**: `handleBookingDialog` checks `incoming.authenticated !== 'true'` first thing on every dialog-hook turn (line 124), and the keypad variant's `lambdas/booking/index.ts` checks `needsAuth` before every one of its four steps, including `book` — an explicit, repeated pattern in this codebase of gating the write at every step, not just the first one. `handleBookingFulfillment`, which is the function that actually calls `bookAppointment` (line 244-246) and writes the real slot row, has no such check. In the intended Lex flow this isn't reachable today: `dialogCodeHook.enabled: true` means Lex always runs the dialog hook first on every turn, and fulfillment only fires after all slots are filled and confirmed, which requires having passed the dialog hook's auth check on a prior turn in the same session. But that makes the fulfillment path's safety depend entirely on Lex's calling order and unbroken session-attribute continuity, rather than the endpoint defending itself — the exact asymmetry this codebase's own keypad handler was written to avoid.
- **Fix**: Add the same guard at the top of `handleBookingFulfillment`: `if (incoming.authenticated !== 'true') return close(...)` with the same `needsAuth: 'true'` shape `handleBookingDialog` already returns, mirroring lines 124-127.
- **Decision**: FIXED — guard added, mirrored test `BookingIntent fulfillment needs auth before booking` added, `lambdas/facility-info-speech` suite re-run green (29/29).

### F2 — Speech read-back text bypasses Lex's own `intentConfirmationSetting` templating, undocumented

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: infra/lib/infra-stack.ts:669 vs. lambdas/facility-info-speech/index.ts:217
- **Detail**: The plan's Phase 4 Contract said the read-back confirmation would be "a templated message... filled from session attributes the dialog code hook set, the same templating `AuthIntent`'s `Podano numer PESEL {pesel}...` already uses" — implying it lives on the Lex-level `intentConfirmationSetting` prompt, the way `AuthIntent`'s does. In practice, `infra-stack.ts`'s `intentConfirmationSetting` prompt is a static string (`'Czy się zgadza? Powiedz tak albo nie.'`); the actual dynamic text (`Umawiam Panią/Pana do {specialty}...`) is produced by the Lambda's `confirmIntent` response `messages` field instead, which Lex uses to override the prompt for that turn. This is a reasonable adaptation — `date`/`time` aren't Lex slot values, so they can't be referenced in a Lex-native `{slot}` template the way `{pesel}`/`{phone}` can — but it's a different mechanism than the plan and `contract-surfaces.md` describe, and neither documents the deviation.
- **Fix**: Add a one-line note to `docs/reference/contract-surfaces.md`'s booking section clarifying that the confirmation read-back text comes from the Lambda's `messages` override, not from a templated `intentConfirmationSetting` prompt.
- **Decision**: FIXED — new "Speech confirmation read-back text" section added to contract-surfaces.md.

### F3 — Missing/empty `patientId` silently coerces to `0` instead of erroring

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: lambdas/booking/index.ts:78, lambdas/facility-info-speech/index.ts:241
- **Detail**: Both variants do `Number(patientId)` / `Number(incoming.patientId ?? '')` right before calling `bookAppointment`. `Number('')` and `Number(undefined)` both produce `0`/`NaN` rather than a caught error, so a session that reaches the `book` step with `authenticated: 'true'` but no `patientId` set would attempt to book against patient `0` instead of failing loudly. Low likelihood today — `authenticate`/`AuthIntent`/`OtpIntent` always set `authenticated` and `patientId` together — but nothing enforces that invariant at the booking boundary itself, and the same gap exists identically in both variants.
- **Fix**: Guard on a missing/non-numeric `patientId` (`if (!patientId) throw`/return an error response) before calling `bookAppointment`, in both `lambdas/booking/index.ts` and `handleBookingFulfillment`.
- **Decision**: FIXED — guard added in both variants, mirrored tests added, both suites re-run green (`lambdas/booking` 11/11, `lambdas/facility-info-speech` 30/30).

### F4 — `@pcm/appointment` doesn't check `response.ok` before parsing JSON

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: lambdas/appointment/index.ts (`findAvailableDays`, `findAvailableTimes`, `bookAppointment`)
- **Detail**: None of the three functions check `response.ok` before calling `.json()`. A non-2xx response with an unparseable body throws inside the existing try/catch and correctly surfaces as `reachable:'false'` — that path is fine — but a non-2xx response that happens to return valid JSON (e.g. `{}` from a proxy or misconfigured route) would silently parse into an empty array or `booked:false`, indistinguishable from a legitimate empty search or a legitimate failed booking, rather than surfacing as a distinguishable downstream error.
- **Fix**: Check `response.ok` and throw before `.json()` in each of the three functions, matching the pattern any future HTTP client call in this codebase should use.
- **Decision**: FIXED — `response.ok` guard added to `findAvailableDays`, `findAvailableTimes`, `bookAppointment`; left `listAppointments` untouched (out of scope — added concurrently by the separate `appointment-list` change). `@pcm/appointment` (10/10), `lambdas/booking` (11/11), `lambdas/facility-info-speech` (30/30) all re-run green.
