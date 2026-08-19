# Test Corpus Elicitation Kit

Collection instrument for the NFR-14 intent-recognition measurement (≥ 85% on a held-out set).
Protocol is defined in `shape-notes.md` → `## Measurement protocol — intent-accuracy corpus`.

**Target:** ~90 utterances. 18 scenario cards × 5 participants.

---

## Rules for the interviewer

These exist because the measurement is worthless if participants echo the system's own
vocabulary back at you.

1. **Read each card verbatim.** Do not paraphrase, do not add hints, do not react to the answer.
2. **Never show or mention:** the menu structure, intent names, the word list the bot knows, or
   any example phrasing. Not before, not between cards.
3. **Ask once:** *"Dzwonisz na infolinię przychodni. Co mówisz?"* Record the first complete
   answer. If they ask "can I say anything?", answer *"Tak, cokolwiek"* and nothing more.
4. **Do not correct or re-prompt.** A vague or "wrong" answer is data — it is exactly the
   imprecision the hypothesis claims NLU absorbs. Record it as given.
5. **Record verbatim,** including filler ("yyy", "no dobra"), false starts, and grammatical
   errors. Do not clean up. Cleaning up destroys the thing being measured.
6. **Shuffle card order per participant** so position doesn't systematically bias later answers.
7. **One participant at a time.** Participants must not hear each other's answers.

Ground truth is fixed by the card, not assigned afterwards — participant P3's answer to card
B2 is labelled `BookingIntent` because B2 is a booking scenario, regardless of what they said.

---

## Scenario cards

Each card describes a *situation*, never an action in system vocabulary. Read the Polish text.

### Facility information

| ID | Card (read aloud) | Ground truth |
|---|---|---|
| I1 | „Chcesz się dowiedzieć, o której przychodnia otwiera się w poniedziałek." | `InfoIntent` |
| I2 | „Nie wiesz, gdzie dokładnie znajduje się przychodnia." | `InfoIntent` |

### Booking

| ID | Card (read aloud) | Ground truth |
|---|---|---|
| B1 | „Od tygodnia boli cię serce. Chcesz się dostać do odpowiedniego lekarza." | `BookingIntent` |
| B2 | „Potrzebujesz dostać się do lekarza od skóry, najlepiej w przyszłym tygodniu po południu." | `BookingIntent` + slots |
| B3 | „Chcesz się dostać do okulisty, ale pasuje ci tylko rano." | `BookingIntent` + slots |
| B4 | „Usłyszałeś trzy wolne terminy, ale żaden ci nie pasuje. Chcesz usłyszeć inne." | `NextSlotsIntent` |

B2 and B3 are the load-bearing cards: they test whether a participant volunteers specialty
**and** time preference in one utterance, which is the entire multi-slot claim.

### Existing appointments

| ID | Card (read aloud) | Ground truth |
|---|---|---|
| A1 | „Nie pamiętasz, czy masz jeszcze jakąś umówioną wizytę w tej przychodni." | `AppointmentsIntent` |
| A2 | „Masz umówioną wizytę w czwartek, ale wypadł ci wyjazd i nie dasz rady przyjść." | `CancelIntent` |
| A3 | „Masz wizytę w piątek rano, ale wolałbyś inny dzień." | `RescheduleIntent` |
| A4 | „Chcesz sprawdzić, jakie dane przychodnia ma o tobie zapisane." | `PatientDataIntent` |

### Authentication

| ID | Card (read aloud) | Ground truth |
|---|---|---|
| U1 | „System mówi, że musi cię najpierw zidentyfikować. Reagujesz." | `AuthIntent` |
| U2 | „Miał przyjść SMS z kodem, ale nic nie dostałeś." | `ResendOtpIntent` |

### Escape hatches

| ID | Card (read aloud) | Ground truth |
|---|---|---|
| E1 | „Nie chcesz rozmawiać z automatem." | `AgentTransferIntent` |
| E2 | „Automat coś powiedział, ale nie dosłyszałeś." | `RepeatIntent` |
| E3 | „Dzwonisz i słyszysz powitanie. Nie wiesz jeszcze, co można tu załatwić." | `MainMenuIntent` |

### Out-of-scope (fallback calibration)

These must be in the corpus. Without them, accuracy is measured only on things the bot can do,
which flatters the result — and the fallback rate is one of the numbers you report.

| ID | Card (read aloud) | Ground truth |
|---|---|---|
| F1 | „Chcesz się dowiedzieć, ile kosztuje wizyta prywatna." | `FallbackIntent` |
| F2 | „Chcesz zamówić receptę na lek, który bierzesz na stałe." | `FallbackIntent` |
| F3 | „Chcesz się poskarżyć na lekarza z poprzedniej wizyty." | `FallbackIntent` |

---

## Collection sheet

One row per utterance. CSV so scoring can be scripted.

```csv
utterance_id,participant_id,card_id,expected_intent,expected_slots,utterance_verbatim,predicted_intent,predicted_slots,correct
P1-B2,P1,B2,BookingIntent,"specialty=dermatolog;timeOfDay=afternoon","chciałbym się dostać do dermatologa w przyszłym tygodniu po południu",,,
```

- `expected_slots` — only for B2, B3 (and B1 if the participant volunteers a specialty).
  Use the English slot names from the code glossary.
- `predicted_*` — left blank at collection, filled during scoring.
- `correct` — 1/0, computed. Intent only; slot extraction is reported separately.

---

## Scoring protocol

1. **Freeze this kit** before writing any Lex sample utterance — the *instrument*, not the
   collected corpus, is what must predate the training data. Committing it proves the card
   wording and card design were fixed before the bot's training set existed, which is what
   closes the priming channel. Collection itself happens after the bot is built.
2. Replay each utterance through the bot. Text input against the built bot is acceptable and
   isolates NLU from ASR — **state this in the write-up**, because it means the reported figure
   is intent-recognition accuracy, not end-to-end speech accuracy. If you also test by voice,
   report both; the gap between them is itself interesting.
3. **Report:**
   - Overall accuracy = Σ`correct` / N
   - Per-intent breakdown — prevents one dominant intent carrying the headline number
   - Fallback rate on F1–F3 (should be high; a low rate means the bot is over-confidently
     misclassifying out-of-scope requests, which is worse than admitting confusion)
   - Slot-extraction rate on B2/B3 separately from intent accuracy
4. **Report N and the participant count** alongside every percentage. 90 utterances from 5
   people is a small sample and the write-up should say so before a reviewer does.

## Limitations to state in the write-up

- ~5 acquaintances are a convenience sample, not a patient population — they skew younger and
  more technical than real callers, which makes the measured accuracy **optimistic**.
- Scenario cards were authored by the same person who built the bot. The cards avoid system
  vocabulary deliberately, but the choice of *which* scenarios to include is still the author's.
- Participants were not under real time pressure or genuine medical stress, both of which
  degrade speech clarity in actual helpline calls.
