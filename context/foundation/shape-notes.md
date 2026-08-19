---
project: "PhoneConnect Med"
context_type: greenfield
created: 2026-08-18
updated: 2026-08-18
product_type: other
product_type_note: "CCaaS voice/telephony application — Amazon Connect fronting a DTMF variant and a Lex V2 variant over a shared Lambda layer"
target_scale:
  users: small
timeline_budget:
  mvp_weeks: 1
  hard_deadline: "thesis submission — date TBD"
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "primary persona"
      decision: "Pacjent (the caller); rejestracja staff are beneficiaries, not the primary"
    - topic: "core insight"
      decision: "NLU removes the language blocker that stalled healthcare call automation"
    - topic: "success frame"
      decision: "Thesis experiment — success is a verified/refuted hypothesis with defensible measurements, not adoption or production-readiness"
    - topic: "caller-ID OTP shortcut"
      decision: "Kept as a deliberate deviation from §3; applies to both variants so it cannot confound A-vs-B; must be reconciled in the write-up"
    - topic: "agent access"
      decision: "Stock Amazon Connect Agent Workspace for calls; appointment management via the scheduling app's web view (unauthenticated in PoC)"
    - topic: "HIS mock surface"
      decision: "API + datastore + a web view with write access for the agent; FR-017 is IN scope"
    - topic: "session lifetime"
      decision: "Per-call only; no cross-call session state"
    - topic: "first vertical slice"
      decision: "Facility info, end-to-end through both variants, with CloudWatch measuring from day one"
    - topic: "week-1 scope"
      decision: "Amazon Connect included in week 1; both variants genuinely telephonic"
    - topic: "telephony de-risking"
      decision: "Claim whichever test number is quickest to obtain and cheapest to dial from the testing location; write-up notes production would use a local number"
    - topic: "FR-008 priority"
      decision: "Promoted from SHOULD to must-have; handling time and completion rate are computed from it"
    - topic: "MVP boundary"
      decision: "MVP = one-week walking skeleton (facility info, both variants). nice-to-have means deferred past milestone 1, not dropped"
    - topic: "domain rule"
      decision: "Interpretation AND selection stated as one rule: infer operation + parameters from everyday speech; offer appointments matching what was inferred"
    - topic: "slot presentation"
      decision: "Two-step (day, then time within day); deviation from §3.2.1 recorded; asymmetry favours the hypothesis and must be stated openly"
    - topic: "PESEL capture"
      decision: "DTMF keypad in both variants, via Lex V2 DTMF slot input in Wariant B; auth capture measured separately from intent accuracy"
    - topic: "intent-accuracy corpus"
      decision: "Elicited from ~5 people unfamiliar with the system, unprompted by menu or intent names; held out entirely from Lex sample utterances"
  frs_drafted: 16
  quality_check_status: accepted
---

# Shape Notes — PhoneConnect Med

Seed input: `context/foundation/source-requirements.md` (extracted from
`Praca_Magisterska_Konrad_Strzechowski_v3.0.pdf`, §1.2, §1.3, §2.5, §3.1–3.3, plus §1.1 and
§2.2 for the problem statement).

## Vision & Problem Statement

Medical helplines are the primary contact channel between patients and przychodnie, and the
most overloaded one. Patients calling to book or cancel a visit, or to ask a basic question
about the facility, face long queue times and a high rate of unanswered and abandoned calls.
Most of that call volume is routine — booking, cancellation, opening hours — which consumes
rejestracja staff who are consequently unavailable for the complex cases that genuinely need
a human. The cost today is delayed service delivery and falling patient satisfaction.

The insight: automated call handling is routine in banking, retail, and telecom, yet rare in
healthcare, and the blocker is linguistic rather than technical. Patients describe their
needs in imprecise, colloquial, ambiguous language that rigid predefined IVR menu trees
cannot classify. Natural-language understanding is the first mechanism that can absorb that
imprecision — which is precisely the claim this project exists to test, by building the
classical and the NLU-driven approach side by side and measuring both.

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
The agent-facing application is supporting infrastructure for the experiment, not the
product being evaluated.

## Framing note — this is an experiment, not a product launch

Success is a verified or refuted research hypothesis backed by defensible measurements.
Adoption, UX polish, and production-readiness are explicitly out of frame. This decision is
load-bearing for Success Criteria (Phase 3): the criteria describe a *measurement protocol*,
not product outcomes.

## Access Control

Three access layers, per §3.2.3. The layer boundary is the same in both variants; only the
data-collection mechanism differs (DTMF keypad vs speech).

**Layer 1 — Global (no authentication).** Available at any point in a call: main menu,
facility information, repeat last message, transfer to agent, and fallback handling. A caller
who never authenticates can still reach facility info and a human.

**Layer 2 — Authentication.** Identity is a **PESEL + phone number pair**, verified together
against HIS — neither alone is sufficient. On a successful pair match the system sends a
one-time code by SMS and validates it. The "code sent" message is deliberately neutral and
must not reveal whether the supplied data exists in the system. Maximum 3 attempts at each
stage; exhausting them transfers the call to an agent.

**Caller-ID shortcut (deliberate deviation from §3).** When the calling number matches the
phone number the patient declares, authentication completes without sending an OTP. This is
not described in chapter 3. It is kept because it reduces caller friction and applies
identically to both variants, so it cannot confound the A-vs-B comparison. It must be
reconciled in the write-up — either by amending §3.2.1/§3.2.2, or by framing the PoC as
implementing a representative subset rather than the complete designed system.

**Layer 3 — Authenticated.** Booking, listing, rescheduling, cancelling appointments, and
reading patient data. Reachable only after Layer 2 succeeds.

**Session lifetime.** Per-call only. Authentication does not survive the end of a call; a
caller who rings back re-authenticates. This follows §3.1's stateless-at-Connect design,
where session state lives in contact attributes or in DynamoDB under a TTL. There is no
cross-call session to invalidate.

**Agent access.** Handled entirely by Amazon Connect. Agents sign in to Connect and work in
the stock Agent Workspace; transferred calls carry the conversation context as contact
attributes. No custom agent authentication is built.

**HIS mock access.** The mock is one small scheduling application playing two roles: it owns
the datastore (doctors, their rosters/*grafiki*, slots, taken vs free), exposes the REST API
the Lambda layer calls as its "central medical system", and serves an agent-facing web view
over the same data. The view is **read-write** — the agent can create, cancel, and reschedule
appointments through it, which is what satisfies FR-017.

Agent access to that view is unauthenticated in the PoC. It runs on the author's machine or a
private URL, is never exposed to patients, and building a login for it would spend the week on
something no measurement depends on. Recorded as a deliberate simplification.

> Reconciles with `source-requirements.md` §0: agents work in stock Amazon Connect for calls
> (FR-018, FR-019, FR-020 via contact attributes), and in the scheduling app for appointment
> management (FR-017). No custom *telephony* agent application is built.

## Success Criteria

Framed as a measurement protocol, per the Phase 1 decision that this is an experiment rather
than a product launch. "The product worked" means "the comparison could be made and defended".

### Primary

- A caller dials the number and completes the **facility-information task end-to-end in both
  variants** — DTMF menu and free speech — arriving at the same answer through the same shared
  Lambda layer. This is the walking skeleton: it proves Connect, Lex, Lambda, and the HIS mock
  are wired correctly on both paths.
- CloudWatch records per-request latency on both paths from that moment on, so handling-time
  data accumulates from the first slice rather than being retrofitted at the end.

### Secondary

- Booking a visit works end-to-end in both variants — this is where the hypothesis is actually
  tested, since one utterance ("do kardiologa na przyszły tydzień rano") replaces four DTMF
  steps.
- Intent-recognition accuracy measured at ≥ 85% on a held-out Polish corpus (NFR-14).
- English locale added, demonstrating the §2.1 claim that a DTMF variant needs a duplicated
  menu tree while an NLU variant needs only an added locale over unchanged business logic.

### Guardrails

- **Both variants must reach identical business logic.** Any divergence in the shared Lambda
  layer invalidates the A-vs-B comparison — the variants may differ only in how input is
  collected.
- **Train/test separation.** Intent accuracy must not be measured on utterances used as Lex
  sample utterances. Measuring on training data would make the headline number meaningless.
- **The HIS mock must not dominate measured latency.** It sits inside the measured request
  path; if it is slow, the p95 figure describes the mock rather than the system.
- **A caller must always be able to reach a human.** The 3-attempts-then-transfer rule and the
  component-failure transfer are safety behaviour, not features — a caller stuck in a loop with
  no path to an agent is a failure even if every metric looks good.

## Timeline

`mvp_weeks: 1` — one week for a base working system, chosen deliberately as "simplest and
cheapest, then maybe upgrade".

Note on shape rather than duration: the week passes the timeline gate, but the content chosen
for it is ambitious — Amazon Connect instance, a claimed number, a DTMF Contact Flow, a Lex
bot, the shared Lambda layer, and the HIS mock. The identified de-risking move is to claim a
**test number**, chosen on whichever combination of availability and dial-in cost works out
best, rather than assuming a production-appropriate local number can be obtained in time. The
write-up notes that production would use a local number. Nothing in the Contact Flow, the Lex
integration, or the measurement changes.

**Two checks before building against a claimed number:**

- **Dial-in cost falls on a personal phone bill, not on AWS credits.** Confirm what calling the
  claimed number actually costs from wherever testing happens, before committing to it — at a
  few hundred test calls this is the difference between free and meaningfully expensive.
- **Availability in the console is not the same as a completed claim.** Numbers in many
  countries require proof of a local address or a registered entity. Push the claim all the way
  through before building against that number.

If per-minute cost turns out to bite, the fallback is having Connect place **outbound** calls
to the tester's phone instead, shifting the cost onto AWS credits. Not preferred: the thesis
measures an inbound IVR, and outbound contact flows differ enough to muddy the comparison.

## Functional Requirements

FR identifiers are carried over from the thesis (Tabela 2.5–2.8) rather than renumbered from
001, so every requirement traces back to the source document. Gaps in the sequence are the
requirements cut in scoping — see `source-requirements.md` §0.

> **Reading `nice-to-have` correctly.** MVP is scoped to the one-week walking skeleton, so
> `nice-to-have` here means **deferred past the first milestone**, NOT "may never be built".
> Booking, authentication, and the appointment operations are required for the thesis to
> defend its hypothesis — they are deliberately absent from `## Non-Goals` for this reason.
> Anything genuinely dropped lives in `source-requirements.md` §0's OUT OF SCOPE bucket.

### Call handling

- FR-001: Pacjent can issue a global command (transfer to agent, repeat) at any point and have it honoured regardless of dialogue stage. Priority: must-have
  > Socratic: "Global commands add branching to every dialogue state for a rarely-used feature."
  > Resolution: kept. It is the mechanism behind the safety guardrail — a caller must always be
  > able to reach a human — so its cost is the price of the guardrail, not of a feature.
- FR-002: Pacjent can request transfer to a human agent and be routed to a queue. Priority: must-have
  > Socratic: "In a PoC with no staffed call centre, what does transfer even mean?"
  > Resolution: a real Amazon Connect queue, self-staffed when demonstrating. For measurement,
  > every transfer counts as a FAILED automated interaction and feeds completion rate directly.
- FR-003: Pacjent can ask for the last spoken message to be repeated. Priority: nice-to-have
  > Socratic: "In Wariant B a caller can simply re-ask; repeat duplicates that."
  > Resolution: kept as nice-to-have. Trivial in Wariant A (replay the prompt), but in Wariant B
  > it requires holding the last message in session state — so the cost is asymmetric, which is
  > itself a small comparison datapoint.
- FR-006: System transfers the call to an agent after three failed attempts to interpret the caller. Priority: must-have
  > Socratic: "Is three the right number — and does it differ between variants?"
  > Resolution: kept at three per §3.2, identical in both variants so the threshold cannot
  > confound the comparison. Each exhaustion is recorded as a failed automated interaction.
- FR-007: System transfers the call to an agent when an unhandled error occurs, without dropping the call. Priority: must-have
  > Socratic: "A blanket error-to-agent rule hides bugs during development."
  > Resolution: kept — it is guardrail behaviour, not a feature. FR-008's call records preserve
  > the diagnostic trail, so failures stay visible without the caller paying for them.
- FR-008: System records per-call flow information (path taken, outcome, duration) for later analysis. Priority: must-have
  > Socratic: "The thesis marks this SHOULD, so why is it binding?"
  > Resolution: promoted. Handling time and completed-interaction rate — two of §1.2's three
  > comparison criteria — are computed from this data. It stops being optional the moment the
  > thesis depends on it.

### Facility information

- FR-009: Pacjent can obtain basic facility information — address and opening hours. Priority: must-have
  > Socratic: "For a task this trivial DTMF will likely BEAT NLU — one keypress versus speech
  > plus ASR plus NLU latency. Measuring only this could refute the hypothesis."
  > Resolution: FR-009 is the walking skeleton and is explicitly NOT evidence for the hypothesis.
  > The measured comparison must run on booking, where multi-slot free speech competes against
  > four sequential DTMF steps. This makes FR-012 non-deferrable in practice despite its
  > nice-to-have priority.

### Authentication

- FR-005: Pacjent can authenticate by supplying a PESEL and phone number that match as a pair, confirmed by a one-time code or by a matching caller ID. Priority: nice-to-have
  > Socratic: "Lex ASR on an 11-digit PESEL in Polish may be unreliable enough to sink Wariant
  > B's authenticated branch for reasons unrelated to intent recognition."
  > Resolution: PESEL is collected by DTMF keypad in BOTH variants. In Wariant B this uses Lex
  > V2's DTMF slot input, so the interaction stays inside the bot rather than bouncing out to a
  > Connect input block. Both variants therefore capture identity identically and differ only in
  > intent recognition and remaining slot-filling — removing a confound rather than adding one.
  > Verify Lex DTMF slot behaviour in the console early; it is load-bearing.

### Appointments

- FR-012: Authenticated pacjent can book a visit by specialisation and preferred time of day, choosing from offered slots. Priority: nice-to-have
  > Socratic: "The one-utterance advantage only holds if Lex reliably extracts specialisation
  > AND time-of-day together. If it usually asks follow-ups, Wariant B collapses toward Wariant
  > A's turn count."
  > Resolution: measure **turns-to-completion** alongside elapsed time. This tests the actual
  > claim and stays informative even when slot-filling underperforms — partial extraction still
  > beats a fixed four-step menu, and the degree of the win becomes the finding.
- FR-013: Authenticated pacjent can hear the list of their scheduled appointments. Priority: nice-to-have
  > Socratic: "A read-only list carries little comparison evidence."
  > Resolution: kept. Marginal cost is one Lambda plus one menu branch plus one intent, since
  > the business-logic layer is shared. Breadth is cheap here; the first path through each
  > variant is what is expensive.
- FR-014: Authenticated pacjent can cancel a scheduled appointment, releasing the slot. Priority: nice-to-have
  > Socratic: "Cancel repeats booking's interaction shape and adds no new evidence."
  > Resolution: kept for the same marginal-cost reason as FR-013, and because a MUST in the
  > thesis dropped without justification invites a question at defence.
- FR-015: Authenticated pacjent can reschedule an appointment to a new slot, releasing the old one. Priority: nice-to-have
  > Socratic: "Reschedule is cancel plus book — pure redundancy."
  > Resolution: kept as nice-to-have; it is SHOULD in the thesis and the cheapest of the four
  > appointment operations to omit if the week runs short.

### Agent handover

- FR-017: Agent can create, cancel, and reschedule a patient's appointments through the scheduling app. Priority: nice-to-have
  > Socratic: "This is the only FR with no telephony path at all — it generates zero A-vs-B
  > comparison data, and it is the one place the week could quietly disappear into UI work."
  > Resolution: kept, because the app must exist regardless — it is the HIS mock that both
  > variants call, so its datastore and rendering are already paid for and write access is
  > incremental. Held to that boundary deliberately: no auth, no styling budget, no agent
  > workflow beyond the three operations. If the week runs short this is the first thing to
  > drop, since nothing measured depends on it.
- FR-018: Agent receives a transferred call together with the conversation context gathered so far. Priority: nice-to-have
  > Socratic: "Unobservable without a staffed queue."
  > Resolution: the queue exists and is self-staffed for demonstration. Context rides as Amazon
  > Connect contact attributes, which stock Agent Workspace displays — so this is configuration
  > rather than construction.
- FR-019: Agent can transfer the call onward to another agent or queue. Priority: nice-to-have
  > Socratic: "Stock Connect functionality — is it a requirement at all?"
  > Resolution: kept as nice-to-have precisely because it is stock. It costs configuration only,
  > and recording it keeps traceability to Tabela 2.8.
- FR-020: Agent can see the patient's data for the transferred call. Priority: nice-to-have
  > Socratic: "Duplicates FR-018 — both amount to 'the agent sees contact attributes'."
  > Resolution: kept separate because they carry different data: FR-018 is conversation history,
  > FR-020 is patient identity from HIS. Same mechanism, different payload.

## User Stories

### US-01: Caller obtains facility information by speaking (Wariant B — NLU)

- **Given** a caller connected to the helpline who has not authenticated
- **When** they say what they want in their own words, e.g. „jakie są godziny otwarcia"
- **Then** the system recognises the intent without any menu navigation and speaks the answer

#### Acceptance Criteria
- The caller reaches the answer without being presented a menu or pressing a key
- The answer is retrieved through the shared Lambda layer from the HIS mock, not hard-coded in the bot
- Request latency is recorded to CloudWatch for this path
- After three unrecognised utterances the call transfers to an agent (FR-006)
- The per-call record notes the path taken and the outcome (FR-008)

### US-02: Caller obtains facility information by keypad (Wariant A — DTMF)

- **Given** a caller connected to the helpline who has not authenticated
- **When** they listen to the main menu and press the key for facility information
- **Then** the system speaks the same answer US-01 produces

#### Acceptance Criteria
- The answer is byte-identical to US-01's, retrieved through the same shared Lambda layer
- Request latency is recorded to CloudWatch for this path, separately from US-01's
- Total handling time — including prompt playback — is measurable for comparison against US-01
- After three invalid keypresses or input timeouts the call transfers to an agent (FR-006)
- The per-call record notes the path taken and the outcome (FR-008)

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

**Deviation from §3.2.1, recorded deliberately.** The thesis describes reading out "trzy
najbliższe dostępne terminy" directly. Two-step selection replaces that because the literal
rule is unusable over voice when a doctor has many same-day openings. The change applies
identically to both variants, so it cannot confound the comparison — and it is asymmetric in a
way that favours the hypothesis rather than obscuring it: Wariant A must always walk both
steps, whereas a Wariant B caller who names the day in their opening utterance skips the
day-selection turn entirely. This widens the measured turns-to-completion gap in the direction
the hypothesis predicts, which is a point to state openly rather than let a reviewer find.

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
> compliance, retention, and CI/CD. These are real requirements in the thesis (NFR-3, 5–11, 13,
> 15–17) but are bucketed as FUTURE WORK in `source-requirements.md` §0 — named as directions
> for further development, not verified here.


## Measurement protocol — intent-accuracy corpus
Resolves the one gap that constrains work from day one. NFR-14 claims ≥ 85% intent recognition,
and the Success Criteria guardrail forbids measuring it on utterances used to build the bot.
What must precede the first Lex sample utterance is the **elicitation instrument**
(`test-corpus-kit.md`), not the collected corpus itself — see **Ordering** below.

**Source.** Roughly five people who have not seen the system. For each task ("you want to book
a visit with a cardiologist next week") they are asked how they would ask for it over the
phone, in their own words. They are never shown the menu structure, the intent names, or any
example phrasing — that priming is exactly what would invalidate the measurement.

**Size and labelling.** Target ~80–100 utterances across the intent set. Each is labelled with
the task it was elicited for, so the ground-truth intent is fixed at collection time rather
than assigned afterwards by the person who also built the bot.

**Ordering — collect AFTER the bot is built, not before.** Two contamination risks run in
opposite directions:

- *Training → test (priming).* Having authored sample utterances, the interviewer steers
  participants toward phrasings the bot already knows.
- *Test → training (overfitting).* Having read the collected corpus, the author writes sample
  utterances covering exactly those phrasings — training on the test set.

The second is the more damaging and cannot be demonstrated to have been avoided; "I read the
test corpus first but did not let it influence the training data" is an unfalsifiable claim.
The first has a procedural fix that *is* auditable: a fixed elicitation script, read verbatim,
with cards describing situations rather than actions. That script is frozen in
`test-corpus-kit.md` and committed before any sample utterance is written, so both the wording
and the card design predate the training data.

Working order: **freeze the kit → author sample utterances and build the bot → collect →
score.** Recruit participants early regardless; their availability is a schedule risk, not a
methodological one.

**Separation.** The corpus is held out entirely. No utterance in it may appear as a Lex sample
utterance, and the sample utterances are authored before the corpus exists.


**Reporting.** Accuracy is correctly-classified over total, reported with a per-intent
breakdown and the fallback rate, so a single dominant intent cannot carry the headline figure.

**Limitation to state in the write-up.** Five acquaintances are a convenience sample, not a
patient population — they skew younger and more technical than real callers, which if anything
makes the measured accuracy optimistic. Worth stating plainly; a reviewer will otherwise ask.

## Non-Goals

Ruled out deliberately, so they cannot creep back into a one-week build.

- **Real HIS integration.** No AWS Site-to-Site VPN, no connection to an actual hospital
  system, no FHIR/HL7 conformance. The scheduling app *is* the central medical system for the
  entire experiment. §3.3 already sanctions this for the PoC.
- **Security and compliance implementation.** No encryption-at-rest work, no RODO/HIPAA
  conformance, no retention or auto-deletion, no IAM hardening beyond CDK defaults. Named in
  the thesis as directions for further development, not verified here.
- **Scale and availability demonstration.** No load testing, no service-quota increases, no
  1000-concurrent or 99.9% demonstration. Argued from AWS's published model; the p95 latency
  figure is the only performance number this project actually produces.

**Not ruled out:** using a production-appropriate local number. Phase 3 selected a convenience test number as a
de-risking move because a local number requires regulatory documentation and non-instant approval,
but a local number is deliberately *not* declared a non-goal — if it turns out to be obtainable
in time, nothing in the Contact Flow, the Lex integration, or the measurement would change.

## Scale note

At 100× the planned scale the domain rule would not change — intent recognition is measured
per-utterance and is scale-invariant. The p95 latency figure would change, once Lex and Lambda
concurrency limits and cold starts begin to bite. This is the honest boundary on NFR-12: it
describes the system as built and exercised, not the system under production load.

## Forward: tech-stack

Not part of the PRD. Captured here because the thesis fixes it, so the downstream stack step
is a confirmation rather than an open choice.

- The stack is **mandated by thesis §2.4**, which reaches AWS through a documented comparison
  against Twilio Flex. Deviating would break the thesis's own argument.
- Committed components: Amazon Connect, Amazon Lex V2, AWS Lambda, Amazon S3, Amazon
  CloudWatch, Amazon SNS, AWS Secrets Manager, API Gateway, and AWS CDK for IaC (NFR-15).
- **Open question — DynamoDB.** §3.3 assigns it OTP sessions and call logs, and FR-008's
  per-call records need somewhere to live. Whether that warrants DynamoDB specifically, or
  whether Connect contact attributes plus CloudWatch Logs already cover it, is a stack-step
  decision rather than a product one.
- The scheduling app's own stack (language, framework, datastore, hosting) is entirely
  unconstrained by the thesis and is a free choice at the stack step.

## Quality cross-check

All six greenfield elements present: Access Control, Business Logic (one-sentence rule),
project artifacts, timeline-cost (mvp_weeks: 1, within gate), Non-Goals, and — n/a for
greenfield — preserved behavior.

Carried forward to `/10x-prd`'s Open Questions, not blocking:

- **Thesis submission date is TBD.** Recorded as a hard deadline with no date attached.
  Downstream planning cannot work backward from it until the date is filled in.
- **Wariant A's analogue for intent accuracy is unstated.** NFR-14 is meaningful for the NLU
  variant, but a DTMF menu has no intent recognition to be accurate about. Two of §1.2's three
  comparison criteria (handling time, completed-interaction rate) are directly comparable; the
  third needs an explicit definition for Wariant A — most defensibly task-completion and
  misnavigation rate over the same scenario set. Carried from `source-requirements.md` §8.
- **The multilingualism comparison has no agreed metric.** English is in scope to demonstrate
  §2.1's claim that a DTMF variant needs a duplicated menu tree while an NLU variant needs only
  an added locale. Without a stated count — Contact Flow blocks and prompts duplicated versus
  Lex artefacts added, with the shared Lambda layer shown unchanged — it stays an anecdote.
  Carried from `source-requirements.md` §8.

## Forward: conventions

Not part of the PRD. Recorded here so the stack and bootstrap steps pick it up.

**Code is English-only.** Identifiers, comments, commit messages, log output, CDK construct
IDs, datastore attribute names, REST paths, and test descriptions are all English.

**Domain nouns are translated too.** Polish domain vocabulary does not survive into code just
because the domain is Polish. Canonical mapping — use these exact English terms everywhere:

| Polish | English (use this in code) |
|---|---|
| wizyta | `appointment` |
| pacjent | `patient` |
| lekarz | `doctor` |
| specjalizacja | `specialty` |
| termin (wolny) | `slot` |
| grafik | `schedule` |
| placówka | `facility` |
| rejestracja (dział) | `reception` |
| pora dnia | `timeOfDay` |
| odwołać | `cancel` |
| przełożyć | `reschedule` |
| umówić / zarejestrować wizytę | `book` |
| kod jednorazowy | `otp` |
| numer telefonu | `phoneNumber` |

The only Polish that survives in an identifier is **PESEL** — a proper noun for a national
identifier with no English equivalent, like IBAN or VAT ID.

**Polish is content, not code.** Lex sample utterances, TTS prompt text, everything the caller
hears, everything the agent reads on screen, and the mock's seed data (patient names,
specialisation labels) stay Polish. PESEL stays PESEL — it is a proper noun with no English
equivalent.

**Applied — the thesis's Lex slot names get anglicised.** Tabela 3.1 defines slots as
`Specjalizacja`, `PoraDnia`, `WybranyTermin`, `WizytaID`, `NowaPoraDnia`, `NowyTermin`,
`KodOTP`, `Telefon`. Intent names are already English (`BookingIntent`, `MainMenuIntent`, …),
so the table is already mixed. The English-only rule resolves it toward the first option below:

- **Anglicise the slots — chosen.** (`specialty`, `timeOfDay`, `selectedSlot`, `appointmentId`, `newTimeOfDay`, `newSlot`, `otpCode`, `phoneNumber`).
  Consistent with the English-only rule, and Tabela 3.1 needs correcting anyway — its last six
  rows are column-shifted in the source PDF. Cost: a mapping line in the write-up so the code
  still traces to the table.
- **Alternative, not taken: keep the Polish slot names** as thesis-traceable identifiers, treating them as quoted
  domain artefacts rather than authored code. Cost: a permanent mixed-language surface in the
  Lex definitions and every Lambda that reads a slot.
