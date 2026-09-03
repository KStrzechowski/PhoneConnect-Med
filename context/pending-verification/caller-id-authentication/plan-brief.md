# Caller ID Authentication — Plan Brief

> Full plan: `context/changes/caller-id-authentication/plan.md`

## What & Why

Roadmap **S-03**: a caller supplies a PESEL and phone number on the keypad, in both variants, and
— when calling from the number they declared — reaches the authenticated layer without a texted
code. This is the caller-ID shortcut, confirmed present on the source thesis's own diagram (not a
deviation, contrary to how the roadmap currently frames it) and deliberately used as the project's
built-in test hole for exercising the authenticated path without live SMS.

## Starting Point

`his/` has one Postgres-backed domain (`facility`); no `Patient` entity exists. The
Connect-invoked-Lambda pattern (keypad) and the single-Lambda-fulfills-a-Lex-bot pattern (speech)
are both established from S-01/S-02. F-03's spike already proved in-conversation DTMF capture
works inside a Lex turn, but surfaced a bug this slice must fix, not inherit: declining the
read-back confirmation currently disconnects the call instead of re-asking.

## Desired End State

A caller on either variant keys PESEL and phone, hears both read back, confirms, and — if calling
from the declared number and the pair is real — is authenticated and returned to the main menu.
Every other outcome (no match, matched-but-wrong-number, declined confirmation, timeout) is
handled safely and identically across variants, without ever revealing which case applied.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Auth factor pair | PESEL + phone, unchanged from the thesis | User confirmed this after considering and rejecting a PESEL+password alternative |
| Patient schema | `pesel`, `phone`, `firstName`, `lastName` | Display name avoids a second migration when S-06/S-11 need to show it, at the cost of one field with no consumer yet |
| Caller-ID shortcut framing | Confirmed on the thesis diagram; deliberately the project's test hole, not a deviation | User correction — the roadmap's "deviation" language is stale but out of this plan's scope to edit |
| Entry point | New main-menu branch, both variants, built as a reusable Contact Flow Module / intent | So S-05 can invoke the same auth step automatically later without a redesign |
| Post-auth success UX | Speak confirmation, set an authenticated flag, return to main menu | Gives an observable proof point without inventing scope, since no Layer-3 feature exists yet to hand off to |
| Attempt counting | One shared 3-try counter; messages distinguish only "no input" vs. "didn't match" | User's explicit instruction, and the NFR that forbids revealing which factor was wrong |
| Non-shortcut outcomes | Identical neutral "code sent" message + immediate transfer, for both no-match and matched-wrong-number | Corrects an earlier draft that would have leaked match/no-match by message choice — the NFR requires these two cases to be indistinguishable to the caller |
| Confirmation decline (F-03 fix) | Restart the whole PESEL+phone entry | One state machine, no risk of confirming a stale value from before the decline |
| Keypad confirmation step | Keypad also reads back and confirms via keypress, mirroring the speech variant | Required by L-03 — capture must be identical across variants or the confound F-03 exists to remove comes back |

## Scope

**In scope:** `his/` Patient persistence + `POST /patient/verify`; `@pcm/patient` shared
authentication module; `lambdas/authenticate/` (keypad); `AuthIntent` added to the existing
`facility-info-speech` fulfillment and `SpeechBot`; infra wiring for the new function and bot
intent; the keypad Contact Flow Module and updated speech contact flow (console); contract-surface
and roadmap bookkeeping.

**Out of scope:** real SMS OTP sending/validation (S-04); booking, listing, cancelling,
rescheduling (S-05–S-08); agent-facing patient views (S-11/S-12); a password factor; PESEL
checksum validation; cross-call session persistence; committing any contact flow to the repo.

## Architecture / Approach

`his/src/patient/*` mirrors `his/src/facility/*` exactly. `@pcm/patient` wraps the verification
fetch and owns the one decision that must never diverge between variants — whether a confirmed
pair plus the caller's actual number earns the shortcut — returning a result that deliberately
does not let its caller distinguish "no match" from "matched but wrong number." Both
`lambdas/authenticate/` (keypad) and the extended `lambdas/facility-info-speech/` (speech) call
this same function and only render its result. The keypad capture step is built as a Connect
Contact Flow Module — not inline — so S-05 can invoke it later; the speech capture step is a new
Lex intent on the existing bot with two DTMF-only slots and a confirmation setting that fixes
F-03's decline-disconnect bug.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Patient persistence | `his/` entity, migration, `POST /patient/verify` | First new domain since `facility`; low risk, well-worn shape |
| 2. `@pcm/patient` module | Shared verify + shortcut decision | The single piece of logic both variants must never duplicate (L-03) |
| 3. Keypad Lambda | `lambdas/authenticate/` | Mechanical, mirrors `facility-info` |
| 4. Speech fulfillment | `AuthIntent` branch in the existing handler | Must keep the two non-shortcut outcomes' wording identical |
| 5. Infrastructure | New function + Connect association; `SpeechBot` gets slots + fixed confirmation | Getting the DTMF-only slot config and the decline path right — F-03's bug lives here |
| 6. Contact flow + hand-off | Keypad module (console), speech flow update (console), contract-surfaces, roadmap sync | Entirely console work with no automated check — correctness rests on the manual call matrix |

**Prerequisites:** S-02 (done), F-03 (done, findings on file). A real phone number to seed as the
test patient's declared phone before manual verification.
**Estimated effort:** Two to three sessions across 6 phases; Phase 1–4 are mechanical extensions
of established patterns, Phase 5 carries the most new AWS-specific surface (Lex slot/confirmation
config), Phase 6 is verification-heavy but code-free.

## Open Risks & Assumptions

- **The seeded patient's phone number is placeholder data** until a real tester's number is
  substituted before manual verification — same posture as S-01's placeholder facility address.
- **`$.CustomerEndpoint.Address` is assumed to be the correct Connect system attribute** for the
  caller's number — not independently re-confirmed against AWS documentation in this planning
  session; if it differs, only the flow's attribute reference changes, not the Lambda contract.
- **The roadmap and PRD still describe the caller-ID shortcut as a thesis deviation.** This plan
  records the correction (it's on the thesis diagram, and is intentionally the project's test
  hole) but does not edit that prose — only the `Status` field gets touched by this skill's
  roadmap-sync step. Worth a follow-up edit to `roadmap.md`/`prd.md` outside this plan.
- **No fake OTP-entry loop is built.** Every non-shortcut outcome transfers immediately after the
  neutral message; S-04 is expected to insert a real code-entry step ahead of that transfer, not
  replace it.

## Success Criteria (Summary)

- A real call on both variants authenticates instantly when calling from the declared number, and
  is safely handled (identical wording, no stuck state) for every other outcome.
- The two non-shortcut outcomes (no match, matched-wrong-number) are provably indistinguishable to
  the caller — the concrete NFR guardrail this slice must not violate.
- The authenticated/patientId state this slice sets is documented well enough that S-05 can read
  it, or re-trigger this same auth flow, without redesigning it.
