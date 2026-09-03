# OTP Authentication Fallback Implementation Plan

## Overview

Roadmap **S-04**: a caller dialling from any number reaches the authenticated layer by supplying a
PESEL and phone number that match, then a texted one-time code. S-03 already built the caller-ID
shortcut and, deliberately, left every non-shortcut outcome as a neutral "code sent, transferring"
dead end — this slice replaces that dead end with a real (or, for seeded demo patients, simulated)
code-entry stage, in both variants, without touching the shortcut path itself.

## Current State Analysis

`@pcm/patient`'s `authenticate()` (`lambdas/patient/index.ts`) collapses "no match" and "matched
but wrong number" into an identical `{ authenticated: false }` — a deliberate neutrality guardrail
that must survive unchanged. `InvocationRecord` (`lambdas/measure/index.ts:16`) already types
`authPath?: 'caller-id' | 'otp' | 'demo'`; only `'caller-id'` is used today. Neither variant has any
code-entry step, any SMS-sending capability, or any IAM permission for it. No `Patient` field
distinguishes a demo account. The keypad variant's PESEL/phone capture is native Connect DTMF
collection with no Lex involvement (`lambdas/authenticate`); the speech variant's is a Lex
`AuthIntent` fulfilled by `lambdas/facility-info-speech`'s `dispatch()`. All existing Lambdas that
reach `his/` are VPC-attached (`natGateways: 0`, public-subnet-only); nothing in this slice's new
code needs to reach `his/`, so none of it needs the VPC.

## Desired End State

A caller whose PESEL+phone pair matches a real patient record, but who is calling from a different
number, hears the same neutral line S-03 already speaks, then is asked to enter a code — a real
6-digit code has been texted to the number on file (or, for a seeded demo patient, a fixed code
known in advance, with nothing actually sent). Entering the correct code authenticates them
identically to the shortcut path. Entering a wrong code allows up to three attempts before
transferring; at any point before those three attempts run out, the caller can ask for the code to
be sent again without that request counting against the limit. A caller whose pair matches nothing
at all goes through the exact same prompt sequence — asked for a code that was never actually
sent — so nothing about the flow reveals whether their identity data was real. A genuine SMS
delivery failure looks, to the caller, like an ordinary wrong code: no separate message, no
separate branch. Both variants behave identically in every one of these cases.

### Key Discoveries:

- `lambdas/patient/index.ts:1-26` — `authenticate()`'s neutrality (matched-wrong-number and
  no-match both collapse to `{ authenticated: false }`) is exactly the fork point this slice
  extends: this Lambda's non-shortcut branch is where an OTP challenge gets started instead of an
  immediate transfer.
- `lambdas/measure/index.ts:16` and its test at `index.test.ts:81-92` — `authPath: 'otp' | 'demo'`
  is already a typed, tested contract; no measurement-substrate change is needed, only handlers
  that start setting it.
- `context/foundation/roadmap.md:294-298` — the network-position note (sending must not be
  VPC-attached) generalizes further than the roadmap states: verification doesn't need the VPC
  either, since it only ever compares against session state already captured in this same call,
  never against `his/`. Both new Lambdas in this slice can be non-VPC.
- SMS via SNS publishes directly to a phone number (no Topic resource); the only new IAM surface
  is an `sns:Publish` grant, necessarily scoped to `Resource: "*"` (SNS gives no ARN to scope a
  direct-to-number publish to).
- `context/foundation/roadmap.md:279-293` — the demo-affordance design is fully specified
  upstream: a flag + fixed code on the seeded patient record, checked only in `@pcm/patient`
  (never in a contact flow or a variant Lambda), with `authPath` distinguishing `caller-id` / `otp`
  / `demo` so demo sessions can be excluded from absolute figures later.
- `his/src/migrations/1788225506354-CreatePatient.ts` and `1756500000000-CreateFacility.ts` are
  both raw-SQL `CREATE TABLE` + `INSERT` migrations with no ORM sync — the precedent this slice's
  migration follows for adding columns and seeding a second patient row.

## What We're NOT Doing

- Any persistent or cross-call store for OTP state — the current expected code, whether it's a
  demo, and the phone to send to live only in this call's session/contact attributes, per the
  PRD's per-call-only session model. A caller who hangs up and calls back starts over.
- A distinct "we couldn't send your code" branch for a genuine SMS-infrastructure failure — decided
  this session: it stays indistinguishable from an ordinary wrong-code entry, so no new outcome
  category or IVR branch exists for it.
- Rate-limiting or throttling resend requests beyond the natural cap of the call itself — no
  cross-call abuse protection; out of scope for a PoC measured on a handful of test calls.
- Any change to the caller-ID shortcut path (S-03) — this slice only extends what happens after it
  doesn't fire.
- Booking, listing, cancelling, or rescheduling (S-05–S-08); agent-facing views (S-11/S-12);
  English locale (S-10).
- An admin surface for managing demo accounts — the flag and fixed code are seeded via migration
  only, the same way the one existing patient row is seeded.

## Implementation Approach

`@pcm/patient` gains the one new decision every variant must share: given a confirmed PESEL+phone
pair that didn't earn the caller-ID shortcut, what code (if any) is now expected, and where (if
anywhere) does it need to be sent. Two new non-VPC Lambdas do the mechanical work either variant's
contact flow invokes directly: `lambdas/send-otp` (initial send and resend — same operation, since
resending is just "produce and dispatch a fresh code") and `lambdas/otp-verify` (keypad-only
stage-2 comparison). The speech variant doesn't need an equivalent to `otp-verify` as a separate
Lambda — `lambdas/facility-info-speech` already dispatches multiple intents from one file, so it
gains the same comparison inline, importing the same `@pcm/patient` functions `otp-verify` uses.
Neither new Lambda ever touches `his/`; the only Lambda that already does (`lambdas/authenticate`,
and `facility-info-speech`'s existing `AuthIntent` branch) is where the OTP challenge is decided,
using data it already fetched for the shortcut check.

## Critical Implementation Details

- **No persistent store.** The expected code, whether the patient is a demo account, and the phone
  number to send to are carried only as session attributes (Lex) or contact attributes (keypad)
  for the life of the call. Nothing is written to a database or cache. This is why neither new
  Lambda needs the VPC: comparison is against data already in this call's state, not against
  `his/`.
- **The sham path is not a shortcut around the prompt sequence.** A pair that matches no record at
  all still gets `otpRequired: true` from `beginOtpChallenge` with `code: null` — the caller is
  still asked to enter a code, on the same prompts, with the same retry and resend behavior. A
  `null` expected code can never match anything the caller enters, so this path always ends in a
  transfer after the attempt limit, exactly like a real wrong code — the caller never learns which
  case they were in.
- **SMS-send failure is deliberately silent (decided this session).** If `sns:Publish` throws, the
  handler swallows it the same way `lambdas/facility-info-speech`'s existing catch blocks handle a
  downstream failure: log it via `measured()`'s record, but speak the same neutral "code sent"
  line regardless. The caller experiences this identically to having received a code and mistyped
  it.
- **Resend must not consume a wrong-attempt.** The three-attempt cap belongs to the *comparison*
  step (`otp-verify` returning a mismatch), counted by the contact flow / Lex the same way S-03
  counts capture retries. A resend request is a different branch entirely — it calls
  `lambdas/send-otp` again and loops back to the same input prompt without touching that counter.
  Reserve a single DTMF digit (`9`) for "send it again," offered as its own menu choice before code
  entry in both variants (DTMF-only, consistent with F-05's resolution that this capture never
  takes spoken input) — see Phase 6 for the concrete prompt shape.
- **Demo-code check lives in `@pcm/patient` only.** Neither `lambdas/otp-verify`,
  `lambdas/send-otp`, nor `lambdas/facility-info-speech` ever branches on `isDemo` directly for the
  *decision* of whether a code is real — they call `@pcm/patient` and render its answer, per L-03
  and the roadmap's explicit constraint.
- **Code format.** A 6-digit numeric code (zero-padded), matching common OTP convention and the
  existing DTMF-only slot pattern (`KeyedPesel`/`KeyedPhone`). Decided directly — no real tradeoff
  worth a question.

## Phase 1: Patient persistence — demo flag and fixed code

### Overview

Give `his/` the two new fields the OTP challenge needs, and seed a second patient row for the demo
affordance.

### Changes Required:

#### 1. `Patient` entity and migration

**Files**: `his/src/patient/patient.entity.ts` (edit), `his/src/migrations/<timestamp>-AddOtpFallbackToPatient.ts`

**Intent**: Add the two columns the demo affordance needs, and seed a demo patient distinct from
the existing one so testers don't need a texted code to exercise the authenticated path.

**Contract**: `Patient` gains `isDemo: boolean` (default `false`) and `demoOtpCode: string | null`.
Migration mirrors `CreatePatient`'s raw-SQL shape: `ALTER TABLE "patient" ADD COLUMN "isDemo"
boolean NOT NULL DEFAULT false, ADD COLUMN "demoOtpCode" character varying`, followed by one
`INSERT` seeding a second patient with a distinct PESEL/phone, `isDemo = true`, and a fixed
`demoOtpCode` (documented in the migration file and handed to testers separately — never
hardcoded anywhere outside this seeded row).

#### 2. `PatientController` response

**File**: `his/src/patient/patient.controller.ts` (edit)

**Intent**: Surface the two new fields to `@pcm/patient` on a match, without adding anything to the
non-match response.

**Contract**: `POST /patient/verify`'s `matched: true` response gains `isDemo` and `demoOtpCode`
(the latter `null` unless `isDemo`). The `matched: false` response is unchanged.

### Success Criteria:

#### Automated Verification:

- `npm run test` inside `his/` passes, including updated patient spec coverage for the demo row
- `npm run migration:run` inside `his/` applies cleanly against a fresh database

#### Manual Verification:

- `POST /patient/verify` against the running mock returns `isDemo: true` and the seeded
  `demoOtpCode` for the demo pair, and `isDemo: false, demoOtpCode: null` for the existing pair

---

## Phase 2: Shared `@pcm/patient` OTP challenge module

### Overview

Own the one decision that must never diverge between variants: given a confirmed pair that didn't
earn the shortcut, what code (if any) is now expected and where does it go.

### Changes Required:

#### 1. `beginOtpChallenge` and `verifyOtpCode`

**Files**: `lambdas/patient/index.ts` (edit), `index.test.ts` (edit)

**Intent**: Extend the existing verification flow with the OTP-challenge decision, and a trivial,
shared comparison function so no variant Lambda implements its own equality check.

**Contract**: `beginOtpChallenge(pesel, phone, callerNumber, signal)` calls the existing
`verifyPatient`, and returns a discriminated result: the existing shortcut shape when
`callerNumber === phone`; otherwise `{ otpRequired: true, isDemo, code, phone, patientId }` where,
for a match with `isDemo: true`, `code` is the seeded `demoOtpCode` and `phone` is `null` (nothing
is ever sent for a demo account); for a match with `isDemo: false`, `code` is a freshly generated
6-digit numeric string and `phone` is the matched record's phone; for no match at all, `isDemo:
false, code: null, phone: null, patientId` absent. A `generateOtpCode()` helper produces the
6-digit string. `verifyOtpCode(expected: string | null, entered: string): boolean` returns
`expected !== null && expected === entered` — a `null` expected value can never match, which is
what makes the no-match path fail safely. Tests cover all four branches (shortcut, real match,
demo match, no match) plus `verifyOtpCode`'s null-expected case.

### Success Criteria:

#### Automated Verification:

- `npm test --workspace lambdas/patient` passes, covering all four `beginOtpChallenge` branches
  and `verifyOtpCode`

#### Manual Verification:

- None — this phase has no observable behaviour of its own

---

## Phase 3: Keypad-variant Lambdas

### Overview

Extend the existing stage-1 Lambda to start an OTP challenge instead of transferring immediately,
and add the two new non-VPC Lambdas the contact flow invokes for sending and verifying a code.

### Changes Required:

#### 1. `lambdas/authenticate/index.ts` (edit)

**Intent**: On any non-shortcut outcome, call `beginOtpChallenge` instead of just recording a
transfer, and return what the contact flow needs to carry the challenge forward as contact
attributes.

**Contract**: Adds `pesel`/`phone`/`callerNumber` handling unchanged; on the non-shortcut branch,
calls `beginOtpChallenge` and returns `{ authenticated: 'false', otpRequired: 'true', isDemo,
code, phone, patientId }` (fields flattened to strings, following the existing convention;
`patientId` empty string when absent) instead of setting `outcome: 'transferred'` directly — the
contact flow now routes to the send/verify sub-flow rather than straight to transfer. The shortcut
branch is unchanged.

#### 2. `lambdas/send-otp/` (new)

**Files**: `package.json`, `tsconfig.json`, `index.ts`, `index.test.ts`

**Intent**: Given a code and a phone (or a demo flag meaning "don't actually send"), publish an SMS
— or don't — and return the code so the contact flow can (re-)store it as a contact attribute.
Handles both the initial send and any resend with the same logic; on a resend for a non-demo
challenge, generates a fresh code via `@pcm/patient`'s `generateOtpCode()` before publishing.

**Contract**: Reads `code`, `phone`, `isDemo`, `isResend` from `Details.Parameters`. If `isDemo`,
returns `{ code }` unchanged, no SNS call. Otherwise, if `isResend`, generates a new code first;
publishes via `sns:Publish` to `phone` with the (possibly new) code in the message body; on any
publish error, still returns `{ code }` normally (see Critical Implementation Details — failures
are silent to the caller). Wrapped in `measured()`; no `authPath` is set by this Lambda.

#### 3. `lambdas/otp-verify/` (new)

**Files**: `package.json`, `tsconfig.json`, `index.ts`, `index.test.ts`

**Intent**: Compare the caller's entered code against the expected one carried in contact
attributes, and, on a match, produce the same authenticated shape the shortcut path produces.

**Contract**: Reads `enteredCode`, `expectedCode`, `isDemo`, `patientId` from
`Details.Parameters`. Calls `@pcm/patient`'s `verifyOtpCode`. On match, returns `{ authenticated:
'true', patientId }` and stamps `record.authPath = isDemo ? 'demo' : 'otp'`. On mismatch, returns
`{ authenticated: 'false' }` with no `authPath` set — the contact flow's own retry count decides
whether to re-prompt or transfer, mirroring how S-03 leaves capture-stage retries to the flow
rather than the Lambda.

### Success Criteria:

#### Automated Verification:

- `npm test --workspace lambdas/authenticate` passes, covering the extended non-shortcut branch
- `npm test --workspace lambdas/send-otp` passes, covering demo (no publish), real send, resend
  (new code generated), and a publish-failure case (still returns `{ code }`)
- `npm test --workspace lambdas/otp-verify` passes, covering match (both `otp` and `demo`
  `authPath`) and mismatch

#### Manual Verification:

- Direct test-event invocation of `send-otp` with a non-demo phone number results in a real SMS
  being received
- Direct test-event invocation of `otp-verify` with a matching code returns `authenticated: 'true'`

---

## Phase 4: Speech-variant fulfillment

### Overview

Extend `facility-info-speech`'s existing `AuthIntent` branch and add the equivalent OTP-entry
handling inline, reusing the same shared functions the keypad variant's new Lambdas use.

### Changes Required:

#### 1. `lambdas/facility-info-speech/index.ts` (edit)

**Intent**: On `AuthIntent`'s non-shortcut outcome, call `beginOtpChallenge` and carry the
challenge forward as session attributes instead of signalling an immediate transfer; add an
`OtpIntent` branch that reads the caller's entered digits, handles a reserved resend value the same
way the keypad variant does, and otherwise calls `verifyOtpCode` and closes with the authenticated
outcome or a mismatch signal for the flow's retry count to act on.

**Contract**: `AuthIntent`'s non-shortcut branch sets `sessionAttributes` for `otpRequired`,
`isDemo`, `code`, `phone`, `patientId` instead of `transfer`. `OtpIntent` reads an `otpCode` slot
value; if it equals the reserved resend sentinel, performs the same resend logic `send-otp` does
(same shared `@pcm/patient` code path, no cross-Lambda call needed since this runs in-process) and
re-prompts; otherwise calls `verifyOtpCode` and, on match, sets `authenticated`/`patientId` session
attributes and stamps `authPath` exactly as `otp-verify` does; on mismatch, signals the flow to
retry or transfer.

#### 2. `lambdas/facility-info-speech/index.test.ts` (edit)

**Intent**: Cover `AuthIntent`'s extended non-shortcut branch and all of `OtpIntent`'s outcomes.

**Contract**: Cases for real match, demo match, and no-match on `AuthIntent` (asserting all three
still produce next-step wording identical to each other where the neutrality guarantee applies);
`OtpIntent` cases for correct code (`otp` and `demo` `authPath`), wrong code, resend, and the
no-match/`code: null` path always failing regardless of entry.

### Success Criteria:

#### Automated Verification:

- `npm test --workspace lambdas/facility-info-speech` passes, including all new `OtpIntent` cases

#### Manual Verification:

- None beyond Phase 6's end-to-end call matrix

---

## Phase 5: Infrastructure

### Overview

Deploy the two new non-VPC Lambdas, grant SMS-publish permission, and add `OtpIntent`'s slot to the
existing `SpeechBot`.

### Changes Required:

#### 1. `infra/lib/infra-stack.ts` (edit) — `SendOtp` and `OtpVerify` functions

**Intent**: Deploy both new keypad-variant Lambdas without VPC attachment, since neither reaches
`his/`.

**Contract**: Two new `NodejsFunction`s (`SendOtp`, `OtpVerify`) following the existing
naming/logging/timeout conventions but *without* `vpc`/`securityGroups`/`allowPublicSubnet` —
deployed outside the VPC entirely, unlike every existing function. Each gets
`addPermission('ConnectInvoke', ...)` and a `CfnIntegrationAssociation`, same as `Authenticate`.
`SendOtp`'s role gets an explicit `addToPolicy` grant for `sns:Publish` with `Resource: '*'` (SNS
gives no narrower resource to scope a direct-to-phone-number publish to).

#### 2. `infra/lib/infra-stack.ts` (edit) — `OtpIntent` on `SpeechBot`

**Intent**: Add code capture and resend handling to the existing bot without touching its other
intents.

**Contract**: One DTMF-only custom slot type for the 6-digit code (mirroring `KeyedPesel`'s shape,
`allowAudioInput: false`), plus recognition of the reserved resend digit as a distinct slot value
rather than a separate intent. `OtpIntent` reuses `facilityInfoSpeech` as its fulfillment code hook,
same as `AuthIntent` — no new Lambda or bot resource.

### Success Criteria:

#### Automated Verification:

- `cdk synth` succeeds
- `Template.fromStack` assertions pass, extended for the two new functions (asserting they carry
  no VPC config) and the bot's new intent count

#### Manual Verification:

- `cdk deploy` succeeds; both new functions and the new intent are visible in the console

---

## Phase 6: Contact flow, hand-off, bookkeeping

### Overview

Build the OTP capture/resend/verify flow in both variants' consoles, document the new contract
surfaces, and verify the whole thing on real calls.

### Changes Required:

#### 1. Keypad OTP flow (console, not committed)

**Intent**: On `Authenticate`'s non-shortcut outcome with `otpRequired: 'true'`, offer a single-key
choice (`1` to enter the code now, `9` to have it sent again) before a 6-digit code capture,
looping on resend and on mismatch up to three combined verification attempts before transferring.

**Contract**: A Contact Flow Module invoked with the contact attributes `Authenticate` returned
(`isDemo`, `code`, `phone`, `patientId`). Pressing `9` invokes `SendOtp` with `isResend: 'true'`,
updates the stored `code` contact attribute from its response, and re-offers the same menu without
incrementing the attempt counter. Pressing `1` collects 6 digits terminated by `#`, invokes
`OtpVerify`; `authenticated: 'true'` sets the same `authenticated`/`patientId` contact attributes
S-03's shortcut path sets and returns to the main menu; a mismatch increments the attempt counter
and re-offers the menu, transferring after three mismatches.

#### 2. Speech-variant OTP turn (console, not committed)

**Intent**: Add the `OtpIntent` path to the existing Get Customer Input (Lex) loop, offering the
same resend-or-enter choice via DTMF before the code slot, branching on the session attributes
`OtpIntent`'s fulfillment sets the same way the flow already branches on `authenticated`.

**Contract**: Mirrors the keypad flow's menu shape inside the Lex turn; resend and mismatch
behave identically to the keypad variant per the shared `@pcm/patient` logic.

#### 3. `docs/reference/contract-surfaces.md` (edit)

**Intent**: Document the new load-bearing names this slice introduces.

**Contract**: New entries for the keypad contact attributes `otpRequired`, `isDemo`, `code`,
`phone` (set by `Authenticate`, read by the OTP Contact Flow Module and by `SendOtp`/`OtpVerify`),
the reserved resend digit (`9`, scoped to the OTP capture step only — distinct from the global `0`/
`*` digits), and the Lex session-attribute equivalents `OtpIntent` sets.

#### 4. Roadmap sync

**File**: `context/foundation/roadmap.md` (edit)

**Intent**: Flip S-04's status to reflect that planning is complete, per this skill's mechanical
roadmap-sync step.

**Contract**: `## At a glance` row for S-04 and the `### S-04` item body both get `Status:
planning`.

### Success Criteria:

#### Automated Verification:

- None — this phase is entirely console configuration and documentation

#### Manual Verification:

- Real match, wrong number: correct code authenticates and returns to the main menu, in both
  variants
- Demo account: entering the fixed `demoOtpCode` authenticates with no SMS sent, `authPath:
  'demo'`, in both variants
- Resend: pressing/selecting resend produces a new code (non-demo) without consuming an attempt,
  and the previously sent code no longer verifies
- No-match pair: any entered code fails after three attempts and transfers, indistinguishable in
  wording from a real wrong-code case
- A wrong pesel/phone combination and a wrong OTP code produce the identical transfer experience
  from the caller's side
- Per-call records show `authPath: 'otp'` and `authPath: 'demo'` on the respective authenticated
  outcomes, and the no-match path's records carry neither

---

## Testing Strategy

### Unit Tests:

- `@pcm/patient`'s `beginOtpChallenge` — shortcut, real match, demo match, no match
- `@pcm/patient`'s `verifyOtpCode` — match, mismatch, `null`-expected always false
- `lambdas/authenticate`'s extended non-shortcut branch — returns the OTP-challenge fields
- `lambdas/send-otp` — demo (no publish), real send, resend (new code), publish failure (still
  returns a code)
- `lambdas/otp-verify` — match (`otp` and `demo` `authPath`), mismatch
- `lambdas/facility-info-speech`'s `OtpIntent` — match, mismatch, resend, no-match-always-fails

### Integration Tests:

- None beyond the above — no cross-service integration surface unit-level mocking doesn't cover

### Manual Testing Steps:

1. Deploy and confirm both new functions and the new intent appear in the console
2. Call from a different number than the seeded real patient's phone; enter the correct code when
   texted; expect authentication
3. Repeat, entering a wrong code three times; expect transfer
4. Repeat, pressing resend once before entering the correct new code; expect authentication, and
   confirm the original code no longer verifies
5. Call with the seeded demo pair; expect the fixed code to authenticate with no SMS received
6. Call with a pesel/phone pair matching no record; expect the same prompt sequence and an
   eventual transfer indistinguishable from a real wrong-code case
7. Verify per-call records for each scenario carry the expected `authPath`

## Performance Considerations

None beyond the existing 2-second timeout already applied to every Lambda in the stack.

## Migration Notes

Additive only — new columns with a default (`isDemo`) and a nullable column (`demoOtpCode`) on an
existing table; the existing seeded patient row is unaffected.

## References

- Roadmap: `context/foundation/roadmap.md` §S-04
- PRD: `context/foundation/prd.md` §Access Control, §FR-005
- Precedent plan: `context/pending-verification/caller-id-authentication/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles.

### Phase 1: Patient persistence — demo flag and fixed code

#### Automated

- [x] 1.1 `npm run test` inside `his/` passes, including updated patient spec coverage for the
      demo row — 1f04325
- [x] 1.2 `npm run migration:run` inside `his/` applies cleanly against a fresh database — 1f04325

#### Manual

- [ ] 1.3 `POST /patient/verify` returns `isDemo`/`demoOtpCode` correctly for both seeded patients

### Phase 2: Shared `@pcm/patient` OTP challenge module

#### Automated

- [x] 2.1 `npm test --workspace lambdas/patient` passes, covering all four `beginOtpChallenge`
      branches and `verifyOtpCode` — f86ba5b

### Phase 3: Keypad-variant Lambdas

#### Automated

- [x] 3.1 `npm test --workspace lambdas/authenticate` passes, covering the extended non-shortcut
      branch — 75dc1cf
- [x] 3.2 `npm test --workspace lambdas/send-otp` passes, covering demo, real send, resend, and
      publish-failure cases — 75dc1cf
- [x] 3.3 `npm test --workspace lambdas/otp-verify` passes, covering match and mismatch — 75dc1cf

#### Manual

- [ ] 3.4 Direct test-event invocation of `send-otp` results in a real SMS being received
- [ ] 3.5 Direct test-event invocation of `otp-verify` with a matching code returns
      `authenticated: 'true'`

### Phase 4: Speech-variant fulfillment

#### Automated

- [x] 4.1 `npm test --workspace lambdas/facility-info-speech` passes, including all new
      `OtpIntent` cases — 6ad3f11

### Phase 5: Infrastructure

#### Automated

- [x] 5.1 `cdk synth` succeeds — c661f72
- [x] 5.2 `Template.fromStack` assertions pass, extended for the two new non-VPC functions and the
      bot's new intent count — c661f72

#### Manual

- [ ] 5.3 `cdk deploy` succeeds; both new functions and the new intent visible in the console

### Phase 6: Contact flow, hand-off, bookkeeping

#### Manual

- [ ] 6.1 Real match, wrong number: correct code authenticates in both variants
- [ ] 6.2 Demo account: fixed code authenticates with no SMS sent, `authPath: 'demo'`, in both
      variants
- [ ] 6.3 Resend produces a new code without consuming an attempt; old code stops verifying
- [ ] 6.4 No-match pair: any code fails after three attempts and transfers indistinguishably from
      a real wrong code
- [ ] 6.5 Wrong pesel/phone and wrong OTP code produce identical transfer experiences
- [ ] 6.6 Per-call records show `authPath: 'otp'` / `'demo'` correctly, absent on the no-match path
