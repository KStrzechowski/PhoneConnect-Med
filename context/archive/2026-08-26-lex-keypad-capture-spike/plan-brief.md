# Lex Keypad Capture Spike — Plan Brief

> Full plan: `context/changes/lex-keypad-capture-spike/plan.md`

## What & Why

Roadmap item **F-03**. A throwaway Lex V2 bot, called on the real test number, answers one
question: can the natural-language variant collect an 11-digit PESEL on the keypad **inside a
conversational turn**, then carry on in speech, without bouncing the caller out to a separate
input step?

The stakes are the confound, not the feature. PRD §Authentication resolves FR-005 by capturing
PESEL on the keypad in **both** variants, precisely so identity capture cannot explain any
measured difference between them. If Wariant B has to leave the bot to collect digits, the two
variants no longer capture identity identically and the authenticated half of the comparison is
confounded for reasons unrelated to the hypothesis. S-03 is blocked on the answer.

## Starting Point

Nothing exists in the cloud beyond the Connect instance and the claimed test number — no bot, no
contact flow, no deployed function. F-01 and F-02 have every automated step green and **every
manual step unchecked**: `cdk deploy` has never run. The spike is planned to depend on neither,
using no Lambda, no mock and no round trip. The mechanism itself is expressible in the pinned
CDK — `CfnBot`, `CfnBotVersion`, `CfnBotAlias`, `allowDtmfInput` and `DTMFSpecification` are all
present in `aws-cdk-lib@^2.265.0` — so what is unknown is behaviour on a real call, not whether
an API exists.

## Desired End State

`findings.md` carries a verdict — confirmed, confirmed-with-constraints, or refuted — backed by
the text conversation log of about a dozen calls and by the working `CfnBot` DTMF fragment. The
roadmap's F-03 item no longer says `proposed` and its open Unknown is closed or costed. Nothing
the spike created is still running on the Connect instance. You can plan S-03's identity capture
from the document without making another phone call.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Build medium — bot | CDK (`CfnBot` in a throwaway stack) | The byproduct is a known-good DTMF fragment S-03 copies, and it proves CloudFormation can express the behaviour, not just the console. | Plan |
| Build medium — flow | Console, from JSON written into the change folder | `CfnContactFlow` takes the same JSON and adds only a deploy step, while creating a drift obligation during the one activity this change exists for. | Plan |
| Pass bar | Mechanism plus the behaviours that decide usability | "It captured digits once" is not enough to commit S-03; a mis-keyed digit or an unpressed `#` surfaces on call three of a demo, not call one. | Plan |
| Readback | TTS readback plus text conversation logs | Two independent confirmations, no Lambda and no dependency on an undeployed F-01, and a durable timeline that survives into the write-up. | Plan |
| Conversation logs | Text only, no audio | Text gives the timeout timeline; audio would put recordings of spoken PESELs into S3 — the thing teardown exists to avoid creating. | Plan |
| Bot shape | Speech intent → DTMF slot → spoken slot | A DTMF-only bot would pass the spike while Wariant B still failed; the confound argument needs Lex to hand the turn back to speech in-session. | Plan |
| Outcome handling | A decision phase that runs whatever the result | The likeliest outcome is "works, but…", and a plan branching only on yes/no leaves the decision to be improvised. | Plan |
| Locale | Polish, availability checked as step one | First contact with Lex in this project; an unavailable Polish locale is a bigger finding than F-03's own question and belongs on a throwaway in hour one. | Plan |
| Teardown | Clear the Connect instance, keep the source in git | Idle cost is near zero, so teardown is hygiene: no stale alias on the instance S-02 builds on, no PESEL logs outliving the afternoon. | Plan |

## Scope

**In scope:** a Polish locale availability check; a throwaway CDK stack with one bot, version and
alias; the Connect association; an importable contact flow; about a dozen calls across a
five-row behaviour matrix; a written verdict; roadmap and contract-surfaces sync; full teardown.

**Out of scope:** building authentication (PESEL validation, phone pairing, attempt counting,
caller-ID matching — all S-03); the full auth slot chain; any Lambda or mock involvement;
codifying the contact flow; audio logs; any measurement or F-02 wiring; Wariant A's keypad path,
which was never in doubt.

## Architecture / Approach

Speech triggers the intent, Lex elicits `pesel` over DTMF, then elicits a spoken confirmation —
all inside one Lex session. The contact flow only greets, hands off to the bot, and reads the
captured slot back; it makes no decisions, so nothing here contradicts L-03. The bot, its
version, its alias with text logs and the Connect association live in one throwaway stack inside
the existing `infra/` app, sharing its `connectInstanceArn` context value.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Polish locale and the throwaway bot | Confirmed locale, deployed bot, alias associated with Connect | Polish may not be an available Lex V2 locale in `eu-central-1` — a bigger finding than the spike's own question |
| 2. The flow, and the first successful call | The answer to the roadmap's question, on a real call | Deploy ordering: version cut while the locale is still building fails the first `cdk deploy` |
| 3. The behaviours that decide usability | Five-row matrix read off the text log | `allowDtmfInput` set only on the initial prompt attempt — passes Phase 2, fails the re-ask row |
| 4. Verdict, hand-off, teardown | `findings.md`, roadmap sync, clean Connect instance | Tearing down before the findings are settled, leaving nothing to re-test |

**Prerequisites:** the Connect instance and the claimed test number (both exist); AWS console
access; a phone to dial from. Explicitly **not** F-01 or F-02 being deployed.

**Estimated effort:** one focused session — an afternoon for Phases 1–3 with the phone in hand,
plus a short write-up and teardown.

## Open Risks & Assumptions

- **Polish locale availability is assumed, not verified.** This is deliberately Phase 1's first
  action rather than a planning assumption, because it cannot be settled from the repo.
- **The Connect bot-association API shape is stated from the Lambda-association precedent, not
  confirmed.** The plan names the console association as the fallback, mirroring what F-01
  already recorded.
- **A partial result is the likeliest outcome.** Phase 4 is built to absorb it; the fallback
  decision itself remains yours, and the roadmap's F-03 Unknown stays open until you make it.
- **The spike proves capture, not a full auth sequence.** Multi-slot chaining across three
  attempts is S-03's design work and could still surprise.

## Success Criteria (Summary)

- You can decide how S-03 collects identity in Wariant B without placing another call.
- If the mechanism is anything less than clean, the fallback options are written down with their
  confound cost — so the choice is made deliberately rather than improvised mid-slice.
- The Connect instance is as clean as it was before the spike, and the working CDK fragment
  survives in git.
