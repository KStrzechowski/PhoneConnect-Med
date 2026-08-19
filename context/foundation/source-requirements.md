# Source Requirements — extracted from the thesis

**Source:** `Praca_Magisterska_Konrad_Strzechowski_v3.0.pdf` (53 pp., PL)
**Extracted sections:** §1.2 (cel i zakres), §1.3 (hipoteza), §2.5.1 (wymagania funkcjonalne),
§2.5.2 (wymagania poza funkcjonalne), §3.1–3.3 (projektowanie).
**Deliberately excluded:** §2.1–2.4 (teoria: usługi chmurowe, AI, CCaaS/IVR, porównanie
Amazon Connect vs Twilio Flex, analiza usług AWS). Background only — it justifies the stack
choice but contains no build-relevant requirements.

This file is the input to `/10x-shape` and `/10x-prd`. Do not re-read the PDF for requirements.

---

## 0. PoC scope decision (author, 2026-08-17)

**This is not going to production.** It is a thesis PoC whose only job is to support the
comparative hypothesis in §2 on a base feature set. Requirements below are therefore split
into buckets, and the bucket matters more than the MoSCoW priority the thesis assigned.

- **BUILD** — implemented in *both* variants, because the comparison needs identical
  functionality on each side.
- **BUILD (agent)** — a simple Amazon Connect Agent Workspace view, author-owned.
- **MEASURE** — instrumented and reported, because it *is* the thesis result.
- **FUTURE WORK** — named in the thesis as *kierunki dalszego rozwoju*, explicitly **not**
  verified as part of the thesis. Not built, not measured, not argued as satisfied.

| Bucket | Items |
|---|---|
| BUILD | FR-001, FR-002, FR-003, FR-005, FR-006, FR-007, FR-009, FR-012, FR-013, FR-014, FR-015, plus PL + EN language support (NFR-1) |
| BUILD (agent) | FR-017, FR-018, FR-019, FR-020 — delivered by the scheduling app below |
| MEASURE | NFR-12 (p95 ≤ 2 s), NFR-14 (intent accuracy ≥ 85%), plus handling time and completed-interaction rate per §1.2 |
| FUTURE WORK | NFR-3, NFR-5, NFR-6, NFR-7, NFR-8, NFR-9, NFR-10, NFR-11, NFR-13, NFR-15, NFR-16, NFR-17 |
| OUT OF SCOPE | FR-010, FR-011, NFR-2, NFR-4, FR-016's test-results/history payload |

### Language support is IN — it is a comparison axis, not a nice-to-have

NFR-1 requires Polish and English. More importantly, **Tabela 2.1 makes multilingualism one of
the axes on which the thesis compares classic IVR against conversational bots**:

> *Wielojęzyczność* — IVR: „Wymaga osobnych drzew menu na każdy język."
> Bot konwersacyjny: „Bot Locale per język; współdzielona logika biznesowa."

That is a falsifiable claim the build can demonstrate directly, and the two variants already
differ by design in how language is selected — Wariant A by keypress (§3.2.1), Wariant B by
auto-detection from the first utterance (§3.2.2).

**Framing that keeps this cheap:** measure English by *implementation cost*, not by intent
accuracy. Adding EN to Wariant A means duplicating the entire DTMF menu tree; adding it to
Wariant B means adding a Lex locale against the same shared Lambda layer. That asymmetry is
itself a thesis result and costs almost nothing to report. Intent-accuracy measurement
(NFR-14) stays **Polish-only** — a second labelled test corpus is not worth the effort, and
mixing languages would muddy the headline number.

Dialect and colloquial handling (also NFR-1) stays out. That needs a corpus nobody has.

### Agent side and the HIS mock are the same application (author decision)

Rather than an API Gateway stub for HIS plus a separate agent view, **one small scheduling
application serves both roles**: it owns the database (doctors, their rosters/*grafiki*,
slots, taken vs free), exposes the REST API that the Lambda layer calls as its "central
medical system", and provides the agent-facing screen over the same data.

This consolidation is worth taking deliberately, because it changes the FR-017 verdict:

- **FR-018 (call arrives with conversation context)** — effectively free. Context is already
  carried as Amazon Connect contact attributes per §3.1; the workspace displays them.
- **FR-019 (transfer to another agent/queue)** — stock Amazon Connect functionality.
- **FR-020 (display patient data)** — cheap. Surface the contact attributes already set by the
  auth and patient-data Lambdas.
- **FR-017 (agent manages the patient's appointments)** — **back IN scope.** Previously cut as
  "a whole CRUD app", it is now nearly free: the app already holds the schedule data and
  already renders it, so appointment management is the same screens with write access.

**Methodological caveat, and it matters for the thesis.** This mock sits inside the measured
request path (Lambda → HIS mock), so its latency is counted in the NFR-12 p95 figure. Two
consequences to state explicitly in the write-up: keep the mock's own responses fast and
boring so it does not dominate the measurement, and note that a production HIS reached over
an AWS Site-to-Site VPN (§3.3, §7) would add latency this PoC does not model. The p95 number
is a measurement of *the system as built*, not a prediction of production.

Keep the app strictly out of the comparison itself. Both variants must reach it through the
identical Lambda layer, or the A-vs-B measurement is confounded.


### Account creation (FR-004) — resolved, not deleted

FR-004 appears exactly once in the thesis (Tabela 2.5) and is designed nowhere. It also sits
awkwardly against §3's model, where authentication verifies an existing PESEL + phone pair
against HIS — in a real medical helpline the patient record already exists in the hospital
system and is not created over the phone.

The reading that makes FR-004 consistent with §3: the "account" is the **phone-channel
linkage** — first contact binds a caller's phone number to an existing HIS patient record.
That is precisely what the PESEL + phone pairing in `AuthIntent` already does.

**So FR-004 is satisfied by the authentication flow, not by a separate registration feature.**
Worth one sentence in the thesis saying so, rather than silently dropping a MUST.

Rationale for the remaining cuts:

- **FR-010, FR-011** (service list, directions) are S/C priority and are pure information
  playback — the same interaction shape as FR-009, which is already built. No new evidence.
- **FR-016 keeps the flow but not the payload.** Personal data is read back from the mock;
  test results and medical history are not modelled.
- **NFR-2, NFR-4** are subjective usability criteria with no test procedure defined.

**What is genuinely non-negotiable:** both Wariant A and Wariant B (§5), and the MEASURE
bucket. Everything else is adjustable.

---

## 1. Goal and scope (§1.2)

Design, implement, and evaluate an intelligent medical helpline (CCaaS) system. Emphasis on
NLU accuracy and on the performance of a serverless AWS architecture.

Detailed goals:
- Analyse and compare market CCaaS platforms (Amazon Connect vs Twilio Flex) — **done in the thesis, not a build task.**
- Develop the architectural concept — **done in §3, not a build task.**
- **Implement the system as a PoC** — this is the build.
- Run functional tests and evaluate effectiveness.
- **Compare NLU performance against a traditional IVR system.**

## 2. Research hypothesis (§1.3)

> Wykorzystanie ekosystemu usług Serverless AWS umożliwia budowę skalowalnego
> i inteligentnego systemu infolinii medycznej, który, w porównaniu do klasycznych rozwiązań
> IVR, wykazuje wyższą skuteczność w rozumieniu i obsłudze zapytań użytkowników, a także
> zapewnia lepszą skalowalność, dostępność i efektywność operacyjną.

Verification: functional test results, intent-recognition quality comparison, and performance
evaluation of **both approaches**.

> ⚠️ **The hypothesis is comparative.** It cannot be verified by building the Lex/NLU bot alone.
> See §5 below — both variants are in scope.

---

## 3. Functional requirements (§2.5.1)

Priorities are MoSCoW as given in the thesis: M = MUST, S = SHOULD, C = COULD, W = WON'T.
IDs (FR-NNN) are assigned here; the thesis presents these as tables 2.5–2.8 without IDs.

### Call handling (Tabela 2.5)

| ID | Actor | Action | Expected result | Pri |
|---|---|---|---|---|
| FR-001 | Pacjent | Global command (transfer, repeat) | System interprets the command regardless of current dialogue stage and executes it | M |
| FR-002 | Pacjent | Request agent contact | System interprets transfer command and routes patient to a queue | M |
| FR-003 | Pacjent | Ask to repeat information | System replays the last voice message | S |
| FR-004 | Pacjent | Create an account | Patient registers with required data; system creates the account | M |
| FR-005 | Pacjent | Authenticate | Patient supplies required data; system verifies identity | M |
| FR-006 | System | Intent not understood | After 3 failed interpretation attempts, transfer to agent | M |
| FR-007 | System | Unhandled system error | Transfer call to agent | M |
| FR-008 | System | End of conversation | Persist basic call-flow information for analysis | S |

### Facility information (Tabela 2.6)

| ID | Actor | Action | Expected result | Pri |
|---|---|---|---|---|
| FR-009 | Pacjent | Basic facility info (address, opening hours) | Correct spoken response | M |
| FR-010 | Pacjent | Available services | Spoken list of available services | S |
| FR-011 | Pacjent | Location and directions | Spoken location + directions from popular starting points | C |

### Patient service (Tabela 2.7)

| ID | Actor | Action | Expected result | Pri |
|---|---|---|---|---|
| FR-012 | Uwierzytelniony pacjent | Book a new appointment | System checks slot availability, reserves the window, confirms with patient | M |
| FR-013 | Uwierzytelniony pacjent | List scheduled appointments | System fetches and reads out the patient's appointments | M |
| FR-014 | Uwierzytelniony pacjent | Cancel a scheduled appointment | System identifies the appointment, cancels it, releases the slot | M |
| FR-015 | Uwierzytelniony pacjent | Reschedule an appointment | System identifies it, books the new window, releases the old slot | S |
| FR-016 | Uwierzytelniony pacjent | Get patient data | System reads out personal data, test results, history | M |
| FR-017 | Agent | Manage authenticated patient's appointments | Agent can access and manage the patient's appointment list | M |

### Agent handling (Tabela 2.8)

| ID | Actor | Action | Expected result | Pri |
|---|---|---|---|---|
| FR-018 | Agent | Answer a call | Agent receives the call together with conversation context so far | M |
| FR-019 | Agent | Transfer to a specialised agent | Agent can call another agent or queue for consultation/routing | S |
| FR-020 | Agent | Display patient data | Agent has the information needed to identify and serve the patient | M |

---

## 4. Non-functional requirements (§2.5.2, Tabela 2.9)

| # | Area | Requirement |
|---|---|---|
| 1 | Użytkowanie | Supports Polish and English; correctly interprets colloquial phrasing and regional dialects |
| 2 | Użytkowanie | Messages understandable to people without specialist medical knowledge |
| 3 | Użytkowanie | Accepts inbound calls from PSTN and mobile networks |
| 4 | Użytkowanie | Agent interface is legible, consistent, exposes only role-appropriate functions |
| 5 | Bezpieczeństwo | Patient data, sensitive logs, call recordings encrypted at rest (AES-256) and in transit (TLS 1.2+) |
| 6 | Bezpieczeństwo | Access strictly controlled via AWS IAM, least-privilege |
| 7 | Bezpieczeństwo | Meets RODO (GDPR) and HIPAA for patient data processing |
| 8 | Dostępność | Automated helpline available 24/7/365 without interruption |
| 9 | Dostępność | Minimum 99.9% availability |
| 10 | Dostępność | Planned maintenance windows ≤ 30 minutes |
| 11 | Wydajność | Handles at least 1000 concurrent calls |
| 12 | Wydajność | Response latency ≤ 2 s at p95 |
| 13 | Wydajność | All components autoscale |
| 14 | Wydajność | Intent-recognition accuracy ≥ 85% on the test set |
| 15 | Utrzymanie | Infrastructure as code using AWS CDK |
| 16 | Utrzymanie | Updates deployed via CI/CD with no call-handling downtime |
| 17 | Utrzymanie | Patient data, logs, recordings retained for the legally required period, then auto-deleted |

**Measurable targets that double as the thesis's success metrics:** NFR-9 (99.9%),
NFR-11 (1000 concurrent), NFR-12 (p95 ≤ 2 s), NFR-14 (≥ 85% intent accuracy).

---

## 5. Design — two variants, one business-logic layer (§3.1)

Hybrid model. Both variants share the same AWS Lambda business-logic layer and the same
data layer, so the outcome of an operation is identical either way.

| | **Wariant A — DTMF** | **Wariant B — NLU** |
|---|---|---|
| Input | Keypad tones, fixed menu hierarchy | Free speech, Amazon Lex V2 |
| Language | Explicit choice via keypress | Auto-detected from first utterance |
| Auth entry | Separate "Zaloguj się" menu item | Triggered automatically when a protected intent is recognised |
| Connect wiring | Contact Flow → Lambda directly | Contact Flow → Lex V2 → Lambda (fulfillment hook) |
| Trade-off | Low complexity, predictable, easy to test; rigid | Adapts to the patient; higher config complexity, higher ASR/NLU latency |

**Both are required.** Wariant A is the control group for the hypothesis in §2 — it is what
the NLU variant is measured against, not an optional extra.

Shared behaviour:
- 3 failed attempts at any stage → transfer to agent.
- Any unavailable component → immediate transfer to agent without dropping the call.
- Stateless at the Amazon Connect layer; session state lives in contact attributes or
  temporarily in DynamoDB.
- Conversation context is carried to the agent as an Amazon Connect contact attribute.

### Authentication flow (§3.2.1, §3.2.2, §3.3.2)

PESEL + phone number verified **as a pair** → OTP sent via SNS → OTP validated.
The "OTP sent" message is deliberately neutral and must not reveal whether the supplied
data exists in the system. Max 3 attempts per stage.

### Booking flow (§3.2.1, §3.2.2)

Specialisation + preferred time of day → system fetches the 3 nearest available slots →
patient selects (with "next page" of slots available) → system reads back details →
patient confirms → appointment registered.

Wariant B difference: all of this can arrive in one utterance
("chcę umówić się do kardiologa na przyszły tydzień rano"); the bot only asks for what's missing.

## 6. Lex V2 intent tree (§3.2.3, Tabela 3.1)

Three access layers.

**Global — available at any point in the conversation**

| Intent | Sample utterances | Slots | Business operation |
|---|---|---|---|
| `MainMenuIntent` | „dzień dobry", „co mogę zrobić", „menu" | – | Recognise intent, route to the right flow |
| `InfoIntent` | „jakie są godziny otwarcia", „gdzie się znajdujecie", „podaj adres" | – | Play facility information |
| `RepeatIntent` | „powtórz", „słucham?", „nie dosłyszałem" | – | Repeat the last system message |
| `AgentTransferIntent` | „połącz z agentem", „chcę rozmawiać z człowiekiem", „pomoc" | – | Transfer to agent |
| `FallbackIntent` | (intent not recognised) | – | Re-ask, or transfer to agent after the 3rd failure |

**Authentication layer**

| Intent | Sample utterances | Slots | Business operation |
|---|---|---|---|
| `AuthIntent` | „chcę się zalogować" (and every protected action) | PESEL, Telefon | Verify identity on the PESEL + phone pair |
| `OtpIntent` | (after OTP is sent) | KodOTP | Validate the one-time code |
| `ResendOtpIntent` | „wyślij ponownie", „nie dostałem kodu" | – | Resend OTP to the patient's number |

**Authenticated layer — only after successful verification**

| Intent | Sample utterances | Slots | Business operation |
|---|---|---|---|
| `PatientDataIntent` | „moje dane", „pokaż moje dane" | – | Fetch and read out patient data |
| `AppointmentsIntent` | „moje wizyty", „jakie mam terminy" | – | Fetch and read out booked appointments |
| `BookingIntent` | „chcę umówić wizytę", „zarejestruj mnie do kardiologa" | Specjalizacja, PoraDnia, WybranyTermin | Fetch available slots and register the chosen one |
| `NextSlotsIntent` | „następne", „pokaż więcej", „inne opcje" | – | Fetch the next page of available slots |
| `RescheduleIntent` | „chcę przełożyć wizytę", „zmień termin" | WizytaID, NowaPoraDnia, NowyTermin | Fetch new slots and update the existing booking |
| `CancelIntent` | „odwołaj wizytę", „anuluj moją wizytę" | WizytaID | Cancel the indicated appointment |
| `ConfirmationIntent` | „tak", „potwierdzam", „zgadza się" | – | Confirm the action in the current session context |
| `DenyIntent` | „nie", „wróć", „zmień" | – | Cancel the action, return to the previous step |

> Note: Tabela 3.1 is garbled in the PDF's text layer — the last six rows' intents, utterances,
> slots, and operations are column-shifted. The mapping above is reconstructed from the
> surrounding prose (§3.2.3) and is the reading that makes the table self-consistent.
> **Worth a visual check against p. 41–42 before treating slot names as final.**

## 7. Architecture (§3.3)

Event-driven, fully managed, autoscaling.

- **Amazon Connect** — receives inbound calls; routes control either directly to Lambda
  (Wariant A) or through Lex V2 (Wariant B).
- **Amazon Lex V2** — NLU layer; invokes Lambda as a fulfillment hook per intent, passing
  processed slots and session metadata as JSON.
- **AWS Lambda** — all business logic. Called by Connect synchronously (8 s timeout) or
  asynchronously (60 s timeout) straight from the Contact Flow.
- **Amazon DynamoDB** — OTP sessions, invocation logs.
- **Amazon SNS** — OTP delivery; CloudWatch alerting.
- **AWS Secrets Manager** — credentials for external systems.
- **Amazon S3** — call recordings and reporting data.
- **Amazon CloudWatch** — logs and metrics from all layers; alarms via SNS
  (Lambda latency > 2000 ms, error rate > 5%).
- **Amazon API Gateway** — REST integration point toward the medical system.
- **HIS integration** — production target is an AWS Site-to-Site VPN tunnel.
  **In the PoC this is replaced by a minimal scheduling application** (own datastore of
  doctors, rosters, and slots + REST API) that also serves the agent-facing screens.
  See §0 — it is one artefact playing two roles, and it sits inside the measured latency path.

Security: least-privilege IAM role per Lambda; DynamoDB and S3 encrypted with AWS KMS
(AES-256); all inter-component traffic over TLS 1.2+; Lambda↔HIS authenticated via IAM keys
or JWT.

---

## 8. Gaps to resolve during shaping

Items the thesis states as requirements but does not specify well enough to build from.
These should land in the PRD's `## Open Questions`, not be invented.

The §0 scope decision closes most of what was originally open here — agent scope, account
creation, medical-history payload, availability and CI/CD requirements are all resolved by
bucketing. Three remain, and the first is the critical path.

1. **The labelled test set for NFR-14 is unresolved and blocking.** Measuring intent-recognition
   accuracy ≥ 85% requires a corpus of realistic Polish patient utterances with known intent
   labels. §1.2 promises *"rzeczywiste wzorce zapytań pacjentów"* but names no source. Without
   this, the headline claim of the thesis has no evidence. Options worth weighing: hand-authored
   utterances per intent (honest but arguably self-serving, since the author also writes the Lex
   sample utterances), utterances collected from people unfamiliar with the system, or a
   published Polish-language intent dataset adapted to the domain. **This needs a decision
   before implementation, not after** — it shapes how the Lex sample utterances are written,
   since training and test utterances must not be the same set.

2. **How is the DTMF side measured for intent accuracy?** NFR-14 is meaningful for Wariant B,
   but a DTMF menu has no intent recognition to be accurate about — a keypress is either the
   right branch or the wrong one. The comparison in §1.2 lists three criteria (*trafność
   rozpoznawania intencji, czas obsługi zapytania, odsetek poprawnie zakończonych interakcji*),
   and only the latter two are directly comparable across variants. The thesis needs an explicit
   statement of what "accuracy" means for Wariant A — most defensibly, task-completion rate and
   misnavigation rate against the same scenario set fed to both variants.

3. **The multilingualism comparison needs a stated metric.** §0 keeps EN in because Tabela 2.1
   claims an IVR needs a separate menu tree per language while a bot needs only a new Locale.
   Demonstrating that requires deciding *what is counted* — most defensibly, the number of
   Contact Flow blocks and prompts duplicated in Wariant A versus the number of Lex artefacts
   added in Wariant B, with the shared Lambda layer shown as unchanged in both. Without an
   agreed count this stays an anecdote rather than a result.
