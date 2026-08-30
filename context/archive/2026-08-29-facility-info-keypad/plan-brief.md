# Facility Information By Keypad — Plan Brief

> Full plan: `context/changes/facility-info-keypad/plan.md`

## What & Why

Roadmap item **S-01**, the first vertical slice: a caller presses a key on the main menu, hears
the facility's address and opening hours retrieved through shared business logic — never
hard-coded in the flow — and can reach a human at any point. It is the walking skeleton that
proves telephony, the Lambda layer, and the mock are wired correctly end-to-end. It is
deliberately **not** evidence for the project's hypothesis (a one-keypress task favours the
keypad by construction); the real comparison happens at S-05 (booking).

## Starting Point

`his/` is stock NestJS with no persistence at all — `tech-stack.md` already commits it to
Postgres, deferred until "the first slice that needs it," which is this one. The
Connect-invoked-Lambda pattern is established (`connect-health`: `measured()` wrapper, flat
string map, handled errors) and this slice's Lambda copies it exactly. No contact flow has ever
been committed to the repo — flows are hand-built in the console, a convention this slice
continues rather than breaks.

## Desired End State

A caller dials the test number, presses a key, and hears the address and opening hours read back
from a real database row through a dedicated Lambda. From any point they can press a digit to
repeat the last thing said, or reach a human — by request, by exhausting 3 failed attempts, or
because something broke downstream — without the call ever dropping.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| ORM | TypeORM | The NestJS-blessed, convention-based choice `tech-stack.md` already selected the framework for | Plan |
| Postgres hosting | Self-hosted container on the existing EC2 instance | Zero added cost, reuses F-01's instance and network as-is | Plan |
| Repeat mechanism | Generic stored-attribute pattern (`lastMessageText`), not a per-block loop-back | Built once here so every later slice's menu extends it instead of rebuilding it | Plan |
| DB testing | Real Postgres via Docker in the test suite | Catches real migration/query bugs while there's exactly one table to get wrong | Plan |
| Failed-attempt counting | One combined counter for invalid keypresses and timeouts | Matches Connect's own retry model and the PRD's plain reading of FR-006 | Plan |
| Repeat (FR-003) scope | In scope for this slice, not a cut-if-tight item | Cheap in the keypad variant; deferring it would waste the generic mechanism just built | Plan |
| Facility data shape | Structured fields (address, opensAt, closesAt, openDays), not a pre-composed sentence | S-10 (English locale) requires the shared logic to stay unchanged when a language is added | Plan |
| Contact flow artifact | Not committed; built by hand in the console | Continues F-01's own precedent, unlike the throwaway Lex spike which needed exact reproducibility | Plan |

## Scope

**In scope:** Postgres + TypeORM in `his/`; a `facility` table with one seeded row; a
`GET /facility` endpoint; `lambdas/facility-info/`; CDK wiring for the new function and the
second container; the main-menu contact flow (console); the generic repeat mechanism; roadmap
and contract-surface bookkeeping.

**Out of scope:** the speech variant (S-02); any other data model (doctors, patients,
appointments); authentication; expanding CI to run tests automatically; multi-facility support.

## Architecture / Approach

`his/` gains one Postgres-backed table and endpoint. `lambdas/facility-info/` mirrors
`connect-health` structurally — same `measured()`/`downstream()` wrapper, same flat-map contract
— calling the new endpoint instead of `/health`. `infra-stack.ts` grows a second container
(Postgres, alongside `his` on the existing instance) and a second `NodejsFunction`, following the
exact VPC/security-group/Connect-association shape already proven by `connect-health`. The
contact flow is designed in prose in the plan and built in the console, carrying the
global-command/repeat/attempt-count/error-transfer shape forward as the pattern every later
slice extends.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Facility persistence in `his/` | Postgres + TypeORM, seeded `facility` row, `GET /facility` | First-ever migration in this repo; schema mistakes here are cheapest to fix now |
| 2. `lambdas/facility-info/` | A Connect-invoked handler mirroring `connect-health` | Low risk — this is a proven shape being copied |
| 3. Infrastructure | Second container, second function, updated deploy pipeline | Compose-based restart replacing a single `docker run` is the first real change to a working pipeline |
| 4. Contact flow and hand-off | Main menu, global commands, repeat, roadmap sync | Entirely console work with no automated check — correctness rests on the manual call matrix |

**Prerequisites:** F-01 and F-02 actually deployed (both `done`, but their manual verification
steps should be re-confirmed live before building on them).
**Estimated effort:** One to two sessions across 4 phases; Phase 1 and Phase 3 carry the most
substance, Phase 2 is mechanical, Phase 4 is verification-heavy but code-free.

## Open Risks & Assumptions

- **F-01/F-02 have queued manual verification steps** that may not have been re-confirmed since
  they were written — this plan builds on them as if they hold.
- **No agent queue exists yet.** The default `BasicQueue` is assumed sufficient; if the instance
  needs one created by hand, that's a Phase 4 prerequisite, not a blocker.
- **Facility content (name, address, hours) is invented placeholder data** — nothing in the thesis
  or repo names a real facility. Low-stakes and easy to change later since it's just seed data.
- **The generic repeat mechanism adds console complexity this slice's PRD acceptance criteria
  don't strictly require** (FR-003 is nice-to-have) — accepted deliberately so later slices don't
  redesign it under more time pressure.

## Success Criteria (Summary)

- A real phone call reaches the facility answer through the shared Postgres-backed logic, not a
  hard-coded string in the flow.
- Repeat, agent-transfer, 3-attempt, and error-transfer all work and share one measurement trail
  carrying `variant: "keypad"`.
- The pattern (repeat attribute, attempt counting, error transfer) is documented well enough that
  S-02 can extend it rather than reinvent it.
