---
change_id: english-locale
title: English locale over unchanged shared business logic
status: implemented
created: 2026-09-05
updated: 2026-09-06
archived_at: null
---

## Notes

Roadmap S-10. Picked up in place of `intent-accuracy-measurement` (see that change's Notes) because
it is implementation work — new intents, duplicated keypad menus — rather than measurement that
depends on manual verification of already-built flows.

Open Roadmap Question 2 is unresolved: what exactly is counted to express the multilingualism
comparison (menu blocks/prompts duplicated for keypad vs. language artefacts added for speech, with
shared logic shown unchanged). The roadmap says to decide the counting rule before building this
slice, so the count is recorded as the work happens rather than reconstructed afterwards.
Recommended: caller-facing text units (strings duplicated in keypad flows vs. utterances/prompts
added to the Lex locale), with shared-logic diff shown as zero — decided during planning
discussion, not yet written into a plan.

Decisions made during planning discussion (2026-09-05), not yet in a written plan:
- **Language selection differs by variant.** Keypad (Variant A): DTMF-based selection, consistent
  with A being fully digit-driven already. Speech (Variant B): automatic detection from the
  caller's first utterance — chapter 3, §3.2.2 states this explicitly and twice, naming it as
  Variant B's key distinguishing claim versus A's menu structure. This is genuinely load-bearing,
  not a nice-to-have.
- **Blocked on `lex-language-detection-spike`.** No native AWS mechanism does first-utterance
  language routing for Lex V2; the mechanism must be assembled (Transcribe streaming
  `IdentifyLanguage` + a `RecognizeText` handoff so the first utterance's content, which may
  already carry a full booking request per chapter 3's worked example, isn't wasted). This is
  real, unproven platform risk — see that change's notes — spiked first, mirroring F-03's
  precedent, before this plan is written.
- Booking edge-case parity, global-command translation scope, and the exact counting-rule writeup
  were not fully settled before the conversation moved to spiking the language-detection mechanism.
  Revisit when picking this back up.
