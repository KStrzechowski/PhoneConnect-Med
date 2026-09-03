# OTP Authentication Fallback — Plan Brief

> Full plan: `context/changes/otp-authentication-fallback/plan.md`

## What & Why

S-04 adds the texted one-time-code fallback so a caller can authenticate from *any* number, not
just the one on file. S-03 already stubs this: every non-shortcut outcome speaks a neutral "code
sent" line and transfers, without ever actually sending or checking a code. This slice fills that
in, in both variants, without touching the shortcut path.

## Starting Point

`@pcm/patient`'s `authenticate()` already collapses "no match" and "matched but wrong number" into
one neutral `{ authenticated: false }`. `InvocationRecord` already types `authPath: 'otp' |
'demo'`, unused until now. No SMS capability, no demo-account flag, and no code-entry step exist
anywhere yet.

## Desired End State

A matched-but-wrong-number caller enters a texted code and authenticates exactly like the shortcut
path. A seeded demo patient authenticates with a fixed, pre-known code and no SMS sent. A caller
who matches nothing walks the identical prompt sequence and always fails after three attempts —
nothing distinguishes the two failure cases. A caller can request a fresh code before exhausting
their attempts, and that request doesn't cost them an attempt. An SMS-infrastructure failure looks
exactly like a wrong code — no separate branch.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Demo-account scope | Build fully now | SMS production access may not land before this ships; demo accounts are the only way to demo the authenticated path without it |
| Resend | Caller-initiated, before the 3-attempt cap | Real delivery hiccups shouldn't force a hard fail, but shouldn't add complexity beyond what the flow already has |
| SMS send failure | Indistinguishable from a wrong code | Matches the project's existing neutral-wording philosophy; zero new IVR branches |
| Test depth | Match S-03 | Time pressure doesn't justify a weaker safety net than the rest of the codebase |
| OTP state storage | Session/contact attributes only, no DB | Nothing needs to survive past the call; matches per-call-only session model |
| Verification Lambdas | Both new Lambdas non-VPC | Neither reaches `his/` — comparison is against data already in this call's state |
| Code format | 6-digit numeric | Standard OTP convention, no real tradeoff worth asking |

## Scope

**In scope:** demo flag + fixed code on `Patient`, `@pcm/patient`'s OTP-challenge decision, two new
non-VPC Lambdas (`send-otp`, `otp-verify`), speech-variant equivalent inline in
`facility-info-speech`, SNS publish permission, one new Lex slot, both variants' contact-flow work,
contract-surfaces documentation, full manual call verification.

**Out of scope:** persistent OTP storage, a distinct SMS-failure branch, resend rate-limiting,
anything touching the shortcut path itself, booking/listing/agent slices, English locale.

## Architecture / Approach

`@pcm/patient` decides what code (if any) is expected and where to send it; two thin non-VPC
Lambdas do the mechanical send/verify work for the keypad variant; the speech variant reuses the
same shared functions in-process rather than getting parallel Lambdas. No new persistent store —
everything rides in the call's own session/contact attributes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Patient persistence | Demo flag + fixed code, seeded demo patient | None — additive migration |
| 2. Shared OTP module | `beginOtpChallenge` / `verifyOtpCode` in `@pcm/patient` | Getting the four-branch discrimination (shortcut/real/demo/no-match) right once, since both variants depend on it |
| 3. Keypad Lambdas | Extended `authenticate`, new `send-otp`, new `otp-verify` | Resend regenerating a code without an extra mock round-trip |
| 4. Speech fulfillment | `OtpIntent` in `facility-info-speech` | Keeping wording identical to the keypad variant where neutrality matters |
| 5. Infrastructure | 2 non-VPC functions, SNS grant, new Lex slot | First non-VPC functions in the stack — confirm they still reach Connect fine without VPC |
| 6. Contact flow + verification | Console flows in both variants, full manual test matrix | Hand-built, uncommitted flows — the usual risk for this project |

**Prerequisites:** S-03 code-complete (it is — sitting in `context/pending-verification/`); SMS
production access filed (support case in progress, ~24h turnaround).
**Estimated effort:** ~2-3 sessions across 6 phases.

## Open Risks & Assumptions

- SMS production access may not clear before this ships — demo accounts (built fully, per the
  decision above) are the mitigation, not a fallback plan.
- The reserved resend digit (`9`) needs to not collide with anything else active during OTP entry
  — confirmed clear in Phase 6's flow design, but worth double-checking against the final console
  build.
- Per-message SMS cost to Polish numbers is still an open roadmap question (Open Roadmap Question
  5 in `roadmap.md`) — low-volume testing keeps this a non-issue regardless.

## Success Criteria (Summary)

- A caller from an unregistered number authenticates with a real texted code, in both variants
- A seeded demo patient authenticates with no SMS sent, and the per-call record says so
  (`authPath: 'demo'`)
- No caller-observable difference exists between a wrong code and a code that was never real
