# Lex V2 Sample Utterances (Training Set)

Training data for the Wariant B bot. Authored deliberately **before** the test corpus exists —
see `shape-notes.md` → `## Measurement protocol`. Transcribed into the CDK Lex construct at
build time; this file is the source of truth for the wording.

Language: Polish (content, not code). Intent and slot names: English, per the code glossary.

---

## Global layer

### MainMenuIntent

```
dzień dobry
halo
dzień dobry, dzwonię do przychodni
co mogę tutaj załatwić
co można u was załatwić
jakie są opcje
menu
menu główne
wróć do menu
zacznijmy od nowa
od początku
w czym możecie pomóc
nie wiem co wybrać
co dalej
```

### InfoIntent

```
jakie są godziny otwarcia
do której jesteście otwarci
od której pracujecie
w jakich godzinach przyjmujecie
kiedy przychodnia jest czynna
czy dziś jest otwarte
czy jesteście otwarci w sobotę
gdzie się znajdujecie
jaki jest adres
podaj adres
gdzie was znaleźć
na jakiej ulicy jest przychodnia
jak do was dojechać
informacje o przychodni
chcę się dowiedzieć o placówce
```

### RepeatLastMessageIntent

> Renamed from `RepeatIntent` — Lex V2 reserves that base name for the built-in
> `AMAZON.RepeatIntent`, which rejects a custom intent import under the same name.

```
powtórz
powtórz proszę
powtórz to jeszcze raz
jeszcze raz
słucham?
nie dosłyszałem
nie usłyszałam
nie zrozumiałem
możesz powtórzyć
mógłbyś powtórzyć
co powiedziałeś
przepraszam, nie usłyszałem
```

### AgentTransferIntent

```
połącz z agentem
połącz mnie z rejestracją
przełącz mnie do rejestracji
chcę rozmawiać z człowiekiem
chcę rozmawiać z osobą
chcę z kimś porozmawiać
nie chcę rozmawiać z automatem
człowiek proszę
poproszę o konsultanta
daj mi kogoś z obsługi
potrzebuję pomocy pracownika
operator
konsultant
pomoc
```

### FallbackIntent

No sample utterances — Lex's built-in fallback fires when nothing else matches. Its behaviour
(re-ask, then transfer after the third failure) is FR-006, implemented in the fulfillment
Lambda rather than in the utterance set.

---

## Authentication layer

`PESEL` and `otpCode` are captured by **DTMF keypad in both variants** (shape decision), so
these intents need only enough utterances to enter the flow — the digits themselves arrive as
keypresses, not speech.

### AuthIntent

```
chcę się zalogować
zaloguj mnie
chcę się zidentyfikować
chcę potwierdzić tożsamość
chcę się uwierzytelnić
podam swoje dane
mogę podać PESEL
mam podać numer PESEL
jak się zalogować
```

### OtpIntent

```
mam kod
dostałem kod
przyszedł SMS
mam SMS z kodem
wpisuję kod
podaję kod
```

### ResendOtpIntent

```
wyślij ponownie
wyślij jeszcze raz kod
prześlij kod jeszcze raz
ponów wysyłkę
nie dostałem kodu
nie mam kodu
nie przyszedł SMS
SMS nie dotarł
nic nie przyszło
```

---

## Authenticated layer

### PatientDataIntent

```
moje dane
pokaż moje dane
sprawdź moje dane
chcę sprawdzić swoje dane
jakie macie o mnie dane
co macie o mnie zapisane
moje informacje
dane pacjenta
chcę zobaczyć swoją kartotekę
```

### AppointmentsIntent

```
moje wizyty
jakie mam terminy
kiedy mam wizytę
czy mam umówioną wizytę
sprawdź moje wizyty
jakie mam zaplanowane wizyty
lista moich wizyt
czy jestem gdzieś zapisany
przypomnij mi kiedy mam wizytę
```

### BookingIntent

Slots: `specialty`, `timeOfDay`, `selectedSlot`.

```
chcę umówić wizytę
chcę się zapisać do lekarza
chciałbym się zapisać
potrzebuję wizyty
potrzebuję terminu
chcę się umówić do {specialty}
chcę wizytę u {specialty}
zapisz mnie do {specialty}
zarejestruj mnie do {specialty}
potrzebuję terminu u {specialty}
czy jest wolny termin do {specialty}
chcę się dostać do {specialty}
chcę się umówić do {specialty} {timeOfDay}
chcę się dostać do {specialty} {timeOfDay}
umów mnie do {specialty} {timeOfDay}
szukam terminu {timeOfDay}
umów mnie {timeOfDay}
```

The `{specialty} {timeOfDay}` forms are the ones the hypothesis rests on — they let a caller
supply both parameters in one utterance. Keep them; they are the multi-slot claim.

### NextSlotsIntent

```
następne
następny
kolejne terminy
pokaż więcej
inne terminy
inne opcje
inne godziny
nie pasuje mi żaden
żaden nie pasuje
może być później
dalej
```

### RescheduleIntent

Slots: `appointmentId`, `newTimeOfDay`, `newSlot`.

```
chcę przełożyć wizytę
chcę przesunąć wizytę
chcę zmienić termin
zmień termin
zmiana terminu
chcę zmienić datę wizyty
przenieś moją wizytę
nie mogę w tym terminie, chcę inny
czy można przełożyć
```

### CancelIntent

Slot: `appointmentId`.

```
odwołaj wizytę
chcę odwołać wizytę
chcę odwołać
muszę odwołać termin
anuluj moją wizytę
proszę usunąć moją wizytę
nie przyjdę na wizytę
chcę zrezygnować z wizyty
```

### ConfirmationIntent

```
tak
tak, poproszę
potwierdzam
zgadza się
zgoda
dokładnie
dobrze
ok
jasne
może być
pasuje
pasuje mi
```

### DenyIntent

```
nie
nie chcę
nie zgadzam się
to nie to
nie pasuje mi
wróć
cofnij
zmień
```

---

## Slot types

### `specialty` (custom slot type)

Values, with synonyms — the synonyms matter more than the canonical values, because a caller
who knew the medical term would probably not need the helpline.

| Value | Synonyms |
|---|---|
| kardiolog | lekarz od serca, kardiologia, serce |
| dermatolog | lekarz od skóry, dermatologia, skóra |
| okulista | lekarz od oczu, okulistyka, oczy, wzrok |
| laryngolog | lekarz od gardła, laryngologia, uszy, gardło |
| neurolog | neurologia |
| ortopeda | ortopedia, kości, staw |
| internista | lekarz rodzinny, lekarz pierwszego kontaktu, internistyczna |
| ginekolog | ginekologia |
| pediatra | lekarz dziecięcy, pediatria |
| endokrynolog | endokrynologia, hormony, tarczyca |
| chirurg | chirurgia |
| urolog | urologia |
| psychiatra | psychiatria |
| alergolog | alergologia, alergia |
| reumatolog | reumatologia |

### `timeOfDay` (custom slot type)

| Value | Synonyms |
|---|---|
| rano | z rana, rankiem, o poranku, wcześnie |
| przed południem | przedpołudniem, dopołudnia |
| po południu | popołudniu, popołudniowe |
| wieczorem | na wieczór, wieczór, późno |

---

## Known confusion pairs

Overlaps that will show up in the confusion matrix. Documented now so the results can be
interpreted rather than explained away afterwards.

| Pair | Overlapping phrasing | Disambiguated by |
|---|---|---|
| `CancelIntent` vs `DenyIntent` | „anuluj", „rezygnuję", „nie chcę" | Session state — Deny only when a confirmation is pending. Deliberately kept out of the Cancel utterance list. |
| `NextSlotsIntent` vs `DenyIntent` | „inne opcje", „coś innego", „nie pasuje" | Session state — NextSlots only when slots have just been offered. |
| `RescheduleIntent` vs `CancelIntent` | „nie mogę w tym terminie" | Reschedule implies a replacement; Cancel does not. Genuinely ambiguous in speech — expect errors here. |
| `AgentTransferIntent` vs `MainMenuIntent` | „pomoc", „nie wiem co dalej" | „pomoc" is assigned to AgentTransfer deliberately; a confused caller wanting a human is the safer default. |

The Cancel/Deny pair is the one most likely to cost accuracy points. It is a real property of
the domain, not a modelling mistake — worth stating in the write-up rather than tuning away,
since tuning it away by adding session-conditional utterances would be the kind of adjustment
that inflates a measured score.

---

## Authorship limitation

The scenario cards in `test-corpus-kit.md` and these training utterances share an author. The
two artefacts are different in kind — cards describe *situations*, these are *phrasings*, and
the test utterances themselves come from participants rather than from either file — but the
overlap is real and belongs in the write-up alongside the other limitations already recorded.
