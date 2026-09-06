# Agent Appointment Management — Plan Brief

> Full plan: `context/changes/agent-appointment-management/plan.md`

## What & Why

Roadmap slice S-12, FR-017: an agent handling a transferred, authenticated call can create,
cancel, or reschedule the caller's appointment from inside the Agent Workspace, during that same
call. It's the lowest-priority slice in the roadmap and the explicit "first thing to drop if the
week runs short," since it produces no A-vs-B comparison data — but it's cheap to build because
every business-logic primitive it needs already exists.

## Starting Point

S-05/S-07/S-08 already built and tested every mutation this needs (`bookAppointment`,
`cancelAppointment`, `rescheduleAppointment`, `listAppointments`, day/time resolution) in the
shared `@pcm/appointment` package — no HIS change is required. S-11 already built the only
mechanism Connect offers for showing a custom screen to an agent mid-call: an Inbound-type "guide
flow" triggered by a `Set event flow` block, currently showing a read-only patient-identity
screen-pop. All four prerequisites are code-complete, sitting in `context/pending-verification/`.

## Desired End State

After the existing screen-pop, an authenticated agent sees a choice of three operations. Picking
one walks them through a short guided screen sequence (mirroring the caller-facing flow's own
shape) ending in a plain success/failure message, with the underlying appointment data mutated
exactly as it would be by a caller doing the same thing over the phone. An unauthenticated
transfer is unaffected — same placeholder screen S-11 already shows, nothing more.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Operation scope | All three: create, cancel, reschedule | Matches FR-017 literally; marginal cost is low since business logic already exists. | Plan |
| Lambda architecture | One Lambda, dispatched by `operation` + `step` | Avoids tripling IAM/infra ceremony for a nice-to-have feature already flagged as a scope risk. | Plan |
| View architecture | Two reusable, parameterized custom Views (picker + confirm/message) | Directly targets the roadmap's own named risk — this is the slice most likely to quietly become interface work. | Plan |
| Unauthenticated transfer | Placeholder only, no action buttons | Zero new logic; matches the PRD's literal "no agent workflow beyond the three operations." | Plan |
| Appointment list size | Reuse the existing capped query unchanged, surface all rows it returns | Avoids a second divergent way to fetch "my appointments"; a screen list isn't limited to 3 spoken items. | Plan |
| Post-action behavior | End after one operation, no loop back to the chooser | Looping is itself a small workflow — exactly what the PRD's non-goal excludes. | Plan |
| Screen copy | Distinct, concise agent-facing wording, not reused caller strings | Caller-register phrasing ("Umawiam Panią/Pana...") reads oddly in a staff tool; zero risk to caller-facing text. | Plan |
| Decline/stale retry | Route back to the start of that operation with fresh data | Direct reuse of the exact retry pattern the caller-facing Lambdas already implement; no new design. | Plan |

## Scope

**In scope:**
- New `lambdas/agent-appointment` Lambda (one function, three operations) + CDK registration
- Two reusable customer-managed Views (picker, confirm/message) as hand-merge guides
- Extension of S-11's `agent-handover-guide-flow` with the new interactive sequence
- `contract-surfaces.md` registration of the new Lambda/View contracts
- End-to-end manual verification of all three operations plus edge cases

**Out of scope:**
- Any new HIS entity, migration, endpoint, or `AppointmentService` change
- A separate agent application, login, or role model
- A "do another operation" loop after one action completes
- A fallback identity lookup for an unauthenticated transfer
- Any change to caller-facing appointment list caps or message strings
- Pagination on the agent's specialty/day/time pickers (not needed on a screen)

## Architecture / Approach

One Lambda mirrors the step logic of the three existing caller-facing appointment Lambdas
(`booking`, `appointment-cancel`, `appointment-reschedule`) against the same shared functions,
dispatched by an added `operation` parameter. Two generic custom Views — a parameterized picker
and a parameterized confirm/message screen — render every step across all three operations, with
per-call content set the same way S-11's Detail view already branches on `authenticated`. The
whole interactive sequence is appended to S-11's existing guide flow, since AWS restricts the
`Show view` block to Inbound-type flows — there's nowhere else in Connect's flow-type taxonomy it
could run mid-call.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Agent appointment Lambda + infra | New Lambda reusing `@pcm/appointment`, CDK-registered | Very low — direct structural mirror of three already-tested Lambdas |
| 2. Reusable agent-side Views | Picker + confirm/message custom View templates | Console-authoring effort; first customer-managed (not AWS-managed) Views in this project |
| 3. Guide flow wiring | S-11's guide flow extended with the full interactive sequence | Hand-built console flow, no automated check, most branches of any slice's flow phase |
| 4. Contract docs + verification | contract-surfaces entries + full manual matrix | Depends on Phases 1-3's console work being correctly wired before a real call can exercise it |

**Prerequisites:** S-05, S-07, S-08 (`appointment-*`) and S-11 (`agent-call-handover`), all
code-complete in `context/pending-verification/`, deployed.
**Estimated effort:** ~1 session across 4 phases — no new business logic, but the first use of
customer-managed (form-capable) Views in this project, versus S-11's read-only AWS-managed Detail
view.

## Open Risks & Assumptions

- Assumes S-05/S-07/S-08/S-11's shared functions and guide-flow mechanism behave as documented —
  all four are still in `context/pending-verification/` at the time this plan was written.
- Customer-managed Views (as opposed to the AWS-managed Detail view S-11 used) are new territory
  for this project; AWS documentation confirms the interactive-form + multi-screen pattern this
  plan relies on, but the actual console build-out is Phase 2's first real test of it.
- Contact flows are hand-built and outside IaC; Phase 3 accumulates the same "not reproducible from
  the repo alone" limitation already recorded for every prior slice's flow work.

## Success Criteria (Summary)

- An agent on an authenticated transferred call can create, cancel, or reschedule the caller's
  appointment entirely inside the Agent Workspace, with the mutation verifiable in the underlying
  data.
- An unauthenticated transfer is completely unaffected — S-11's existing placeholder screen, no
  new UI.
- Zero new HIS code; the entire feature is an interaction layer over already-tested shared logic.
