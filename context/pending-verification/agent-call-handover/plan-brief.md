# Agent Call Handover — Plan Brief

> Full plan: `context/changes/agent-call-handover/plan.md`

## What & Why

Roadmap slice S-11. When a caller transfers to a human agent — by request, by exhausting
retries, or on error — the agent currently starts blind: no patient identity, no reason for the
transfer. This plan carries both as Connect contact attributes and renders them to the agent, so
FR-018 (conversation context), FR-019 (onward transfer), and FR-020 (patient identity) are
satisfied for the transfer points that already exist in S-01 and S-03.

## Starting Point

Every flow that can transfer to an agent has its own inline `TransferContactToQueue` block and
its own duplicated queue ARN placeholder. No flow sets a transfer reason. `authenticated`/
`patientId` are already stored as contact attributes once identity is established, but
`firstName`/`lastName` are dropped before ever reaching a Lambda response, even though the mock
returns them. S-03's speech-side authentication flow isn't merged into the console yet — only
documented as unmerged fragments.

## Desired End State

A caller who transfers from any of S-01's or S-03's five live trigger points, in either variant,
lands on a queue whose agent sees the caller's name/PESEL/phone (or an explicit "not yet
confirmed" placeholder) and a one-line reason for the transfer, via a Step-by-step Guide in the
stock Agent Workspace.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Scope | S-01 + S-03 transfer points only, in both variants | Matches roadmap prerequisites; booking/list/cancel/reschedule get the same treatment in a later pass without re-touching this work. |
| Architecture | One new shared Contact Flow Module (`agent-handover-module.json`) | Avoids repeating queue-selection and transfer logic at 5+ call sites; one place to extend later. |
| Display mechanism | Step-by-step Guide via a new Agent Whisper Flow | Presentable "patient record on screen" inside the stock Agent Workspace, no custom app; underlying carrier is still contact attributes. |
| Conversation context | A single `transferReason` label per trigger point | Cheap, one glance for the agent, identical shape across variants. |
| Unauthenticated case | Guide shows an explicit "not yet confirmed" placeholder | Agent always gets a consistent screen instead of a blank one. |
| Name-capture gap | Fixed at the source (`@pcm/patient` → both Lambdas) | Fixes it once, reusable by any future slice needing the name, not just this one. |
| Speech S-03 gap | Documented in the fragment docs, not merged here | Merging S-03's speech auth flow is that slice's own unfinished work, not S-11's. |
| Priority | Minimal but complete | FR-018/019/020 are nice-to-have and S-11 is low-priority in the roadmap; build exactly what's decided, no polish beyond it. |

## Scope

**In scope:**
- A shared Contact Flow Module owning queue selection and transfer.
- `firstName`/`lastName` carried through `@pcm/patient`, `lambdas/authenticate`,
  `lambdas/facility-info-speech`.
- `keypad-facility-info-main-menu-flow.json` (3 trigger points) and
  `keypad-authenticate-flow.json` (2 trigger points) wired to the module.
- `speech-facility-info-flow.json` (2 live trigger points) wired to the module.
- Fragment-doc updates for S-03's not-yet-merged speech auth flow.
- A View + Agent Whisper Flow rendering identity/reason to the connecting agent.
- Manual verification of FR-019 (native onward transfer — no build).

**Out of scope:**
- Merging S-03's speech authentication flow.
- Booking/list/cancel/reschedule flows' own transfer points.
- S-12 (agent appointment management during the transfer).
- A custom agent application or second login.
- New mock/patient data fields.

## Architecture / Approach

One new Contact Flow Module centralizes queue selection and the actual transfer. Every existing
transfer trigger point sets a literal `transferReason` attribute immediately before handing off
to the module — the module itself needs no Lambda invocation. Patient identity rides along as
contact attributes already present by the time the module runs, fixed at the source. A new Agent
Whisper Flow, attached to the destination queue, shows the agent a View built from those same
attributes when the call connects.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared module | New Contact Flow Module for queue selection + transfer | Console import step, no automated check |
| 2. Carry patient name | `lastName`/`firstName` survive to Lambda responses, with tests | Timing: must capture before OTP starts, not after |
| 3. Keypad flow wiring | 5 trigger points across 2 flows set `transferReason` + identity | Re-editing already-verified S-01/S-03 flows |
| 4. Speech flow wiring | 2 live trigger points wired; fragment docs updated | Doesn't fix the underlying S-03 speech merge gap |
| 5. Agent-side display | View + Whisper Flow + end-to-end call verification | Depends on Agent Workspace/Views being enabled on the instance |

**Prerequisites:** S-01 (`facility-info-keypad`, done), S-03 (`caller-id-authentication`) code
already deployed for the keypad variant.
**Estimated effort:** ~1 session across 5 phases; mostly configuration, one small Lambda phase.

## Open Risks & Assumptions

- The Agent Whisper Flow / View approach assumes the Connect instance has the unified Agent
  Workspace (Views-capable) enabled for voice contacts. If not, Phase 5 falls back to the CCP's
  native "Additional attributes" panel with no extra build.
- Speech-variant identity attributes remain Lex-session-scoped only until S-03's speech auth flow
  is actually merged; until then, speech-side transfers never carry identity (matches today's
  behavior).

## Success Criteria (Summary)

- An agent receiving a transferred call from any of the five live trigger points sees the correct
  patient identity (or an explicit placeholder) and a one-line transfer reason.
- No caller-visible or measurement behavior changes — this is entirely agent-side and
  configuration-only beyond the Lambda name-capture fix.
- FR-019's onward-transfer capability is confirmed working via stock controls, with no code
  written for it.
