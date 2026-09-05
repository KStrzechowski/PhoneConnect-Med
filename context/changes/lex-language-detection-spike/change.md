---
change_id: lex-language-detection-spike
title: Automatic language detection from the caller's first utterance, spiked
status: implementing
created: 2026-09-05
updated: 2026-09-05
archived_at: null
---

## Notes

Blocks `english-locale` (S-10). Chapter 3, §3.2.2 of the source thesis states twice, explicitly,
that Variant B's service language is detected automatically from the caller's first utterance,
with no explicit choice — this is named as the key distinguishing claim of Variant B versus
Variant A's menu structure. A DTMF language-selection prompt for the speech variant would
contradict this directly, so this can't be waved off as a nice-to-have.

No native Lex V2 / Amazon Connect feature does this (confirmed via research: Connect's
Get-Customer-Input-Lex block requires a fixed locale before it runs; Lex V2 has no first-utterance
locale routing). The mechanism has to be assembled: Kinesis Video Streams media capture + Amazon
Transcribe streaming with `IdentifyLanguage` to detect the language AND get a transcript of that
same utterance, then feed that transcript into the correctly-localized Lex bot via `RecognizeText`
so the caller's opening sentence (which may already contain a full booking request, per chapter 3's
own worked example) isn't wasted on language ID alone and doesn't need to be repeated.

Two newer AWS options were considered and rejected for this: Amazon Connect's "Agentic CX
designer" (GA'd this month, Sept 2026) and Amazon Nova Sonic speech-to-speech — both would
natively solve language detection, but both require replacing Lex V2's classic intent/slot model
project-wide, which the whole codebase (S-01–S-08) and the intent-accuracy measurement protocol
(`test-corpus-kit.md`) are built around. Rejected as disproportionate/too-new for this stage.

Mirrors F-03 (`lex-keypad-capture-spike`) in structure: throwaway CDK stack, hand-imported spike
flow, a bounded set of real test calls, a `findings.md` verdict, then teardown. Real risk found
during research: the only AWS reference implementation for KVS-audio-to-Transcribe
(`amazon-connect/amazon-connect-realtime-transcription`) is Java, archived since March 2023, and
only does fixed-language transcription — no proven Node.js/TypeScript reference exists for this
exact combination, which is why this needs a spike rather than going straight into `english-locale`'s
plan.

Scoped per user decision: ~8-10 real test calls (Polish/English openers, full one-sentence booking
requests in each language, one deliberately ambiguous/short opener); success judged on mechanism
correctness (language detected, RecognizeText produces a sane response, session carries into the
next native Lex turn) — Transcribe's transcription quality vs. Lex's own ASR is only noted
anecdotally, not formally compared.
