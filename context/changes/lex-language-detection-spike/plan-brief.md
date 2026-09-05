# Lex Language Detection Spike — Plan Brief

> Full plan: `context/changes/lex-language-detection-spike/plan.md`

## What & Why

Confirm, on a throwaway bot and real phone calls, whether Variant B can detect which language a
caller is speaking from their first utterance alone — and carry that utterance's actual content
into the bot's first real turn — without a DTMF language menu. Chapter 3, §3.2.2 of the source
thesis states this twice as Variant B's key distinguishing claim over Variant A's menu structure;
a DTMF prompt for Variant B would directly contradict it. This blocks `english-locale` (S-10).

## Starting Point

The Lex bot has one locale (`pl_PL`) and no language-routing mechanism at all. No native Lex V2 or
Amazon Connect feature detects language from a first utterance — it has to be assembled from
Kinesis Video Streams audio capture, Amazon Transcribe streaming (`IdentifyLanguage`), and a
`RecognizeText` hand-off. The only public reference implementation for KVS-to-Transcribe is Java,
archived since March 2023, and doesn't do automatic language ID — there is no proven path for this
codebase's Node.js/TypeScript stack.

## Desired End State

A written verdict (`findings.md`: confirmed / confirmed-with-constraints / refuted) backed by a
real call matrix, plus working CDK/Lambda fragments for both halves of the mechanism, so
`english-locale` can be planned from it without another phone call. Everything the spike deployed
is torn down.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Language selection mechanism | Automatic detection (speech) vs. DTMF (keypad) | Chapter 3 §3.2.2 states this explicitly for Variant B; the two variants don't need to match here | Thesis (chapter 3) |
| Rejected: Agentic CX designer | Not used | Solves this natively but requires replacing Lex V2's intent model project-wide; too new (GA'd this month), no CDK support found | Plan (conversation) |
| Rejected: Amazon Nova Sonic | Not used | Same reason — full architecture swap away from the intent/slot model the measurement protocol assumes | Plan (conversation) |
| Detection mechanism | KVS media streaming + Transcribe streaming `IdentifyLanguage` | Only mature, documented AWS path; the alternative (build from scratch) doesn't exist as a simpler option | Plan (conversation) |
| First utterance's content | Fed into `RecognizeText`, not discarded | Chapter 3's own worked example has the first utterance carry a full booking request; discarding it would force a re-ask and inflate turns-to-completion | Plan (conversation) |
| Invoke mode | Asynchronous + Wait + Load Lambda Result | Synchronous caps at 8s; Transcribe needs ~3s of audio plus real-world latency | Plan (research) |
| Call budget | ~8-10 real calls | Enough to cover both openers, both full-sentence requests, and one ambiguous case | User decision |
| Success bar | Mechanism correctness only; ASR quality noted anecdotally | Keeps the spike bounded to its load-bearing question | User decision |

## Scope

**In scope:** feasibility check (Node/TS KVS path, Transcribe language-pair support), a throwaway
two-locale bot, the spike Lambda, a hand-imported contact flow, ~8-10 real test calls, a verdict,
roadmap sync (new Foundation item F-04), teardown.

**Out of scope:** `english-locale`'s real menus/flows/intents/training data, transcription-quality
parity measurement, mid-call language switching, any change to `@pcm/*` or F-02's measurement
substrate.

## Architecture / Approach

`Start media streaming` → `Invoke AWS Lambda function` (async) → `Wait` (~5-6s, filler prompt
plays) → `Load Lambda Result` → `Check contact attributes` (branch on detected language) → native
`Get Customer Input (Lex)` (pointed at the matching locale) → `Stop media streaming`. The Lambda
does the real work: KVS `GetMedia` → PCM extraction → Transcribe streaming with `IdentifyLanguage`
→ `RecognizeText` against the identified locale's bot, returning both the language code and Lex's
response. The open technical question Phase 4 exists to answer: whether that `RecognizeText`
call's session is the same one Connect's native block picks up next, or whether every turn has to
stay Lambda-driven instead.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Feasibility check | Confirmed (or refuted) Transcribe language pair + a TypeScript KVS-audio path | No proven Node.js reference exists for this — the single biggest unknown in the whole spike |
| 2. Throwaway stack | Two-locale bot, spike Lambda, deployed | New AWS surface (KVS, Transcribe streaming) never used in this project before |
| 3. Call matrix | Language detected correctly across ~8-10 real calls | Short/ambiguous openers may misidentify |
| 4. Session continuity | Confirms (or refutes) that the hand-off preserves session state | Connect's Lex session-ID contract for this isn't publicly documented |
| 5. Verdict, hand-off, teardown | Written verdict + roadmap sync (F-04) + clean teardown | None if Phases 1-4 landed |

**Prerequisites:** none beyond what F-01/F-03 already established (deployed Connect instance,
claimed test number).
**Estimated effort:** Phase 1 is the make-or-break gate — if it refutes either check, the rest of
the spike doesn't run and the plan stops there. If it clears, expect roughly the same effort as
F-03 (a few sessions, ~8-10 real calls) plus the phase-4 continuity question.

## Open Risks & Assumptions

- **Phase 1 could refute the whole mechanism before Phase 2 ever starts** — no proven Node.js path
  for KVS audio consumption is the named risk, not a hedge.
- **The session-continuity question (Phase 4) has no confirmed answer yet** — if it fails, the
  fallback (every turn Lambda-driven, not just the first) is a materially bigger design than
  `english-locale`'s plan currently assumes.
- **A `Verdict: refuted` outcome means recording a deviation from chapter 3 §3.2.2** — DTMF
  selection for Variant B too, framed the same way the project's other source-thesis deviations
  (caller-ID shortcut, two-step slot presentation) are already recorded.

## Success Criteria (Summary)

- A written, evidenced verdict exists that `english-locale` can plan from without another call
- If confirmed (with or without constraints): working CDK/Lambda fragments are hand-off-ready
- If refuted: the DTMF fallback and its thesis-deviation framing are costed, not just noted
- The Connect instance and its costs are clean afterward
