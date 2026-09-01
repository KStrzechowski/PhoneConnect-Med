<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Facility Information By Speech Implementation Plan

- **Plan**: context/changes/facility-info-speech/plan.md
- **Scope**: Full plan (Phases 1-4)
- **Date**: 2026-09-01
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Missing test coverage for InfoIntent's downstream-failure path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: lambdas/facility-info-speech/index.test.ts (untested branch: index.ts:45-50)
- **Detail**: `lambdas/facility-info-speech/index.ts`'s `InfoIntent` handler catches a `fetchFacility` failure the same way `lambdas/facility-info/index.ts` does (sets `record.outcome = 'error'`, returns a graceful fallback response instead of throwing). The sibling `lambdas/facility-info/index.test.ts` explicitly covers this path twice ("returns a handled error when the mock is unreachable", "an unreachable mock still emits a record, marked as a failure"). `facility-info-speech/index.test.ts` has no equivalent test, despite introducing the identical error-handling branch on the one real external boundary this Lambda has.
- **Fix**: Add a test mocking `globalThis.fetch` to throw, asserting the fallback Polish message content (`"Przepraszam, mam teraz problem z pobraniem tych informacji. Łączę z konsultantem."`), `sessionState.dialogAction.type === 'Close'`, and that the measurement record's `outcome` is `'error'` with the thrown error's message — mirroring `facility-info/index.test.ts`'s two failure-path tests.
- **Decision**: SKIPPED

### F2 — Stale `RepeatIntent` references in foundation docs (outside this plan's scope)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: README.md:90, context/foundation/source-requirements.md:261, context/foundation/test-corpus-kit.md:76
- **Detail**: The intent originally named `RepeatIntent` throughout the plan was renamed to `RepeatLastMessageIntent` mid-implementation — Lex V2 reserves the base name `RepeatIntent` for its built-in `AMAZON.RepeatIntent`, and a plain custom intent can't reuse it. Every file this plan actually touches (code, tests, `contract-surfaces.md`, `lex-sample-utterances.md`, the plan itself) was updated consistently — confirmed via a repo-wide grep, zero stray hits inside the reviewed scope. These three broader foundation/reference docs, which are outside this plan's declared file list, still say `RepeatIntent` and will read as inconsistent to anyone (including thesis examiners) cross-checking docs against the deployed system.
- **Fix**: One-line find-and-replace of `RepeatIntent` → `RepeatLastMessageIntent` in each file, whenever convenient — no functional impact, purely documentation accuracy.
- **Decision**: FIXED

## Notes

- **Automated success criteria**: re-ran every automated check across Phases 1-3 in this session — all pass (`@pcm/facility` typecheck + tests, `facility-info` typecheck + tests, `facility-info-speech` typecheck + 6/6 tests, `infra` typecheck + `cdk synth` + 16/16 jest tests).
- **Manual success criteria**: all Manual Progress items across Phases 1-4 are checked `[x]` and were independently verified this session — either directly by the user (live phone call testing, including catching and fixing two real production bugs: an intent-name case-sensitivity mismatch in the Connect flow's transfer condition, and a Lex session-attribute reset bug that broke both repeat and the 3-strikes fallback counter) or via read-only AWS CLI evidence (Lambda invokes returning real seeded data, bot status/intents, a live Lex conversation turn, bot-Connect association, and a direct CloudWatch measurement-log check). None are rubber-stamped.
- **Item 4.7 (roadmap status → done)** is the one Progress row still `[ ]` — this is intentional and self-acknowledged in the plan's own Phase 4 contract ("via `/10x-archive` at close-out"), not an implementation gap. It is not counted as a review finding.
- **Console-only artifacts not in git**: the actual Amazon Connect contact flow (`connect-flow-templates/facility-info-speech.json`, gitignored per this project's established convention) contains fixes discovered during live call testing that aren't reflected in any committed file: the Connect flow's `Equals` condition against the Lex-returned intent name must match Connect's actual runtime casing (`Agenttransferintent`, not `AgentTransferIntent`), and the flow's `elicit` block must not resend `LexSessionAttributes` on every loop iteration (this silently resets Lex's session state each turn, breaking `RepeatLastMessageIntent` and the fallback counter). Both are real findings from this implementation but live outside this review's file scope since the flow itself is deliberately never committed.
