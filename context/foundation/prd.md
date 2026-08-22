---
project: "PhoneConnect Med"
version: 1
status: draft
created: 2026-08-20
context_type: greenfield
product_type: "other — voice/telephony self-service application reached over the phone"
target_scale:
  users: small
timeline_budget:
  mvp_weeks: 1
  hard_deadline: null
  after_hours_only: true
---

# PRD — PhoneConnect Med

> Two variants are compared throughout this document. **Wariant A** is the keypad-menu
> variant: the caller listens to a menu and presses keys. **Wariant B** is the
> natural-language variant: the caller says what they want in their own words. Both reach
> the same shared business logic and differ only in how input is collected.

## Vision & Problem Statement

Medical helplines are the primary contact channel between patients and przychodnie, and the
most overloaded one. Patients calling to book or cancel a visit, or to ask a basic question
about the facility, face long queue times and a high rate of unanswered and abandoned calls.
Most of that call volume is routine — booking, cancellation, opening hours — which consumes
rejestracja staff who are consequently unavailable for the complex cases that genuinely need
a human. The cost today is delayed service delivery and falling patient satisfaction.

The insight: automated call handling is routine in banking, retail, and telecom, yet rare in
healthcare, and the blocker is linguistic rather than technical. Patients describe their
needs in imprecise, colloquial, ambiguous language that rigid predefined menu trees cannot
classify. Natural-language understanding is the first mechanism that can absorb that
imprecision — which is precisely the claim this project exists to test, by building the
classical and the natural-language approach side by side and measuring both.

> **Framing note — this is an experiment, not a product launch.** Success is a verified or
> refuted research hypothesis backed by defensible measurements. Adoption, UX polish, and
> production-readiness are explicitly out of frame. This decision is load-bearing for
> Success Criteria below: the criteria describe a *measurement protocol*, not product
> outcomes.

## User & Persona

**Primary persona — Pacjent.** An adult patient of a przychodnia who reaches for the phone
because it is the channel they know. They call to book a visit with a specialist, check or
cancel an appointment they already have, or ask something basic about the facility. They do
not know the helpline's menu structure, they do not want to learn it, and they describe what
they need in their own words. They are identified in the medical system by PESEL and a phone
number.

Every measured outcome in this project — intent-recognition accuracy, handling time,
completed-interaction rate — is measured on this persona's interaction with the system.

### Secondary persona — Agent / rejestracja

Receives calls the automated system cannot complete, along with the conversation context
gathered so far. Beneficiary of the deflection rather than the subject of the measurement.
The agent-facing surface is supporting infrastructure for the experiment, not the product
being evaluated.

## Success Criteria

Framed as a measurement protocol, per the decision that this is an experiment rather than a
product launch. "The product worked" means "the comparison could be made and defended".

### Primary

- A caller dials the number and completes the **facility-information task end-to-end in both
  variants** — keypad menu and free speech — arriving at the same answer through the same
  shared business logic. This is the walking skeleton: it proves telephony, language
  understanding, the shared business logic, and the stand-in scheduling application are wired
  correctly on both paths.
- Per-request latency is recorded on both paths from that moment on, so handling-time data
  accumulates from the first slice rather than being retrofitted at the end.

### Secondary

- Booking a visit works end-to-end in both variants — this is where the hypothesis is
  actually tested, since one utterance ("do kardiologa na przyszły tydzień rano") replaces
  four keypad steps.
- Intent-recognition accuracy measured at ≥ 85% on a held-out Polish corpus (NFR-14), sourced
  by asking roughly five people unfamiliar with the system how they would phrase each task,
  targeting ~80–100 utterances labelled with the task they were elicited for. Accuracy is
  reported as correctly-classified over total, with a per-intent breakdown and the fallback
  rate, so a single dominant intent cannot carry the headline figure.
- English locale added, demonstrating the claim that a keypad variant needs a duplicated menu
  tree while a natural-language variant needs only an added locale over unchanged business
  logic.

### Guardrails

- **Both variants must reach identical business logic.** Any divergence in the shared logic
  invalidates the A-vs-B comparison — the variants may differ only in how input is collected.
- **Train/test separation.** Intent accuracy must not be measured on utterances used to build
  the system's language understanding. Measuring on training data would make the headline
  number meaningless.
- **The stand-in scheduling application must not dominate measured latency.** It sits inside
  the measured request path; if it is slow, the p95 figure describes the stand-in rather than
  the system.
- **A caller must always be able to reach a human.** The 3-attempts-then-transfer rule and
  the component-failure transfer are safety behaviour, not features — a caller stuck in a
  loop with no path to an agent is a failure even if every metric looks good.
- **The convenience sample is a stated limitation.** Five acquaintances skew younger and more
  technical than a real patient population, which if anything makes measured accuracy
  optimistic. This must be stated in the write-up rather than left for a reviewer to find.

## User Stories

### US-01: Caller obtains facility information by speaking (Wariant B — natural language)

- **Given** a caller connected to the helpline who has not authenticated
- **When** they say what they want in their own words, e.g. „jakie są godziny otwarcia"
- **Then** the system recognises the intent without any menu navigation and speaks the answer

#### Acceptance Criteria
- The caller reaches the answer without being presented a menu or pressing a key
- The answer is retrieved through the shared business logic from the stand-in scheduling
  application, not hard-coded in the language-understanding layer
- Request latency is recorded for this path
- After three unrecognised utterances the call transfers to an agent (FR-006)
- The per-call record notes the path taken and the outcome (FR-008)

### US-02: Caller obtains facility information by keypad (Wariant A — keypad menu)

- **Given** a caller connected to the helpline who has not authenticated
- **When** they listen to the main menu and press the key for facility information
- **Then** the system speaks the same answer US-01 produces

#### Acceptance Criteria
- The answer is byte-identical to US-01's, retrieved through the same shared business logic
- Request latency is recorded for this path, separately from US-01's
- Total handling time — including prompt playback — is measurable for comparison against
  US-01
- After three invalid keypresses or input timeouts the call transfers to an agent (FR-006)
- The per-call record notes the path taken and the outcome (FR-008)

## Functional Requirements

FR identifiers are carried over from the thesis (Tabela 2.5–2.8) rather than renumbered from
001, so every requirement traces back to the source document. Gaps in the sequence are the
requirements cut in scoping.

> **Reading `nice-to-have` correctly.** MVP is scoped to the one-week walking skeleton, so
> `nice-to-have` here means **deferred past the first milestone**, NOT "may never be built".
> Booking, authentication, and the appointment operations are required for the thesis to
> defend its hypothesis — they are deliberately absent from `## Non-Goals` for this reason.

### Call handling

- FR-001: Pacjent can issue a global command (transfer to agent, repeat) at any point and have it honoured regardless of dialogue stage. Priority: must-have
  > Socratic: "Global commands add branching to every dialogue state for a rarely-used feature."
  > Resolution: kept. It is the mechanism behind the safety guardrail — a caller must always be
  > able to reach a human — so its cost is the price of the guardrail, not of a feature.
- FR-002: Pacjent can request transfer to a human agent and be routed to a queue. Priority: must-have
  > Socratic: "In a PoC with no staffed call centre, what does transfer even mean?"
  > Resolution: a real agent queue, self-staffed when demonstrating. For measurement, every
  > transfer counts as a FAILED automated interaction and feeds completion rate directly.
- FR-003: Pacjent can ask for the last spoken message to be repeated. Priority: nice-to-have
  > Socratic: "In Wariant B a caller can simply re-ask; repeat duplicates that."
  > Resolution: kept as nice-to-have. Trivial in Wariant A (replay the prompt), but in Wariant B
  > it requires holding the last message in per-call state — so the cost is asymmetric, which is
  > itself a small comparison datapoint.
- FR-006: System transfers the call to an agent after three failed attempts to interpret the caller. Priority: must-have
  > Socratic: "Is three the right number — and does it differ between variants?"
  > Resolution: kept at three, identical in both variants so the threshold cannot confound the
  > comparison. Each exhaustion is recorded as a failed automated interaction.
- FR-007: System transfers the call to an agent when an unhandled error occurs, without dropping the call. Priority: must-have
  > Socratic: "A blanket error-to-agent rule hides bugs during development."
  > Resolution: kept — it is guardrail behaviour, not a feature. FR-008's call records preserve
  > the diagnostic trail, so failures stay visible without the caller paying for them.
- FR-008: System records per-call flow information (path taken, outcome, duration) for later analysis. Priority: must-have
  > Socratic: "The thesis marks this SHOULD, so why is it binding?"
  > Resolution: promoted. Handling time and completed-interaction rate — two of the three
  > comparison criteria — are computed from this data. It stops being optional the moment the
  > thesis depends on it.

### Facility information

- FR-009: Pacjent can obtain basic facility information — address and opening hours. Priority: must-have
  > Socratic: "For a task this trivial the keypad will likely BEAT natural language — one
  > keypress versus speaking plus the time taken to understand it. Measuring only this could
  > refute the hypothesis."
  > Resolution: FR-009 is the walking skeleton and is explicitly NOT evidence for the hypothesis.
  > The measured comparison must run on booking, where multi-parameter free speech competes
  > against four sequential keypad steps. This makes FR-012 non-deferrable in practice despite
  > its nice-to-have priority.

### Authentication

- FR-005: Pacjent can authenticate by supplying a PESEL and phone number that match as a pair, confirmed by a one-time code or by a matching caller ID. Priority: nice-to-have
  > Socratic: "Recognising a spoken 11-digit PESEL in Polish may be unreliable enough to sink
  > Wariant B's authenticated branch for reasons unrelated to intent recognition."
  > Resolution: PESEL is collected on the keypad in BOTH variants. In Wariant B the keypad
  > capture stays inside the same conversational turn rather than bouncing out to a separate
  > input step. Both variants therefore capture identity identically and differ only in intent
  > recognition and remaining parameter collection — removing a confound rather than adding one.
  > Confirm the in-conversation keypad capture early; it is load-bearing.

### Appointments

- FR-012: Authenticated pacjent can book a visit by specialisation and preferred time of day, choosing from offered slots. Priority: nice-to-have
  > Socratic: "The one-utterance advantage only holds if specialisation AND time-of-day are
  > reliably extracted together. If the system usually asks follow-ups, Wariant B collapses
  > toward Wariant A's turn count."
  > Resolution: measure **turns-to-completion** alongside elapsed time. This tests the actual
  > claim and stays informative even when parameter extraction underperforms — partial
  > extraction still beats a fixed four-step menu, and the degree of the win becomes the finding.
- FR-013: Authenticated pacjent can hear the list of their scheduled appointments. Priority: nice-to-have
  > Socratic: "A read-only list carries little comparison evidence."
  > Resolution: kept. Marginal cost is one business-logic operation plus one menu branch plus
  > one intent, since the business-logic layer is shared. Breadth is cheap here; the first path
  > through each variant is what is expensive.
- FR-014: Authenticated pacjent can cancel a scheduled appointment, releasing the slot. Priority: nice-to-have
  > Socratic: "Cancel repeats booking's interaction shape and adds no new evidence."
  > Resolution: kept for the same marginal-cost reason as FR-013, and because a MUST in the
  > thesis dropped without justification invites a question at defence.
- FR-015: Authenticated pacjent can reschedule an appointment to a new slot, releasing the old one. Priority: nice-to-have
  > Socratic: "Reschedule is cancel plus book — pure redundancy."
  > Resolution: kept as nice-to-have; it is SHOULD in the thesis and the cheapest of the four
  > appointment operations to omit if the week runs short.

### Agent handover

- FR-017: Agent can create, cancel, and reschedule a patient's appointments from within the agent workspace. Priority: nice-to-have
  > Socratic: "This is the only FR with no telephony path at all — it generates zero A-vs-B
  > comparison data, and it is the one place the week could quietly disappear into UI work."
  > Resolution: kept, and the UI-work risk is removed by not building a UI. The capability lives
  > as a view inside the agent workspace, driven by the call flow and backed by the same shared
  > business logic the two variants use. No separate application, no styling budget, no agent
  > workflow beyond the three operations. Constraint accepted deliberately: because the view is
  > part of a contact, appointment management is available to an agent **during a transferred
  > call**, not standalone. That covers the handover moment FR-018 and FR-020 describe, which is
  > the only moment this experiment exercises. If the week runs short this is still the first
  > thing to drop, since nothing measured depends on it.
- FR-018: Agent receives a transferred call together with the conversation context gathered so far. Priority: nice-to-have
  > Socratic: "Unobservable without a staffed queue."
  > Resolution: the queue exists and is self-staffed for demonstration. Context travels with the
  > transferred call and is displayed in the agent's stock desktop — so this is configuration
  > rather than construction.
- FR-019: Agent can transfer the call onward to another agent or queue. Priority: nice-to-have
  > Socratic: "Stock platform functionality — is it a requirement at all?"
  > Resolution: kept as nice-to-have precisely because it is stock. It costs configuration only,
  > and recording it keeps traceability to Tabela 2.8.
- FR-020: Agent can see the patient's data for the transferred call. Priority: nice-to-have
  > Socratic: "Duplicates FR-018 — both amount to 'the agent sees the context that came with the
  > call'."
  > Resolution: kept separate because they carry different data: FR-018 is conversation history,
  > FR-020 is patient identity from the medical system. Same mechanism, different payload.

## Non-Functional Requirements

Stated as properties observable at the system's outer boundary, without naming mechanism.

- A caller hears the start of a spoken response within **2 seconds** of finishing their input,
  at the 95th percentile. (NFR-12; the headline latency figure.)
- The system correctly identifies the caller's intended operation in at least **85%** of spoken
  requests drawn from a set that was not used to build its language understanding. (NFR-14;
  the train/test separation is part of the requirement, not an implementation detail.)
- A caller who cannot be understood reaches a human being after **no more than three** failed
  attempts, on every path through the system.
- Every call — completed or abandoned — yields a record from which the path taken, the outcome,
  and the duration can be reconstructed.
- Identity is never confirmed on a single factor: a caller must supply a PESEL and a phone
  number that match one another before any personal data is disclosed.
- The system does not reveal whether supplied identity data corresponds to a real patient,
  regardless of whether it does.
- The conversation is conducted in Polish. English is a secondary target and is not required
  for the primary measurements.

> Deliberately absent: availability, concurrent-call capacity, encryption, regulatory
> compliance, retention, and automated delivery pipeline. These are real requirements in the
> thesis (NFR-3, 5–11, 13, 15–17) but are named as directions for further development, not
> verified here. See `## Non-Goals`.

## Business Logic

**The system infers from a caller's everyday speech both what operation they want and the
parameters that operation needs, and for a booking request offers available appointments
matching the specialisation, day, and time of day it inferred.**

The rule consumes what the caller supplies in their own words or keypresses — a request that
may be complete ("do kardiologa we wtorek rano"), partial ("chcę umówić wizytę"), or ambiguous.
Its output is a recognised operation together with whatever parameters could be extracted, and
an explicit account of what is still missing. The caller encounters the rule as the difference
between being asked for everything and being asked only for what they did not already say.

Appointment selection is two-step. The caller's specialisation and time-of-day preference
filter the available slots; the system then offers the next available **days**, the caller
chooses one, and the system offers times within that day. Paging moves forward by days rather
than by minutes, so a caller is never read a dozen consecutive quarter-hour slots on the same
morning.

**Deviation from the thesis's §3.2.1, recorded deliberately.** The thesis describes reading out
"trzy najbliższe dostępne terminy" directly. Two-step selection replaces that because the
literal rule is unusable over voice when a doctor has many same-day openings. The change
applies identically to both variants, so it cannot confound the comparison — and it is
asymmetric in a way that favours the hypothesis rather than obscuring it: Wariant A must always
walk both steps, whereas a Wariant B caller who names the day in their opening utterance skips
the day-selection turn entirely. This widens the measured turns-to-completion gap in the
direction the hypothesis predicts, which is a point to state openly rather than let a reviewer
find.

## Access Control

Three access layers. The layer boundary is the same in both variants; only the data-collection
mechanism differs (keypad vs speech).

**Layer 1 — Global (no authentication).** Available at any point in a call: main menu, facility
information, repeat last message, transfer to agent, and fallback handling. A caller who never
authenticates can still reach facility info and a human.

**Layer 2 — Authentication.** Identity is a **PESEL + phone number pair**, verified together
against the medical system — neither alone is sufficient. On a successful pair match the system
sends a one-time code to the caller's phone as a text message and validates it. The "code sent"
message is deliberately neutral and must not reveal whether the supplied data exists in the
system. Maximum 3 attempts at each stage; exhausting them transfers the call to an agent.

**Caller-ID shortcut (deliberate deviation from the thesis's §3).** When the calling number
matches the phone number the patient declares, authentication completes without sending a
one-time code. This is not described in chapter 3. It is kept because it reduces caller
friction and applies identically to both variants, so it cannot confound the A-vs-B comparison.
It must be reconciled in the write-up — either by amending §3.2.1/§3.2.2, or by framing the PoC
as implementing a representative subset rather than the complete designed system.

**Layer 3 — Authenticated.** Booking, listing, rescheduling, cancelling appointments, and
reading patient data. Reachable only after Layer 2 succeeds.

**Session lifetime.** Per-call only. Authentication does not survive the end of a call; a caller
who rings back re-authenticates. There is no cross-call session to invalidate.

**Agent access to calls.** Agents sign in to the telephony platform and work in its stock agent
desktop; transferred calls carry the conversation context with them. No custom agent
authentication is built.

**Agent access to appointments.** The stand-in medical system is headless. It owns the
appointment data (doctors, their rosters/*grafiki*, slots, taken vs free) and answers the
shared business logic; it presents no interface of its own and is never reached directly by a
person.

Agents create, cancel, and reschedule appointments (FR-017) through a view rendered inside the
agent workspace during a transferred call, backed by the same shared business logic the two
variants use. This keeps agent access inside the platform's own authentication boundary — an
agent is already signed in to work a call — so no separate application and no second login
exist. It also means these operations are available **during a call**, not standalone; that is
sufficient, because the transferred call is the only moment this experiment puts an agent in
front of a patient's appointments.

## Non-Goals

Ruled out deliberately, so they cannot creep back into a one-week build.

**Functional non-goals**

- **Real medical-system integration.** No private network link to an actual hospital system, no
  conformance to healthcare data-interchange standards. The scheduling application *is* the
  central medical system for the entire experiment; the thesis already sanctions this for the
  PoC.
- **A separate agent application.** No standalone web application for reception staff, and
  therefore no second login, no roles, and no audit trail of its own. Agents work entirely
  inside the agent workspace, which already authenticates them. The stand-in medical system is
  headless and has no interface a person reaches.
- **Standalone appointment management.** Agents manage appointments during a transferred call,
  not from an idle state. Out of scope because the transferred call is the only moment this
  experiment exercises.
- **Cross-call caller memory.** No recognition of a returning caller, no state carried between
  calls.
- **Agent workflow beyond three operations.** The agent view does create, cancel, and
  reschedule. Nothing else.

**Non-functional non-goals**

- **Security and compliance implementation.** No encryption-at-rest work, no RODO/GDPR or HIPAA
  conformance, no retention or auto-deletion, no access-policy hardening beyond platform
  defaults. Named in the thesis as directions for further development, not verified here.
- **Scale and availability demonstration.** No load testing, no capacity-limit increases, no
  1000-concurrent or 99.9% demonstration. Argued from the platform provider's published model;
  the p95 latency figure is the only performance number this project actually produces.
- **Automated delivery pipeline.** Not required for a single-author, one-week experiment.

**Not ruled out:** using a production-appropriate local phone number. A convenience test number
was selected as a de-risking move because a local number requires regulatory documentation and
non-instant approval, but a local number is deliberately *not* declared a non-goal — if it turns
out to be obtainable in time, nothing in the call flow, the language understanding, or the
measurement would change.

## Open Questions

1. **What is the thesis submission date?** — Owner: user. Recorded as a hard deadline with no
   date attached, so `timeline_budget.hard_deadline` is `null`. Downstream planning cannot work
   backward from it until the date is filled in. Block: no.
2. **What is Wariant A's analogue for intent-recognition accuracy?** — Owner: user. NFR-14 is
   meaningful for the natural-language variant, but a keypad menu has no intent recognition to
   be accurate about. Two of the three comparison criteria (handling time,
   completed-interaction rate) are directly comparable; the third needs an explicit definition
   for Wariant A — most defensibly task-completion and misnavigation rate over the same scenario
   set. Block: no, but unresolved it leaves one of three headline comparisons undefined.
3. **What metric expresses the multilingualism comparison?** — Owner: user. English is in scope
   to demonstrate that a keypad variant needs a duplicated menu tree while a natural-language
   variant needs only an added locale. Without a stated count — menu blocks and prompts
   duplicated versus language artefacts added, with the shared business logic shown unchanged —
   it stays an anecdote. Block: no.
4. **What are the `target_scale` throughput and data-volume ballparks?** — Owner: user. The
   input states `users: small` only. Absent figures, the p95 latency requirement describes the
   system as built and exercised, not under production load. Block: no.
5. **Is the claimed test number actually obtainable, and what does dialling it cost from the
   testing location?** — Owner: user. By: before building against that number. Two checks are
   outstanding: (a) dial-in cost falls on a personal phone bill, not on platform credits, and at
   a few hundred test calls this is the difference between free and meaningfully expensive;
   (b) availability in a provider console is not the same as a completed claim — many countries
   require proof of a local address or a registered entity. Fallback if per-minute cost bites:
   have the platform place **outbound** calls to the tester's phone instead. Not preferred — the
   thesis measures an inbound helpline, and outbound call flows differ enough to muddy the
   comparison. Block: yes for the telephony slice.
6. **How are the two recorded deviations from the thesis reconciled in the write-up?** — Owner:
   user. The caller-ID authentication shortcut (`## Access Control`) and the two-step slot
   presentation (`## Business Logic`) both depart from chapter 3. Either amend §3.2.1/§3.2.2, or
   frame the PoC as implementing a representative subset of the designed system. Block: no for
   the build; yes for the defence.
