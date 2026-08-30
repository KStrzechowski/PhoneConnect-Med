---
change_id: lex-keypad-capture-spike
title: Lex keypad capture spike
status: implemented
created: 2026-08-26
updated: 2026-08-30
archived_at: null
---

## Notes

Roadmap item **F-03**. Scope cap from the roadmap: it confirms a mechanism, it does not build
authentication. Discard the artefact afterwards.

**Decisions taken during planning (2026-08-26):**

- **Bot in CDK, flow in the console.** The bot is a `CfnBot` in a throwaway stack so the spike's
  byproduct is a known-good DTMF fragment S-03 copies, and so CloudFormation is proven able to
  express the behaviour rather than only the console. Contact flow JSON is written into this
  folder for import, not into `infra/` — `CfnContactFlow` would take the same JSON and add only
  a deploy step, while creating a drift obligation during the one activity this change exists
  for, namely console experimentation.
- **Text conversation logs, no audio logs.** Text gives the slot-elicitation timeline needed to
  characterise the inter-digit timeout. Audio would put recordings of spoken PESELs into S3 —
  the thing the teardown exists to avoid creating.
- **The throwaway intent is speech to DTMF and back to speech.** Slot 1 is a DTMF-captured
  `pesel`, slot 2 a spoken confirmation. A DTMF-only bot would pass this spike while Wariant B
  still failed, because the confound argument needs Lex to hand the turn back to speech without
  leaving the session.
- **Teardown clears the Connect instance, git keeps the source.** Idle cost is near zero, so
  teardown is hygiene, not billing: no stale bot alias on the instance S-02 builds its real
  speech flow on, and no recorded audio outliving the afternoon.

**F-01 and F-02 status when this was planned:** every automated step landed, **every manual
verification step still unchecked** — `cdk deploy` has never been run. This spike deliberately
depends on neither: no Lambda, no mock, no round trip. It needs only the Connect instance and
the claimed test number, both of which exist.
