---
project: "PhoneConnect Med"
version: 1
status: draft
created: 2026-08-23
updated: 2026-08-30
prd_version: 1
main_goal: market-feedback
top_blocker: time
---

# Roadmap: PhoneConnect Med

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Medical helplines are overloaded with routine calls — booking, cancellation, opening hours —
that consume reception staff who are then unavailable for the cases needing a human. Automated
call handling is routine in banking and telecom but rare in healthcare, and the blocker is
linguistic: patients describe their needs in imprecise, colloquial language that rigid menu
trees cannot classify.

This project builds the keypad variant (**Wariant A**) and the natural-language variant
(**Wariant B**) side by side over identical business logic, and measures both. It is an
experiment, not a product launch: success means the comparison could be made and defended, not
that anyone adopted it.

## North star

**S-05: Caller books a visit by specialty and time of day, in both variants** — the one slice
that produces evidence rather than infrastructure.

> "North star" here means the smallest end-to-end slice whose successful delivery would prove
> the project worked — placed as early as its Prerequisites allow, because everything else only
> matters if this one lands. PRD §Success Criteria → Secondary says it directly: "this is where
> the hypothesis is actually tested", and FR-009's own resolution says "The measured comparison
> must run on booking." Facility information (S-01, S-02) is the *walking skeleton* — the
> thinnest end-to-end path through every component, built to prove the parts are wired together
> rather than to demonstrate anything — and the PRD is explicit that it is **not** evidence for
> the hypothesis, since a one-keypress task favours the keypad. Everything below S-05 in this
> document is upside; if the week runs short, that is what gets cut.

## At a glance

| ID | Change ID | Outcome (user can …) | Prerequisites | PRD refs | Status |
| --- | --- | --- | --- | --- | --- |
| F-01 | `aws-deployment-baseline` | (foundation) a deployed, callable path from telephony to the mock exists | — | NFR (p95 < 2s), §Non-Goals | done |
| F-02 | `call-measurement-substrate` | (foundation) every call and request emits a durable record | F-01 | FR-008, NFR (p95 < 2s), NFR (per-call record) | done |
| F-03 | `lex-keypad-capture-spike` | (foundation) in-conversation keypad capture is confirmed or refuted | F-01 | FR-005, §Access Control L2 | done |
| S-01 | `facility-info-keypad` | get address and opening hours by pressing a key, and always reach a human | F-01, F-02 | FR-009, US-02, FR-001, FR-002, FR-003, FR-006, FR-007, FR-008 | done |
| S-02 | `facility-info-speech` | get the same answer by saying what they want, no menu | S-01 | FR-009, US-01, FR-001, FR-003, FR-006, FR-008 | proposed |
| S-03 | `caller-id-authentication` | prove identity by PESEL + phone when calling from their own number | S-02, F-03 | FR-005, §Access Control L2 | proposed |
| S-04 | `otp-authentication-fallback` | prove identity by PESEL + phone plus a texted code, from any number | S-03 | FR-005, §Access Control L2 | proposed |
| S-05 | `appointment-booking-both-variants` | book a visit by specialty and time of day, choosing from offered slots | S-03 | FR-012, §Business Logic | proposed |
| S-06 | `appointment-list` | hear the list of their scheduled appointments | S-03 | FR-013 | in-progress |
| S-07 | `appointment-cancel` | cancel a scheduled appointment, releasing the slot | S-06 | FR-014 | proposed |
| S-08 | `appointment-reschedule` | move an appointment to a new slot, releasing the old one | S-05, S-07 | FR-015 | proposed |
| S-09 | `intent-accuracy-measurement` | (measurement) the project can report intent accuracy on held-out Polish speech | S-05 | NFR-14, FR-009, FR-012 | proposed |
| S-10 | `english-locale` | complete the same tasks in English, in both variants | S-05 | FR-009, FR-012, NFR (Polish primary) | proposed |
| S-11 | `agent-call-handover` | reach an agent who already has the conversation and their patient record | S-01, S-03 | FR-018, FR-019, FR-020 | proposed |
| S-12 | `agent-appointment-management` | have an agent create, cancel, or reschedule for them during the transfer | S-11, S-05, S-07, S-08 | FR-017 | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives
in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme | Chain | Note |
| --- | --- | --- | --- |
| A | Skeleton & shared logic | `F-01` → `F-02` → `S-01` → `S-02` | The rig. Nothing is measurable until this lands; `S-01` is where the shared-logic contract is set. |
| B | Identity | `F-03` → `S-03` → `S-04` | `F-03` runs parallel with Stream A; `S-03` joins after `S-02`. `S-04` is deferrable past the north star. |
| C | Appointments | `S-05` → `S-06` → `S-07` → `S-08` | Joins Stream B at `S-03`. Contains the north star; `S-06`/`S-07` are cheap breadth over shared logic. |
| D | Evidence | `S-09` → `S-10` | Joins Stream C at `S-05`. Produces the thesis's two remaining headline numbers. |
| E | Agent handover | `S-11` → `S-12` | Joins Stream A at `S-01` and Stream B at `S-03`. Lowest priority — nothing measured depends on `S-12`. |

## Baseline

What's already in place as of 2026-08-23 (auto-researched from the repo, then user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** absent, deliberately — there is no UI anywhere in this project. §Non-Goals rules
  out a separate agent application; FR-017 is a view inside the telephony platform's own agent
  workspace.
- **Backend / API:** partial — the mock medical system is scaffolded at `his/` and still returns
  the stock hello-world (`his/src/app.controller.ts:8`). `lambdas/` exists and is **empty**: the
  shared business-logic layer both variants must reach has no code yet.
- **Data:** absent — `his/package.json` carries no database driver, no ORM, no migrations, no
  seed data. The mock owns no facility, patient, doctor, or appointment data. *Recorded intent:
  persistence goes through an ORM; the specific choice is `/10x-plan`'s call, not the roadmap's.*
- **Auth:** absent — no authentication code anywhere. `tech-stack.md` declares `has_auth: true`
  as intent only.
- **Deploy / infra:** partial — a CDK app exists at `infra/` and synthesises an **empty** stack
  (`infra/lib/infra-stack.ts:5`), with no account or region bound. No Dockerfile, no CI workflow
  (§Non-Goals rules out an automated delivery pipeline). **Recorded deviation:** contact flows
  are hand-built in the telephony console by the author and deliberately **not** committed and
  **not** codified in infrastructure-as-code; every other cloud resource is CDK-only, with
  configuration and logs going to the platform's log service. No Foundation attempts to codify
  the flows.
- **Observability:** absent — no logging, metrics, or tracing dependencies. FR-008 (must-have)
  and the p95 latency NFR currently have nothing to record into.

**Non-code baseline** (from `NEXT-STEPS.md`, steps 5–11 complete): cloud account and budget
alert set up; telephony instance created and a test number claimed, with dial-in cost verified
and the claim pushed through to completion — this closes PRD Open Question 5, the only question
the PRD flagged as blocking. The corpus elicitation kit is frozen (`test-corpus-kit.md`) and
participants are recruited, but **the held-out corpus is not yet collected** — correctly, since
the measurement protocol requires collection to happen after the bot exists. Sample utterances
are authored (`lex-sample-utterances.md`). **Nothing exists in the cloud beyond the instance and
the number**: no bot, no contact flow, no deployed function.

## Foundations

### F-01: Deployable path from telephony to the mock

- **Outcome:** (foundation) a call can reach a deployed function that reaches the deployed mock
  medical system, and the whole path is described by infrastructure-as-code that can be torn
  down and recreated.
- **Change ID:** `aws-deployment-baseline`
- **PRD refs:** NFR (a caller hears the start of a response within 2 seconds at p95),
  §Non-Goals → "Automated delivery pipeline" (amended 2026-08-23: application delivery is
  by CI, infrastructure by hand)
- **Unlocks:** S-01 — nothing user-facing can be built or verified until a deployed round trip
  exists. Also establishes the verification path every later slice uses to check itself
  end-to-end, and the environment in which the "stand-in must not dominate measured latency"
  guardrail can first be tested.
- **Prerequisites:** —
- **Parallel with:** F-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced first because it is the only item with no prerequisites and everything
  depends on it. Kept deliberately minimal — one function and the mock, deployed and reachable.
  The failure mode to avoid is letting this expand into "finish the infrastructure": if it grows
  past a reachable round trip, it is eating the week that belongs to S-05.
- **Status:** done

### F-02: Per-call and per-request measurement substrate

- **Outcome:** (foundation) every call emits a record from which the path taken, the outcome and
  the duration can be reconstructed, and every request through the shared logic emits its
  latency — to a destination that can be queried later.
- **Change ID:** `call-measurement-substrate`
- **PRD refs:** FR-008 (must-have), NFR (per-call record reconstructable), NFR (p95 < 2s)
- **Unlocks:** S-01 and S-02 — both user stories carry "Request latency is recorded for this
  path" and "The per-call record notes the path taken and the outcome" as acceptance criteria,
  so neither can be accepted without this. Also the source data for two of the three comparison
  criteria (handling time, completed-interaction rate).
- **Prerequisites:** F-01
- **Parallel with:** F-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Exists as its own item, ahead of any user-facing work, because §Success Criteria →
  Primary requires latency to be recorded "from that moment on, so handling-time data
  accumulates from the first slice rather than being retrofitted at the end". Retrofitting
  measurement after the fact is the specific failure this ordering prevents — data from before
  the retrofit would not be comparable. Scope cap: an emission contract and a destination, not a
  dashboard and not a reporting layer.
- **Status:** done

### F-03: In-conversation keypad capture confirmed

- **Outcome:** (foundation) it is known, by trying it on a throwaway bot, whether the
  natural-language variant can collect keypad digits inside a conversational turn — and if it
  cannot, the fallback shape for identity capture is decided.
- **Change ID:** `lex-keypad-capture-spike`
- **PRD refs:** FR-005, §Access Control → Layer 2
- **Unlocks:** S-03 — reduces the one unknown the PRD explicitly flags as load-bearing:
  §Authentication says "Confirm the in-conversation keypad capture early; it is load-bearing."
  The whole confound-removal argument depends on it: identity is captured on the keypad in
  **both** variants precisely so that identity capture cannot explain any difference between
  them. If the natural-language variant has to bounce out to a separate input step, the two
  variants no longer capture identity identically and the authenticated half of the comparison
  is confounded for reasons unrelated to the hypothesis.
- **Prerequisites:** F-01
- **Parallel with:** F-02, S-01, S-02
- **Blockers:** —
- **Unknowns:** — closed. In-conversation keypad capture works: the throwaway bot keys eleven
  DTMF digits into a slot, reads them back, and continues into a spoken confirmation slot within
  one session id, on a real call. The fallback question (separate input step vs. re-framed
  comparison) does not arise. Four usability constraints S-03 must design around — confirmation
  decline currently disconnects instead of re-eliciting, silent identical re-asks, unexplained
  inconsistency on short DTMF entries, spoken digits not filling the slot — are recorded in
  `context/changes/lex-keypad-capture-spike/findings.md` §Constraints.
- **Risk:** A throwaway spike rather than part of S-03 because finding this out late means
  rebuilding the identity flow with the week already spent. Kept to a spike deliberately — it
  confirms a mechanism, it does not build authentication. Discard the artefact afterwards.
- **Status:** done — verdict confirmed-with-constraints, teardown complete. Archived to
  `context/archive/2026-08-26-lex-keypad-capture-spike/`, findings there.

## Slices

### S-01: Facility information by keypad

- **Outcome:** A caller presses a key on the main menu, hears the facility's address and opening
  hours, and can reach a human at any point.
- **Change ID:** `facility-info-keypad`
- **PRD refs:** FR-009, US-02, FR-001, FR-002, FR-003, FR-006, FR-007, FR-008
- **Prerequisites:** F-01, F-02
- **Parallel with:** F-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The first vertical slice, and the one that sets the contract every later slice
  inherits: the answer must come through the shared business logic from the mock, never
  hard-coded in the flow. Carries the safety behaviour (global commands, transfer to a human,
  three-attempts-then-transfer, error-to-transfer) because US-02's acceptance criteria require
  it and because every later slice reuses it rather than rebuilding it. The keypad variant is
  sequenced before the speech variant so that when the speech variant misbehaves, the rig is
  already known-good and the fault is isolated to language understanding.
- **Status:** done

### S-02: Facility information by speech

- **Outcome:** A caller says what they want in their own words and hears the same answer S-01
  produces, without being shown a menu or pressing a key.
- **Change ID:** `facility-info-speech`
- **PRD refs:** FR-009, US-01, FR-001, FR-003, FR-006, FR-008
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Completes the walking skeleton — after this, both paths are proven to reach identical
  business logic, which is the guardrail the entire comparison rests on. The answer must be
  byte-identical to S-01's; any divergence here invalidates every measurement taken afterwards.
  Note the PRD's own warning: on a one-keypress task the keypad will probably beat speech, and
  that result is expected and is explicitly not evidence against the hypothesis. Repeat-last-
  message (FR-003) costs more here than in S-01 — replaying a prompt is trivial, holding the last
  spoken message in per-call state is not — and that asymmetry is itself a small comparison
  datapoint worth recording rather than smoothing over.
- **Status:** proposed

### S-03: Authentication by matching caller ID

- **Outcome:** A caller supplies a PESEL and phone number on the keypad, in both variants, and —
  when calling from the number they declared — reaches the authenticated layer without a texted
  code.
- **Change ID:** `caller-id-authentication`
- **PRD refs:** FR-005, §Access Control → Layer 2, §Access Control → caller-ID shortcut
- **Prerequisites:** S-02, F-03
- **Parallel with:** S-11
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The caller-ID shortcut is sequenced ahead of the texted-code path (S-04), inverting
  the PRD's stated default, because it is the cheaper of the two and the demonstration scenario
  dials from a known number. This is a sequencing choice, not a scope cut — both still ship, and
  identity remains two-factor throughout, since the PESEL and phone number must still match as a
  pair. Both variants must capture identity identically or the confound F-03 exists to remove
  comes straight back. The neutral "code sent" wording and the three-attempt limit are part of
  this slice, not S-04.
- **Status:** proposed

### S-04: Authentication by texted one-time code

- **Outcome:** A caller dialling from any number reaches the authenticated layer by supplying a
  PESEL and phone number that match, then a code texted to that number.
- **Change ID:** `otp-authentication-fallback`
- **PRD refs:** FR-005, §Access Control → Layer 2
- **Prerequisites:** S-03; SMS production access granted on the account (see Blockers)
- **Parallel with:** S-05, S-06
- **Blockers:**
  - **SMS production access.** New accounts sit in the messaging sandbox: a **$1.00/month** SMS
    spend cap and sending only to **up to 10 pre-verified destination numbers**, each verified by
    a code the recipient reads back. Leaving the sandbox is a support case (Service Quotas → *SMS
    Production Access*, use case **One Time Password**), answered within about 24 hours. File it
    **before** the week this slice is built, not during it. Poland itself needs **no sender-ID
    registration** — the country table lists sender IDs as supported with no registration
    footnote, unlike the UK, Ireland or India — so this is the only messaging gate.
- **Unknowns:**
  - What does each message to a Polish mobile cost? — Owner: user. Block: no. Order of magnitude
    is cents; the sandbox's $1/month cap binds long before per-message price does.
- **Risk:** Deferred past the north star deliberately: the code is entered on the keypad in both
  variants, so it is symmetric and measures nothing. **But it is no longer merely optional.**
  S-03's caller-ID shortcut only authenticates a caller whose number already sits on a seeded
  patient record — so demonstrating the authenticated half of the system to someone who walked
  into the room (a supervisor, an examiner) requires either their mobile number in advance or
  this slice. S-04 is what makes the authenticated path demonstrable to a stranger. Still
  sequenced after S-03; no longer the second thing to drop.
- **Demo affordance — test accounts with a fixed code.** Seeded patients carry a flag; for a
  flagged patient the expected one-time code is a constant handed to testers in advance, and
  nothing is sent. Chosen over skipping the OTP stage entirely because the stage's **turn count
  and prompt sequence stay identical to the real path**, so demo sessions do not silently
  under-report the authenticated path's cost in either variant. Three constraints: the flag is
  checked in the **shared layer, never in a contact flow** (L-03); it is **data on the seeded
  record**, not a hardcoded list in a handler; and F-02's per-call record must carry **which
  auth path was taken** — caller-ID, real code, or demo — so demo sessions can be excluded from
  absolute figures. Residual limitation to state in the write-up: a tester who already knows the
  code skips the delivery wait, so demo sessions understate **elapsed** handling time. The
  A-vs-B comparison is unaffected (the stage is identical in both variants, so the offset
  cancels) and NFR-12 is unaffected (the wait is caller-side, not system response time).
  Standing rule: **demo accounts are a demo affordance, not a measurement path.** Record as a
  deliberate deviation from the source thesis when this slice is planned, alongside the
  caller-ID shortcut and the two-step slot presentation.
- **Implementation note — network position.** The handler that sends the message must **not** be
  attached to the VPC. F-01 chose `natGateways: 0` with no interface endpoints; an SMS send from
  inside that VPC would force an interface endpoint (~$7.30/mo) or a NAT gateway (~$33/mo) and
  undo that decision. Split by network need: pair verification stays VPC-attached to reach the
  mock, sending does not need the VPC at all.
- **Status:** proposed

### S-05: Booking a visit, both variants — **north star**

- **Outcome:** An authenticated caller books a visit by naming a specialty and a preferred time
  of day, is offered the next available days, picks one, is offered times within that day, and
  confirms — in both the keypad variant and the natural-language variant.
- **Change ID:** `appointment-booking-both-variants`
- **PRD refs:** FR-012, §Business Logic (inference rule and two-step slot selection)
- **Prerequisites:** S-03
- **Parallel with:** S-04, S-06
- **Blockers:** —
- **Unknowns:**
  - Does the natural-language variant reliably extract specialty and time of day from a single
    utterance, or does it usually fall back to follow-up questions? — Owner: user. Block: no —
    per FR-012's resolution, turns-to-completion is measured either way and partial extraction
    still beats a fixed four-step menu; the degree of the win becomes the finding.
- **Risk:** The heaviest slice, and deliberately so — it is the only one that produces evidence,
  and PRD §Facility information states outright that "the measured comparison must run on
  booking". Three specific hazards. First, it brings the appointment data model into the mock
  (doctors, schedules, free and taken slots) alongside two front-ends, so it carries more than
  its siblings. Second, the keypad variant's day-and-time menus have to be assembled at runtime
  from data the mock returns, and resolving "the caller pressed 2" back into an actual date must
  happen inside the shared business logic, never in the contact flow — putting that resolution
  in the flow would duplicate domain logic across the two variants and break the guardrail that
  both reach identical logic. Third, the keypad variant must stay a genuine multi-step menu:
  simplifying it to save time understates the keypad's cost and makes the comparison
  indefensible. One simplification is safe because it applies to both variants — cap the offered
  days at three and omit "press for more" paging. Measure turns-to-completion, not just elapsed
  time.
- **Status:** proposed

### S-06: Listing scheduled appointments

- **Outcome:** An authenticated caller hears the list of appointments they have scheduled.
- **Change ID:** `appointment-list`
- **PRD refs:** FR-013
- **Prerequisites:** S-03
- **Parallel with:** S-04, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Cheap breadth. Because the business logic is shared, the marginal cost is one
  operation plus one menu branch plus one intent. Sequenced after the north star rather than
  before it, even though it is smaller, because it produces no evidence — under a
  validation-first bias, small and evidence-free loses to large and evidence-bearing. Listed as
  parallel with S-05 so it can be picked up independently if S-05 stalls on something external.
- **Status:** in-progress

### S-07: Cancelling an appointment

- **Outcome:** An authenticated caller cancels one of their scheduled appointments, and the slot
  becomes available again.
- **Change ID:** `appointment-cancel`
- **PRD refs:** FR-014
- **Prerequisites:** S-06
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Depends on S-06 rather than only on S-03 because the caller has to identify *which*
  appointment, and hearing the list is how they do it. Kept in scope for the same marginal-cost
  reason as S-06, and because it is a MUST in the source thesis — dropping it without
  justification invites a question at the defence.
- **Status:** proposed

### S-08: Rescheduling an appointment

- **Outcome:** An authenticated caller moves an existing appointment to a new slot, releasing the
  old one.
- **Change ID:** `appointment-reschedule`
- **PRD refs:** FR-015
- **Prerequisites:** S-05, S-07
- **Parallel with:** S-09, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Structurally cancel-then-book, so it depends on both and is nearly free once they
  exist. The PRD names it the cheapest of the four appointment operations to omit if the week
  runs short. Sequenced here rather than dropped because its marginal cost is genuinely small —
  but it is a legitimate cut.
- **Status:** proposed

### S-09: Intent-accuracy measurement run

- **Outcome:** The held-out Polish corpus is collected from participants who have never seen the
  system, scored against the bot, and reported as accuracy with a per-intent breakdown and the
  fallback rate.
- **Change ID:** `intent-accuracy-measurement`
- **PRD refs:** NFR-14, FR-009, FR-012
- **Prerequisites:** S-05
- **Parallel with:** S-08, S-10
- **Blockers:** Participant availability — roughly five people have to be scheduled and run
  through the frozen elicitation script.
- **Unknowns:**
  - What is the keypad variant's analogue for intent-recognition accuracy? — Owner: user.
    Block: no. (PRD Open Question 2; the natural-language number can be produced without it, but
    one of the three headline comparisons stays undefined until it is answered. Most defensible
    answer: task completion plus misnavigation rate over the same scenario set.)
- **Risk:** This is a measurement slice, not a capability slice — it ships a scoring harness and
  a number rather than something a caller experiences. It is in the roadmap because it produces
  a thesis headline figure and involves real work (corpus format, scoring, per-intent reporting),
  and because forgetting it until the end is the classic way a measured comparison ends up
  unmeasured. Sequenced after S-05 because the measurement protocol requires the corpus to be
  collected **after** the bot is built — collecting first risks the author writing sample
  utterances that cover exactly the test phrasings, which is training on the test set and cannot
  be disproved afterwards. No utterance in the corpus may appear as a sample utterance. State
  the convenience-sample limitation in the write-up: five acquaintances skew younger and more
  technical than real callers, which makes the measured accuracy optimistic.
- **Status:** proposed

### S-10: English locale

- **Outcome:** A caller completes the facility-information and booking tasks in English, in both
  variants, over unchanged shared business logic.
- **Change ID:** `english-locale`
- **PRD refs:** FR-009, FR-012, NFR (conversation in Polish; English secondary),
  §Success Criteria → Secondary
- **Prerequisites:** S-05
- **Parallel with:** S-08, S-09
- **Blockers:** —
- **Unknowns:**
  - What is counted, exactly, to express the multilingualism comparison? — Owner: user.
    Block: no. (PRD Open Question 3. Without a stated count — menu blocks and prompts duplicated
    for the keypad variant versus language artefacts added for the natural-language variant,
    with the shared logic shown unchanged — this slice produces an anecdote rather than a
    finding. Decide the counting rule before building, so the count is recorded as the work
    happens rather than reconstructed afterwards.)
- **Risk:** The evidence here is the *implementation cost*, not the accuracy — this slice exists
  to demonstrate that the keypad variant needs a duplicated menu tree while the natural-language
  variant needs only an added locale over unchanged business logic. That means the shared logic
  must genuinely not change, and if it does, the finding evaporates. Sequenced after S-05 so
  that booking — the task where the duplication cost is largest — is included in the count.
- **Status:** proposed

### S-11: Agent receives the transferred call with context

- **Outcome:** A caller transferred to a human reaches an agent who already has the conversation
  so far and the caller's patient record on screen, and who can pass the call onward.
- **Change ID:** `agent-call-handover`
- **PRD refs:** FR-018, FR-019, FR-020
- **Prerequisites:** S-01, S-03
- **Parallel with:** S-05, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Mostly configuration rather than construction — the queue is self-staffed for the
  demonstration, and the agent works in the platform's stock desktop, so no custom agent
  application or second login exists. Depends on S-03 because the patient record only exists once
  identity has been established. Generates no comparison data, so it sits below the north star
  despite being cheap.
- **Status:** proposed

### S-12: Agent manages appointments during the transfer

- **Outcome:** A caller who reached a human has their appointment created, cancelled or
  rescheduled by that agent during the same call.
- **Change ID:** `agent-appointment-management`
- **PRD refs:** FR-017
- **Prerequisites:** S-11, S-05, S-07, S-08
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Last, and the PRD says so plainly: this is the first thing to drop if the week runs
  short, because nothing measured depends on it. The scope cap is the point — a view inside the
  agent workspace during a transferred call, backed by the same shared business logic, with no
  separate application, no styling budget, and no agent workflow beyond the three operations.
  This is the one place in the project where an afternoon can quietly become interface work.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID | Suggested issue title | Ready for `/10x-plan` | Notes |
| --- | --- | --- | --- | --- |
| F-01 | `aws-deployment-baseline` | Deployable path from telephony to the mock medical system | yes | Run `/10x-plan aws-deployment-baseline` |
| F-02 | `call-measurement-substrate` | Per-call records and per-request latency emission | no | After F-01 |
| F-03 | `lex-keypad-capture-spike` | Spike: in-conversation keypad capture in the natural-language variant | no | After F-01; parallel with F-02 and S-01 |
| S-01 | `facility-info-keypad` | Facility information by keypad, with the safety fallbacks | no | After F-01, F-02 |
| S-02 | `facility-info-speech` | Facility information by speech, identical answer | no | After S-01 |
| S-03 | `caller-id-authentication` | Authentication by PESEL + phone with caller-ID match | no | After S-02, F-03 |
| S-04 | `otp-authentication-fallback` | Authentication fallback by texted one-time code | no | After S-03; deferrable |
| S-05 | `appointment-booking-both-variants` | Book a visit by specialty and time of day, both variants | no | **North star.** After S-03 |
| S-06 | `appointment-list` | Hear scheduled appointments | no | After S-03; parallel with S-05 |
| S-07 | `appointment-cancel` | Cancel a scheduled appointment | no | After S-06 |
| S-08 | `appointment-reschedule` | Reschedule an appointment | no | After S-05, S-07; legitimate cut |
| S-09 | `intent-accuracy-measurement` | Collect and score the held-out Polish intent corpus | no | After S-05; recruit participants ahead of time |
| S-10 | `english-locale` | English locale over unchanged shared business logic | no | After S-05; settle the counting rule first (Question 2) |
| S-11 | `agent-call-handover` | Transferred call carries conversation context and patient record | no | After S-01, S-03; mostly configuration |
| S-12 | `agent-appointment-management` | Agent appointment view during a transferred call | no | After S-11 and the appointment slices; first to drop |

## Open Roadmap Questions

1. **What is the keypad variant's analogue for intent-recognition accuracy?** — Owner: user.
   Block: S-09 reports only two of the three headline comparisons until this is answered. The
   natural-language variant has intent recognition to be accurate about; a keypad menu does not.
   Handling time and completed-interaction rate are directly comparable; the third needs an
   explicit definition — most defensibly task completion plus misnavigation rate over the same
   scenario set. (PRD Open Question 2.)
2. **What exactly is counted to express the multilingualism comparison?** — Owner: user.
   Block: S-10 produces an anecdote rather than a finding without it. Decide the counting rule
   *before* building S-10 so the count is recorded as the work happens.
   (PRD Open Question 3.)
3. **How are the recorded deviations from the source thesis reconciled in the write-up?** —
   Owner: user. Block: roadmap-wide for the defence, nothing for the build. The caller-ID
   authentication shortcut and the two-step slot presentation both depart from chapter 3. Either
   amend the chapter, or frame the proof of concept as implementing a representative subset.
   A third deviation now joins them: contact flows are hand-built and not codified in
   infrastructure-as-code, so the deployed system is only partly reproducible from the
   repository. (PRD Open Question 6, extended.)
4. **What is the thesis submission date?** — Owner: user. Block: nothing directly, but with
   `top_blocker: time` this roadmap's cut line (everything below S-05) cannot be turned into a
   real decision until there is a date to work backward from. (PRD Open Question 1.)
5. **What are the throughput and data-volume ballparks?** — Owner: user. Block: nothing. Absent
   figures, the p95 latency requirement describes the system as built and exercised, not under
   production load — which needs stating in the write-up. (PRD Open Question 4.)

> PRD Open Question 5 — whether the test number is obtainable and what dialling it costs — was
> the only question the PRD flagged as blocking. `NEXT-STEPS.md` steps 6, 6a and 6b record it as
> resolved: the number is claimed and the dial-in cost checked. It is therefore not carried
> forward here.

## Parked

- **Real medical-system integration.** Why parked: PRD §Non-Goals. The mock *is* the central
  medical system for the entire experiment; the source thesis sanctions this for a proof of
  concept.
- **A separate agent application.** Why parked: PRD §Non-Goals. No standalone web application,
  no second login, no roles, no audit trail of its own. Agents work inside the telephony
  platform's own workspace, which already authenticates them.
- **Standalone appointment management for agents.** Why parked: PRD §Non-Goals. S-12 covers
  management *during a transferred call*, which is the only moment this experiment exercises.
- **Cross-call caller memory.** Why parked: PRD §Non-Goals. Sessions are per-call; a caller who
  rings back re-authenticates.
- **Agent workflow beyond the three operations.** Why parked: PRD §Non-Goals.
- **Security and compliance implementation.** Why parked: PRD §Non-Goals. No encryption-at-rest
  work, no data-protection conformance, no retention or auto-deletion, no access-policy
  hardening beyond platform defaults. Named in the thesis as directions for further development.
- **Scale and availability demonstration.** Why parked: PRD §Non-Goals. No load testing, no
  capacity increases. The p95 latency figure is the only performance number this project
  produces.
- ~~**Automated delivery pipeline.**~~ **Unparked 2026-08-23**, built in F-01
  (`aws-deployment-baseline`). PRD §Non-Goals ruled it out while `tech-stack.md` already
  declared GitHub Actions with auto-deploy-on-merge; the PRD entry has been amended. A push
  to `main` touching the stand-in system rebuilds and restarts it. Infrastructure is still
  deployed by hand.
- **Contact flows as infrastructure-as-code.** Why parked: author's decision, recorded in
  §Baseline. Flows are hand-built in the console and not committed. Consequence to accept
  knowingly: this work does not accumulate as reviewable code and must be rebuilt by hand if the
  telephony instance is ever recreated. Feeds Open Roadmap Question 3.
- **"Press for more" paging beyond three offered days.** Why parked: scope control on S-05. Safe
  to omit *only* because it is omitted in both variants identically, so it cannot confound the
  comparison.
- **A production-appropriate local phone number.** Why parked: a test number was claimed as a
  de-risking move. Explicitly **not** a non-goal — if a local number turns out to be obtainable
  in time, nothing in the call flow, the language understanding, or the measurement changes.

## Done

(Empty on first generation. `/10x-archive` appends here when a change whose Change ID matches a
roadmap item is archived.)

- **F-01: (foundation) a call can reach a deployed function that reaches the deployed mock medical system, and the whole path is described by infrastructure-as-code that can be torn down and recreated.** — Archived 2026-08-29 → `context/archive/2026-08-23-aws-deployment-baseline/`. Lesson: —.
- **F-02: (foundation) every call emits a record from which the path taken, the outcome and the duration can be reconstructed, and every request through the shared logic emits its latency — to a destination that can be queried later.** — Archived 2026-08-29 → `context/archive/2026-08-23-call-measurement-substrate/`. Lesson: —.
- **S-01: A caller presses a key on the main menu, hears the facility's address and opening hours, and can reach a human at any point.** — Archived 2026-08-30 → `context/archive/2026-08-29-facility-info-keypad/`. Lesson: —.
- **F-03: (foundation) it is known, by trying it on a throwaway bot, whether the natural-language variant can collect keypad digits inside a conversational turn — and if it cannot, the fallback shape for identity capture is decided.** — Archived 2026-08-30 → `context/archive/2026-08-26-lex-keypad-capture-spike/`. Lesson: —.
