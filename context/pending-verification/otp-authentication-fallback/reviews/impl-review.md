<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OTP Authentication Fallback Implementation Plan

- **Plan**: context/pending-verification/otp-authentication-fallback/plan.md
- **Scope**: Full plan (Phases 1-6)
- **Date**: 2026-09-03
- **Verdict**: REJECTED
- **Findings**: 2 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | FAIL |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — No real OTP code is ever sent on the primary path, in either variant

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Plan Adherence
- **Location**: `connect-flow-templates/modules/keypad-otp-verify-module.json` (no `SendOtp` invocation outside `invokeResend`); `lambdas/facility-info-speech/index.ts:81-95` (`AuthIntent`'s non-shortcut branch)
- **Detail**: `lambdas/send-otp` is only ever invoked from the resend branch — `grep` for `SendOtp`/`sns.send`/`PublishCommand` across the keypad flow templates finds exactly one hit, inside `invokeResend`, reachable only when the caller presses `9`. `AuthIntent` in `facility-info-speech/index.ts` sets `otpRequired`/`code`/`phone` session attributes and speaks "Kod weryfikacyjny został wysłany na podany numer telefonu" (a code has been sent) but never calls SNS itself — only `OtpIntent`'s resend branch does. So for a real, non-demo patient calling from an unrecognized number, the standard "press 1 to enter the code" path never actually dispatches an SMS; the caller is told a code was sent and asked to enter it, but no code exists until they separately press 9. This contradicts the plan's own stated intent: Implementation Approach says `send-otp` "(initial send and resend — same operation...)" and Phase 3's contract says it "Handles both the initial send and any resend with the same logic" — but nothing in Phase 6's Contact Flow Module contract, nor the flow I generated from it, ever wires that initial call. `send-otp/index.test.ts`'s "real, initial send" test (isResend absent) exercises a call shape that, per the actual wiring, is never reached in production.
- **Fix A ⭐ Recommended**: Wire the initial send into the existing turn, at the point where it's already being spoken as having happened.
  - Keypad: add an `InvokeExternalResource` step to `SendOtp` (no `isResend` / `isResend: 'false'`) immediately after `storeOtpChallenge` in `keypad-authenticate-flow.json`, before `setNeutralMsg`, updating the `code` contact attribute from its response — mirrors the resend wiring already built in `keypad-otp-verify-module.json`, just triggered unconditionally and earlier.
  - Speech: add the same in-process `sns.send(new PublishCommand(...))` call already written in `OtpIntent`'s resend branch to `AuthIntent`'s non-shortcut branch in `lambdas/facility-info-speech/index.ts`, guarded by `!isDemo` exactly as the resend branch already is.
  - Strength: Minimal, reuses code paths that already exist and are already tested for demo/non-demo/failure cases; matches the plan's literal stated intent.
  - Tradeoff: The keypad half only touches the personal, gitignored flow templates (no commit needed); the speech half touches committed Lambda code and needs a new test case, and depends on F2 being fixed first to actually work once deployed.
  - Confidence: HIGH — the resend code path already proves the mechanics work end to end; this only changes when it fires.
  - Blind spot: None significant.
- **Fix B**: Move send responsibility into `beginOtpChallenge`/`lambdas/authenticate` itself, so a code is dispatched automatically the moment a challenge begins, independent of flow/Lex wiring remembering to call it.
  - Strength: Removes the "flow author must remember to wire this" failure class structurally, rather than relying on console configuration.
  - Tradeoff: Directly contradicts the plan's deliberate split ("two new non-VPC Lambdas do the mechanical work... Neither new Lambda ever touches `his/`; the only Lambda that already does... is where the OTP challenge is decided") and would require reconsidering `lambdas/authenticate`'s VPC attachment and IAM surface.
  - Confidence: MEDIUM — works, but re-litigates an explicit plan decision rather than fixing a wiring gap.
  - Blind spot: Haven't confirmed `lambdas/authenticate`'s current VPC placement is compatible with an SNS call without further network changes.
- **Decision**: PENDING

### F2 — `facilityInfoSpeech`'s Lambda role has no `sns:Publish` grant

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `infra/lib/infra-stack.ts:362-376` (the `FacilityInfoSpeech` `NodejsFunction` definition)
- **Detail**: `lambdas/facility-info-speech/index.ts:118-126` calls `sns.send(new PublishCommand(...))` directly using the Lambda's own execution role in `OtpIntent`'s resend branch. `sendOtp`'s role gets an explicit grant (`infra-stack.ts:325-327`: `sendOtp.role?.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['sns:Publish'], resources: ['*'] }))`), but no equivalent exists for `facilityInfoSpeech`'s role anywhere in the stack. Every speech-variant OTP resend will throw `AccessDeniedException` in a real deployment — invisible to the caller and to casual testing because the surrounding `try/catch` swallows it (by design, per the plan's silent-SMS-failure decision), and `infra/test/infra.test.ts` has no assertion covering this permission.
- **Fix**: Add `facilityInfoSpeech.role?.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['sns:Publish'], resources: ['*'] }))` in `infra-stack.ts`, mirroring `sendOtp`'s grant exactly, and add a `Template.fromStack` assertion for it in `infra.test.ts` alongside the existing IAM-policy checks.
- **Decision**: PENDING

### F3 — Migration comment added without asking first (L-01)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `his/src/migrations/1788461728029-AddOtpFallbackToPatient.ts:12-13`
- **Detail**: L-01 requires asking first and stating what a comment would say before adding one, even a justified one. The added comment documents the seeded demo pesel/phone/OTP triple — content the plan's Phase 1 contract explicitly calls for ("documented in the migration file and handed to testers separately"), but the precedent migration (`1788225506354-CreatePatient.ts`) seeds its own row with zero comment, and the comment was added unilaterally during implementation rather than proposed first.
- **Fix**: Confirm with the author whether to keep the comment as-is, reword it, or remove it and rely on the values alone (as the precedent migration does).
- **Decision**: PENDING

### F4 — `send-otp` attempts an SNS publish with an empty `PhoneNumber` on the no-match sham path

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `lambdas/send-otp/index.ts:14-22`
- **Detail**: When a no-match caller presses resend, `send-otp` is invoked with `phone: ''` and still attempts `sns.send(new PublishCommand({ PhoneNumber: '', ... }))` rather than short-circuiting. The surrounding `try/catch` absorbs the resulting error, matching the documented silent-failure design, but an immediately-rejected invalid-parameter publish could have a different latency profile than a real publish — a smaller instance of the same class of concern as F1/F2's neutrality guarantee. Untested: no case in `send-otp/index.test.ts` or `facility-info-speech/index.test.ts` covers `phone: '', isDemo: 'false'`.
- **Fix**: Add a test case for the empty-phone resend, and consider short-circuiting the SNS call when `phone` is empty for both cost and timing-symmetry reasons.
- **Decision**: PENDING

### F5 — `patientId` key presence differs between `beginOtpChallenge` branches

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `lambdas/patient/index.ts:56`
- **Detail**: The no-match return omits the `patientId` key entirely, while the matched-wrong-number branch always includes it. Callers normalize this away (`result.patientId !== undefined ? String(result.patientId) : ''`), so there's no observable leak — purely an internal shape inconsistency.
- **Fix**: No action needed; noted for awareness only.
- **Decision**: PENDING

## Notes

- **Success Criteria re-verified fresh** (not just trusted from the plan's checked boxes): `npm run test` in `his/`, `npm test --workspaces` across all lambda packages, `cdk synth`, and `infra`'s Jest suite all pass — 0 failures across the board.
- **Manual Progress rows correctly left unchecked** — no rubber-stamping found; all Manual items (1.3, 3.4, 3.5, 5.3, 6.1-6.7) remain `- [ ]`, consistent with the project's pending-verification convention.
- **Scope Discipline confirmed clean**: grepped for persistence/rate-limiting/SMS-failure-branch signals across the new Lambdas — no hits. The "What We're NOT Doing" list (no persistent OTP store, no distinct SMS-failure branch, no rate-limiting, no change to the S-03 shortcut's behavior, no booking/agent features, no admin surface) is fully respected.
- **Neutrality guarantee (matched-wrong-number vs. no-match) verified as correctly timing-symmetric** in `beginOtpChallenge` — both branches perform exactly one `await verifyPatient(...)` and differ only by a synchronous `generateOtpCode()` call.
- The `context/foundation/roadmap.md` Phase 6 item asks for `Status: planning` on S-04, but the actual (still-uncommitted) edit sets `Status: in-progress`. This was a deliberate, disclosed deviation this session (avoiding regressing a status `/10x-implement`'s own entry step had already advanced) — not re-flagged as a finding, and the same discrepancy pre-exists in the S-03 precedent plan, suggesting the plan's boilerplate wording (not this slice) is what's stale.
