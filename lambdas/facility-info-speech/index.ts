import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { measured, downstream, type ConnectEvent, type InvocationRecord } from '@pcm/measure';
import { fetchFacility, openDaysEn, ssmlAddress } from '@pcm/facility';
import { beginOtpChallenge, generateOtpCode, verifyOtpCode } from '@pcm/patient';
import {
  findAvailableTimesForDate,
  findNearestAvailable,
  bookAppointment,
  listAppointments,
  resolveAppointment,
  cancelAppointment,
  rescheduleAppointment,
  formatDayLabel,
  formatDayLabelEn,
  ssmlTime,
  ssmlOpeningHour,
  specialtyDisplayNamesEn,
} from '@pcm/appointment';

const sns = new SNSClient({});
const RESEND_DIGIT = '9';
const BOOKING_ATTEMPT_LIMIT = 3;
const CANCEL_ATTEMPT_LIMIT = 3;
const RESCHEDULE_ATTEMPT_LIMIT = 3;
const OTP_MISMATCH_LIMIT = 3;

const TIME_OF_DAY_BOUNDS: Record<string, { min: string; max: string }> = {
  rano: { min: '06:00', max: '11:59' },
  'przed południem': { min: '09:00', max: '11:59' },
  'po południu': { min: '12:00', max: '17:59' },
  wieczorem: { min: '18:00', max: '21:59' },
};

// Mirrors the single facility row seeded in his/src/migrations/1756500000000-CreateFacility.ts
// (opensAt 08:00, closesAt 18:00) — used only to resolve a spoken hour word with no am/pm marker
// of its own (see resolveAmbiguousHour below).
const CLINIC_OPENS_HOUR = 8;
const CLINIC_CLOSES_HOUR = 18;

const MONTHS_GENITIVE: Record<string, number> = {
  stycznia: 1,
  lutego: 2,
  marca: 3,
  kwietnia: 4,
  maja: 5,
  czerwca: 6,
  lipca: 7,
  sierpnia: 8,
  września: 9,
  października: 10,
  listopada: 11,
  grudnia: 12,
};

// [day, nominative, genitive] — Polish speakers say dates in either case ("dwudziesty czwarty
// września" and "dwudziestego czwartego września" have both been heard live), so both forms need
// to match.
const ORDINAL_FORMS: [number, string, string][] = [
  [1, 'pierwszy', 'pierwszego'],
  [2, 'drugi', 'drugiego'],
  [3, 'trzeci', 'trzeciego'],
  [4, 'czwarty', 'czwartego'],
  [5, 'piąty', 'piątego'],
  [6, 'szósty', 'szóstego'],
  [7, 'siódmy', 'siódmego'],
  [8, 'ósmy', 'ósmego'],
  [9, 'dziewiąty', 'dziewiątego'],
  [10, 'dziesiąty', 'dziesiątego'],
  [11, 'jedenasty', 'jedenastego'],
  [12, 'dwunasty', 'dwunastego'],
  [13, 'trzynasty', 'trzynastego'],
  [14, 'czternasty', 'czternastego'],
  [15, 'piętnasty', 'piętnastego'],
  [16, 'szesnasty', 'szesnastego'],
  [17, 'siedemnasty', 'siedemnastego'],
  [18, 'osiemnasty', 'osiemnastego'],
  [19, 'dziewiętnasty', 'dziewiętnastego'],
  [20, 'dwudziesty', 'dwudziestego'],
  [30, 'trzydziesty', 'trzydziestego'],
];

const DAY_ORDINAL_WORDS: { word: string; day: number }[] = [
  ...ORDINAL_FORMS.flatMap(([day, nominative, genitive]) => [
    { word: nominative, day },
    { word: genitive, day },
  ]),
  // Compound tens (21-29, 31): "dwudziesty czwarty" / "dwudziestego czwartego", etc.
  ...[20, 30].flatMap((tens) => {
    const tensForms = ORDINAL_FORMS.find(([d]) => d === tens);
    if (!tensForms) return [];
    const [, tensNominative, tensGenitive] = tensForms;
    return ORDINAL_FORMS.filter(([ones]) => ones >= 1 && ones <= 9 && tens + ones <= 31).flatMap(
      ([ones, onesNominative, onesGenitive]) => [
        { word: `${tensNominative} ${onesNominative}`, day: tens + ones },
        { word: `${tensGenitive} ${onesGenitive}`, day: tens + ones },
      ],
    );
  }),
].sort((a, b) => b.word.length - a.word.length);

// Spoken relative days and weekday names — "jutro", "we wtorek" — never went through
// MONTHS_GENITIVE at all before, so a caller who never names an explicit calendar date got no
// date recovery whatsoever, regardless of how well the month/ordinal parsing below worked.
// Both grammatical cases are listed for "jutro"/"pojutrze" — same reason as ORDINAL_FORMS above:
// "od jutra" (genitive, after a preposition) is at least as common as bare "jutro" (nominative).
// "dziś"/"dzisiaj" are indeclinable adverbs, so they only ever have the one form. English has no
// grammatical case to worry about, so it only needs the one entry per word.
const RELATIVE_DAY_WORDS: { word: string; offsetDays: number }[] = [
  { word: 'pojutrze', offsetDays: 2 },
  { word: 'pojutrza', offsetDays: 2 },
  { word: 'jutro', offsetDays: 1 },
  { word: 'jutra', offsetDays: 1 },
  { word: 'dzisiaj', offsetDays: 0 },
  { word: 'dziś', offsetDays: 0 },
  { word: 'tomorrow', offsetDays: 1 },
  { word: 'today', offsetDays: 0 },
];

const WEEKDAY_WORDS: { word: string; day: number }[] = [
  { word: 'poniedziałek', day: 1 },
  { word: 'wtorek', day: 2 },
  { word: 'środę', day: 3 },
  { word: 'czwartek', day: 4 },
  { word: 'piątek', day: 5 },
  { word: 'sobotę', day: 6 },
  { word: 'niedzielę', day: 0 },
  { word: 'monday', day: 1 },
  { word: 'tuesday', day: 2 },
  { word: 'wednesday', day: 3 },
  { word: 'thursday', day: 4 },
  { word: 'friday', day: 5 },
  { word: 'saturday', day: 6 },
  { word: 'sunday', day: 0 },
];

const nearestWeekday = (targetDay: number, now: Date): string => {
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const todayDay = new Date(todayUtc).getUTCDay();
  const offset = (targetDay - todayDay + 7) % 7;
  return new Date(todayUtc + offset * 86400000).toISOString().slice(0, 10);
};

// Same problem as specialty/time-of-day, but for the date itself: Lex's AMAZON.Date built-in
// regularly fails on spelled-out Polish ordinals — both grammatical cases have been seen failing
// live — even though the exact same phrase parses fine as part of a fresh, full-sentence
// utterance. Recover a date (relative word, weekday, or "day month", digit or spelled-out) from
// the raw transcript, resolving calendar dates to the nearest future occurrence the same way
// AMAZON.Date itself does. Returns the match's position too, so the caller can tell "na {date}"
// (exact) apart from "od {date}"/"po {date}" (starting from) by what word comes right before it.
const findDateWord = (transcript: string, now: Date): { date: string; index: number } | undefined => {
  const relative = RELATIVE_DAY_WORDS.find(({ word }) => transcript.includes(word));
  if (relative) {
    const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return {
      date: new Date(todayUtc + relative.offsetDays * 86400000).toISOString().slice(0, 10),
      index: transcript.indexOf(relative.word),
    };
  }
  const weekday = WEEKDAY_WORDS.find(({ word }) => transcript.includes(word));
  if (weekday) return { date: nearestWeekday(weekday.day, now), index: transcript.indexOf(weekday.word) };

  const monthMatch = Object.entries(MONTHS_GENITIVE).find(([word]) => transcript.includes(word));
  if (!monthMatch) return undefined;
  const [monthWord, month] = monthMatch;

  const digitMatch = transcript.match(new RegExp(`(\\d{1,2})\\s+${monthWord}`));
  const ordinalMatch = DAY_ORDINAL_WORDS.find(({ word }) => transcript.includes(word));
  const day = digitMatch ? Number(digitMatch[1]) : ordinalMatch?.day;
  if (!day || day < 1 || day > 31) return undefined;
  const index = digitMatch ? (digitMatch.index ?? 0) : transcript.indexOf(ordinalMatch!.word);

  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  let candidate = Date.UTC(now.getFullYear(), month - 1, day);
  if (candidate < todayUtc) candidate = Date.UTC(now.getFullYear() + 1, month - 1, day);
  return { date: new Date(candidate).toISOString().slice(0, 10), index };
};

const DATE_AFTER_MARKERS = ['od ', 'po ', 'from ', 'after '];

// "od {date}"/"po {date}"/"from {date}"/"after {date}" means "starting from", not "exactly on" —
// the same distinction the preferredDate vs preferredDateAfter slots make. Only a marker directly
// in front of the matched date counts, so "po południu 24 września" (afternoon, on the 24th)
// doesn't get misread as "after the 24th" just because the sentence contains "po" somewhere
// earlier.
const fallbackDate = (transcript: string, now: Date = new Date()): { date?: string; dateAfter?: string } => {
  const found = findDateWord(transcript, now);
  if (!found) return {};
  const before = transcript.slice(Math.max(0, found.index - 25), found.index);
  const isAfter = DATE_AFTER_MARKERS.some((marker) => before.endsWith(marker));
  return isAfter ? { dateAfter: found.date } : { date: found.date };
};

// Lex only tries to fill the slot it's currently eliciting (preferredDate), so a combined answer
// like "jutro wieczorem" gets the date but silently drops the time-of-day word. Fall back to a
// plain substring check against the same words the TimeOfDay slot type itself accepts (both
// locales — the canonical value is always the Polish one, only the synonyms differ by locale).
const TIME_OF_DAY_SYNONYM_GROUPS: { canonical: string; synonyms: string[] }[] = [
  { canonical: 'rano', synonyms: ['z rana', 'rankiem', 'o poranku', 'wcześnie', 'morning', 'early morning', 'early'] },
  { canonical: 'przed południem', synonyms: ['przedpołudniem', 'dopołudnia', 'late morning', 'before noon', 'before midday'] },
  { canonical: 'po południu', synonyms: ['popołudniu', 'popołudniowe', 'afternoon', 'in the afternoon'] },
  { canonical: 'wieczorem', synonyms: ['na wieczór', 'wieczór', 'późno', 'evening', 'in the evening', 'late'] },
];

const TIME_OF_DAY_SYNONYMS: { word: string; canonical: string }[] = TIME_OF_DAY_SYNONYM_GROUPS.flatMap(({ canonical, synonyms }) =>
  [canonical, ...synonyms].map((word) => ({ word, canonical })),
).sort((a, b) => b.word.length - a.word.length);

const fallbackTimeOfDay = (transcript: string): string | undefined =>
  TIME_OF_DAY_SYNONYMS.find(({ word }) => transcript.includes(word))?.canonical;

// Spelled-out Polish hour words, e.g. "o siedemnastej", "godzina dwudziesta pierwsza". ASR
// transcribes these as inflected words, not digits, the way it would for spoken English numbers
// — so a plain digit regex misses them entirely. Same ambiguity rule as the digit parser: only
// the unambiguous 24h-style hours (13-22) are included, never the low ones (piąta/szósta/...)
// that could mean either morning or afternoon in casual speech.
const HOUR_WORD_GROUPS: { canonical: string; words: string[] }[] = [
  { canonical: '13:00', words: ['trzynasta', 'trzynastej', 'trzynastą'] },
  { canonical: '14:00', words: ['czternasta', 'czternastej', 'czternastą'] },
  { canonical: '15:00', words: ['piętnasta', 'piętnastej', 'piętnastą'] },
  { canonical: '16:00', words: ['szesnasta', 'szesnastej', 'szesnastą'] },
  { canonical: '17:00', words: ['siedemnasta', 'siedemnastej', 'siedemnastą'] },
  { canonical: '18:00', words: ['osiemnasta', 'osiemnastej', 'osiemnastą'] },
  { canonical: '19:00', words: ['dziewiętnasta', 'dziewiętnastej', 'dziewiętnastą'] },
  { canonical: '20:00', words: ['dwudziesta', 'dwudziestej', 'dwudziestą'] },
  { canonical: '21:00', words: ['dwudziesta pierwsza', 'dwudziestej pierwszej', 'dwudziestą pierwszą'] },
  { canonical: '22:00', words: ['dwudziesta druga', 'dwudziestej drugiej', 'dwudziestą drugą'] },
];

// 1-12 o'clock words carry no am/pm marker of their own ("piąta" could mean 5:00 or 17:00) — the
// only thing that safely picks between them is checking which interpretation actually falls
// within the clinic's opening hours (CLINIC_OPENS_HOUR/CLINIC_CLOSES_HOUR above). Where both
// interpretations are open (noon) or neither is ("siódma" = 7:00 or 19:00, and the clinic is
// 08:00-18:00), stay unresolved rather than guess — a wrong silent guess books the wrong half of
// the day, which is worse than asking again.
const AMBIGUOUS_HOUR_WORDS: { hour: number; words: string[] }[] = [
  { hour: 1, words: ['pierwsza', 'pierwszej', 'pierwszą'] },
  { hour: 2, words: ['druga', 'drugiej', 'drugą'] },
  { hour: 3, words: ['trzecia', 'trzeciej', 'trzecią'] },
  { hour: 4, words: ['czwarta', 'czwartej', 'czwartą'] },
  { hour: 5, words: ['piąta', 'piątej', 'piątą'] },
  { hour: 6, words: ['szósta', 'szóstej', 'szóstą'] },
  { hour: 7, words: ['siódma', 'siódmej', 'siódmą'] },
  { hour: 8, words: ['ósma', 'ósmej', 'ósmą'] },
  { hour: 9, words: ['dziewiąta', 'dziewiątej', 'dziewiątą'] },
  { hour: 10, words: ['dziesiąta', 'dziesiątej', 'dziesiątą'] },
  { hour: 11, words: ['jedenasta', 'jedenastej', 'jedenastą'] },
  { hour: 12, words: ['dwunasta', 'dwunastej', 'dwunastą', 'południe'] },
];

const resolveAmbiguousHour = (hour: number): number | undefined => {
  if (hour === 12) return 12;
  const amValid = hour >= CLINIC_OPENS_HOUR && hour < CLINIC_CLOSES_HOUR;
  const pmHour = hour + 12;
  const pmValid = pmHour >= CLINIC_OPENS_HOUR && pmHour < CLINIC_CLOSES_HOUR;
  if (amValid === pmValid) return undefined;
  return amValid ? hour : pmHour;
};

const HOUR_WORDS: { word: string; canonical: string }[] = [
  ...HOUR_WORD_GROUPS.flatMap(({ canonical, words }) => words.map((word) => ({ word, canonical }))),
  ...AMBIGUOUS_HOUR_WORDS.flatMap(({ hour, words }) => {
    const resolved = resolveAmbiguousHour(hour);
    if (resolved === undefined) return [];
    const canonical = `${String(resolved).padStart(2, '0')}:00`;
    return words.map((word) => ({ word, canonical }));
  }),
].sort((a, b) => b.word.length - a.word.length);

// English speakers say the hour as a word just as often as a digit — "monday three p.m." was
// heard verbatim live, not "monday 3 p.m." An explicit am/pm marker right after the word resolves
// it outright; without one it's exactly as ambiguous as the Polish words above, so it gets the
// same resolveAmbiguousHour treatment. Word-boundary matching (not a bare substring check) matters
// here specifically: "one"/"two" are short enough to otherwise match inside unrelated words like
// "phone" or "someone".
const ENGLISH_HOUR_WORDS: { hour: number; word: string }[] = [
  { hour: 1, word: 'one' },
  { hour: 2, word: 'two' },
  { hour: 3, word: 'three' },
  { hour: 4, word: 'four' },
  { hour: 5, word: 'five' },
  { hour: 6, word: 'six' },
  { hour: 7, word: 'seven' },
  { hour: 8, word: 'eight' },
  { hour: 9, word: 'nine' },
  { hour: 10, word: 'ten' },
  { hour: 11, word: 'eleven' },
  { hour: 12, word: 'twelve' },
];

const findEnglishHourWord = (
  transcript: string,
): { hour: number; index: number; meridiem?: 'am' | 'pm' } | undefined => {
  for (const { hour, word } of ENGLISH_HOUR_WORDS) {
    const match = transcript.match(new RegExp(`\\b${word}\\b`, 'i'));
    if (!match || match.index === undefined) continue;
    const after = transcript.slice(match.index, match.index + word.length + 12);
    const markerMatch = after.match(/\b(a\.?\s?m\.?|p\.?\s?m\.?)\b/i);
    const meridiem: 'am' | 'pm' | undefined = markerMatch
      ? markerMatch[1].toLowerCase().startsWith('a')
        ? 'am'
        : 'pm'
      : undefined;
    return { hour, index: match.index, meridiem };
  }
  return undefined;
};

// Same problem as fallbackTimeOfDay, but for an exact clock time (e.g. "24 września o 17") —
// Lex only tries to fill preferredDate while eliciting it, so a trailing "o 17" / "at 5pm" is
// dropped. English ASR tends to normalize spoken hours to digits ("at five" -> "at 5") far more
// often than Polish does, so a bare 1-12 digit with no am/pm marker gets the same
// resolveAmbiguousHour treatment as the spelled-out Polish words below — same ambiguity, just in
// digit form, and it affects both locales' bare hour statements equally.
const findTimeWord = (transcript: string): { time: string; index: number } | undefined => {
  const digitMatch = transcript.match(/\b(?:o\s+godzinie|o|godzina|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (digitMatch) {
    let hour = Number(digitMatch[1]);
    const minute = digitMatch[2] ?? '00';
    const meridiem = digitMatch[3]?.toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (meridiem && hour >= 0 && hour <= 23) {
      return { time: `${String(hour).padStart(2, '0')}:${minute}`, index: digitMatch.index ?? 0 };
    }
    if (!meridiem && hour > 12 && hour <= 23) {
      return { time: `${String(hour).padStart(2, '0')}:${minute}`, index: digitMatch.index ?? 0 };
    }
    if (!meridiem && hour >= 1 && hour <= 12) {
      const resolved = resolveAmbiguousHour(hour);
      if (resolved !== undefined) {
        return { time: `${String(resolved).padStart(2, '0')}:${minute}`, index: digitMatch.index ?? 0 };
      }
    }
  }
  const englishWord = findEnglishHourWord(transcript);
  if (englishWord) {
    let { hour } = englishWord;
    if (englishWord.meridiem === 'pm' && hour < 12) hour += 12;
    if (englishWord.meridiem === 'am' && hour === 12) hour = 0;
    if (englishWord.meridiem) {
      return { time: `${String(hour).padStart(2, '0')}:00`, index: englishWord.index };
    }
    const resolved = resolveAmbiguousHour(hour);
    if (resolved !== undefined) {
      return { time: `${String(resolved).padStart(2, '0')}:00`, index: englishWord.index };
    }
  }

  const wordMatch = HOUR_WORDS.find(({ word }) => transcript.includes(word));
  if (!wordMatch) return undefined;
  return { time: wordMatch.canonical, index: transcript.indexOf(wordMatch.word) };
};

// "do godziny {time}"/"przed {time}"/"before {time}" means "no later than", not "at" — the same
// distinction the preferredTime vs preferredTimeBefore slots make. A bare "do {time}" is
// deliberately not a marker here (mirrors the same ambiguity call already made for
// bookingUtterances in infra-stack.ts): "do dwudziestego" reads as "until the 20th [of the
// month]", not "before 20:00". English "until" has the same date-shaped ambiguity in this bot's
// own training utterances (bookingUtterancesEn uses "until {preferredDate}" for an exact day), so
// it's left out here too — only "before" is unambiguous enough to trust.
const TIME_BEFORE_MARKERS = ['przed ', 'do godziny ', 'do godziną ', 'before '];

const fallbackTime = (transcript: string): { time?: string; timeBefore?: string } => {
  const found = findTimeWord(transcript);
  if (!found) return {};
  const before = transcript.slice(Math.max(0, found.index - 25), found.index);
  const isBefore = TIME_BEFORE_MARKERS.some((marker) => before.endsWith(marker));
  return isBefore ? { timeBefore: found.time } : { time: found.time };
};

// Mirrors the Specialty slot type's values/synonyms in infra-stack.ts (both locales) — keep in
// sync with that list. Lex's bare `specialty` elicitation fails outright (not just a partial
// match) when the caller's answer also names a date in the same breath, e.g. "do kardiologa na
// dwudziestego września" — so we fall back to a plain substring check on the raw transcript.
const SPECIALTY_SYNONYM_GROUPS: { canonical: string; synonyms: string[] }[] = [
  { canonical: 'kardiolog', synonyms: ['kardiologa', 'lekarz od serca', 'kardiologia', 'serce', 'cardiologist', 'heart doctor', 'cardiology', 'heart'] },
  { canonical: 'dermatolog', synonyms: ['dermatologa', 'lekarz od skóry', 'dermatologia', 'skóra', 'dermatologist', 'skin doctor', 'dermatology', 'skin'] },
  { canonical: 'okulista', synonyms: ['okulisty', 'lekarz od oczu', 'okulistyka', 'oczy', 'wzrok', 'ophthalmologist', 'eye doctor', 'ophthalmology', 'eyes', 'vision'] },
  { canonical: 'laryngolog', synonyms: ['laryngologa', 'lekarz od gardła', 'lekarz od uszu nosa i gardła', 'laryngologia', 'uszy', 'gardło', 'ent doctor', 'ent', 'ear nose and throat doctor', 'throat doctor'] },
  { canonical: 'neurolog', synonyms: ['neurologa', 'lekarz od nerwów', 'neurologia', 'neurologist', 'neurology'] },
  { canonical: 'ortopeda', synonyms: ['ortopedy', 'ortopedia', 'kości', 'staw', 'orthopedist', 'orthopedics', 'bones', 'joint'] },
  { canonical: 'internista', synonyms: ['internisty', 'lekarz rodzinny', 'lekarza rodzinnego', 'lekarz pierwszego kontaktu', 'lekarz ogólny', 'lekarz poz', 'internistyczna', 'family doctor', 'general practitioner', 'internal medicine'] },
  { canonical: 'ginekolog', synonyms: ['ginekologa', 'ginekologia', 'gynecologist', 'gynecology'] },
  { canonical: 'pediatra', synonyms: ['pediatry', 'lekarz dziecięcy', 'lekarza dziecięcego', 'pediatria', 'pediatrician', 'pediatrics', 'child doctor'] },
  { canonical: 'endokrynolog', synonyms: ['endokrynologa', 'endokrynologia', 'hormony', 'tarczyca', 'endocrinologist', 'endocrinology', 'hormones', 'thyroid'] },
  { canonical: 'chirurg', synonyms: ['chirurga', 'chirurgia', 'surgeon', 'surgery'] },
  { canonical: 'urolog', synonyms: ['urologa', 'lekarz od dróg moczowych', 'urologia', 'urologist', 'urology'] },
  { canonical: 'psychiatra', synonyms: ['psychiatry', 'psychiatria', 'psychiatrist'] },
  { canonical: 'alergolog', synonyms: ['alergologa', 'alergologia', 'alergia', 'allergist', 'allergy', 'allergology'] },
  { canonical: 'reumatolog', synonyms: ['reumatologa', 'lekarz od reumatyzmu', 'reumatologia', 'rheumatologist', 'rheumatology'] },
];

const SPECIALTY_SYNONYMS: { word: string; canonical: string }[] = SPECIALTY_SYNONYM_GROUPS.flatMap(({ canonical, synonyms }) =>
  [canonical, ...synonyms].map((word) => ({ word, canonical })),
).sort((a, b) => b.word.length - a.word.length);

const fallbackSpecialty = (transcript: string): string | undefined =>
  SPECIALTY_SYNONYMS.find(({ word }) => transcript.includes(word))?.canonical;

const dayLabel = (date: string, isEn: boolean): string => (isEn ? formatDayLabelEn(date) : formatDayLabel(date));
const spokenTime = (time: string, isEn: boolean): string => ssmlTime(time, isEn ? 'en' : 'pl');
const specialtyLabel = (specialty: string, isEn: boolean): string =>
  isEn ? (specialtyDisplayNamesEn[specialty] ?? specialty) : specialty;

type LexSlots = Record<string, { value?: { interpretedValue?: string } } | null>;

type LexEvent = {
  invocationSource: 'DialogCodeHook' | 'FulfillmentCodeHook';
  bot?: { localeId: string };
  inputTranscript?: string;
  sessionState: {
    sessionAttributes?: Record<string, string>;
    intent: { name: string; slots?: LexSlots; confirmationState?: 'None' | 'Confirmed' | 'Denied' };
  };
};

type LexCloseResponse = {
  sessionState: {
    dialogAction: { type: 'Close' };
    intent: { name: string; state: 'Fulfilled' };
    sessionAttributes: Record<string, string>;
  };
  messages: [{ contentType: 'SSML'; content: string }];
};

type LexElicitSlotResponse = {
  sessionState: {
    dialogAction: { type: 'ElicitSlot'; slotToElicit: string };
    intent: { name: string; slots: LexSlots; state: 'InProgress' };
    sessionAttributes: Record<string, string>;
  };
  messages: [{ contentType: 'SSML'; content: string }];
};

type LexConfirmIntentResponse = {
  sessionState: {
    dialogAction: { type: 'ConfirmIntent' };
    intent: { name: string; slots: LexSlots; state: 'InProgress' };
    sessionAttributes: Record<string, string>;
  };
  messages: [{ contentType: 'SSML'; content: string }];
};

type LexDelegateResponse = {
  sessionState: {
    dialogAction: { type: 'Delegate' };
    intent: { name: string; slots: LexSlots; state: 'InProgress' };
    sessionAttributes: Record<string, string>;
  };
};

type LexElicitIntentResponse = {
  sessionState: {
    dialogAction: { type: 'ElicitIntent' };
    sessionAttributes: Record<string, string>;
  };
  messages: [{ contentType: 'SSML'; content: string }];
};

type LexResponse =
  | LexCloseResponse
  | LexElicitSlotResponse
  | LexConfirmIntentResponse
  | LexDelegateResponse
  | LexElicitIntentResponse;

const FALLBACK_MESSAGES = [
  'Przepraszam, nie zrozumiałem. Proszę powiedzieć to jeszcze raz.',
  'Nadal nie rozumiem. Proszę spróbować powiedzieć to inaczej.',
  'Przepraszam, nie udało się zrozumieć zapytania. Łączę z konsultantem.',
];

const FALLBACK_MESSAGES_EN = [
  "Sorry, I didn't understand that. Could you say it again?",
  "I still didn't catch that. Please try phrasing it differently.",
  "Sorry, I wasn't able to understand your request. Connecting you to an agent.",
];

const close = (intentName: string, sessionAttributes: Record<string, string>, message: string): LexCloseResponse => ({
  sessionState: {
    dialogAction: { type: 'Close' },
    intent: { name: intentName, state: 'Fulfilled' },
    sessionAttributes,
  },
  messages: [{ contentType: 'SSML', content: `<speak>${message}</speak>` }],
});

const elicitSlot = (
  intentName: string,
  slotToElicit: string,
  slots: LexSlots,
  sessionAttributes: Record<string, string>,
  message: string,
): LexElicitSlotResponse => ({
  sessionState: {
    dialogAction: { type: 'ElicitSlot', slotToElicit },
    intent: { name: intentName, slots, state: 'InProgress' },
    sessionAttributes,
  },
  messages: [{ contentType: 'SSML', content: `<speak>${message}</speak>` }],
});

const confirmIntent = (
  intentName: string,
  slots: LexSlots,
  sessionAttributes: Record<string, string>,
  message: string,
): LexConfirmIntentResponse => ({
  sessionState: {
    dialogAction: { type: 'ConfirmIntent' },
    intent: { name: intentName, slots, state: 'InProgress' },
    sessionAttributes,
  },
  messages: [{ contentType: 'SSML', content: `<speak>${message}</speak>` }],
});

const delegate = (intentName: string, slots: LexSlots, sessionAttributes: Record<string, string>): LexDelegateResponse => ({
  sessionState: {
    dialogAction: { type: 'Delegate' },
    intent: { name: intentName, slots, state: 'InProgress' },
    sessionAttributes,
  },
});

const elicitIntent = (sessionAttributes: Record<string, string>, message: string): LexElicitIntentResponse => ({
  sessionState: {
    dialogAction: { type: 'ElicitIntent' },
    sessionAttributes,
  },
  messages: [{ contentType: 'SSML', content: `<speak>${message}</speak>` }],
});

const AUTH_REDIRECT_PREFIXES: Record<string, string> = {
  BookingIntent: 'Aby umówić wizytę, proszę się najpierw zidentyfikować.',
  CancelAppointmentIntent: 'Aby odwołać wizytę, proszę się najpierw zidentyfikować.',
  RescheduleIntent: 'Aby przełożyć wizytę, proszę się najpierw zidentyfikować.',
  ListAppointmentsIntent: 'Aby usłyszeć listę wizyt, proszę się najpierw zidentyfikować.',
};

const AUTH_REDIRECT_PREFIXES_EN: Record<string, string> = {
  BookingIntent: 'To book an appointment, please identify yourself first.',
  CancelAppointmentIntent: 'To cancel an appointment, please identify yourself first.',
  RescheduleIntent: 'To reschedule an appointment, please identify yourself first.',
  ListAppointmentsIntent: 'To hear your list of appointments, please identify yourself first.',
};

// Carries the slots already known from the triggering utterance (specialty, date, time...) across
// the auth detour as a JSON blob, so finishAuth can resume the original request instead of asking
// for everything again from scratch once the caller is identified.
const redirectToAuth = (
  pendingIntent: string,
  slots: LexSlots,
  incoming: Record<string, string>,
  isEn: boolean,
): LexElicitSlotResponse => {
  const message = isEn
    ? `${AUTH_REDIRECT_PREFIXES_EN[pendingIntent]} Enter your PESEL number on the keypad, then press the pound key.`
    : `${AUTH_REDIRECT_PREFIXES[pendingIntent]} Wprowadź numer PESEL na klawiaturze telefonu, a następnie naciśnij krzyżyk.`;
  return elicitSlot(
    'AuthIntent',
    'pesel',
    {},
    { ...incoming, lastMessageText: message, pendingIntent, pendingSlots: JSON.stringify(slots) },
    message,
  );
};

const handleBookingDialog = async (
  slots: LexSlots,
  incoming: Record<string, string>,
  record: InvocationRecord,
  isEn: boolean,
  confirmationState?: 'None' | 'Confirmed' | 'Denied',
  rawTranscript = '',
): Promise<LexResponse> => {
  const specialty = slots.specialty?.value?.interpretedValue ?? fallbackSpecialty(rawTranscript);
  if (specialty && !slots.specialty?.value?.interpretedValue) {
    slots = { ...slots, specialty: { value: { interpretedValue: specialty } } };
  }

  if (incoming.authenticated !== 'true') {
    return redirectToAuth('BookingIntent', slots, incoming, isEn);
  }

  if (!specialty) {
    return delegate('BookingIntent', slots, { ...incoming, bookingAsked: '', bookingAttempts: '0' });
  }

  if (confirmationState === 'Confirmed') {
    return handleBookingFulfillment(slots, incoming, record, isEn);
  }

  if (
    confirmationState === 'Denied' &&
    !slots.preferredDate?.value?.interpretedValue &&
    !slots.preferredDateAfter?.value?.interpretedValue &&
    !slots.preferredTime?.value?.interpretedValue &&
    !slots.preferredTimeBefore?.value?.interpretedValue &&
    !slots.preferredTimeOfDay?.value?.interpretedValue
  ) {
    const message = isEn
      ? "Alright, let's pick a different time. What day, and what time, would work for you?"
      : 'Dobrze, wybierzmy inny termin. Jaki dzień, i o której godzinie, Państwu odpowiada?';
    return elicitSlot(
      'BookingIntent',
      'preferredDate',
      {
        ...slots,
        preferredDate: null,
        preferredDateAfter: null,
        preferredTime: null,
        preferredTimeBefore: null,
        preferredTimeOfDay: null,
      },
      { ...incoming, lastMessageText: message, bookingAsked: 'true' },
      message,
    );
  }

  const attempts = Number(incoming.bookingAttempts ?? '0');
  const abort = AbortSignal.timeout(7000);

  const giveUp = async (): Promise<LexResponse> => {
    const message = isEn
      ? "I wasn't able to book the appointment. Connecting you to an agent."
      : 'Nie udało się umówić wizyty. Łączę z konsultantem.';
    return close('BookingIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  };

  const proposeNearest = async (
    minTime?: string,
    maxTime?: string,
    minDate?: string,
    reason?: 'dateUnavailable' | 'unparsed',
  ): Promise<LexResponse> => {
    const nearest = await downstream(record, () => findNearestAvailable(specialty, abort, minTime, maxTime, minDate));
    if (nearest === null) {
      if (attempts + 1 >= BOOKING_ATTEMPT_LIMIT) return giveUp();
      const message = isEn
        ? 'There are no available slots for that specialty. Please give another specialty.'
        : 'Brak wolnych terminów dla wybranej specjalizacji. Proszę podać inną specjalizację.';
      return elicitSlot(
        'BookingIntent',
        'specialty',
        {
          ...slots,
          specialty: null,
          preferredDate: null,
          preferredDateAfter: null,
          preferredTime: null,
          preferredTimeBefore: null,
          preferredTimeOfDay: null,
        },
        { ...incoming, lastMessageText: message, bookingAsked: '', bookingAttempts: String(attempts + 1) },
        message,
      );
    }
    const prefix =
      reason === 'dateUnavailable'
        ? isEn
          ? "Unfortunately there's nothing available at that time. "
          : 'Niestety brak wolnych terminów w podanym przez Państwa terminie. '
        : reason === 'unparsed'
          ? isEn
            ? "I couldn't quite catch a date or time. "
            : 'Nie udało mi się rozpoznać terminu. '
          : '';
    const message = isEn
      ? `${prefix}The nearest available slot with ${specialtyLabel(specialty, isEn)} is ${dayLabel(nearest.date, isEn)} at ${spokenTime(nearest.time, isEn)}. Does that work for you?`
      : `${prefix}Najbliższy wolny termin do ${specialty} to ${dayLabel(nearest.date, isEn)}, godzina ${spokenTime(nearest.time, isEn)}. Czy to Państwu odpowiada?`;
    return confirmIntent(
      'BookingIntent',
      { ...slots, preferredDate: null, preferredDateAfter: null, preferredTime: null, preferredTimeBefore: null, preferredTimeOfDay: null },
      { ...incoming, lastMessageText: message, bookingDate: nearest.date, bookingTime: nearest.time },
      message,
    );
  };

  const dateFallback = fallbackDate(rawTranscript);
  const preferredDate = slots.preferredDate?.value?.interpretedValue ?? dateFallback.date;
  const preferredDateAfter = slots.preferredDateAfter?.value?.interpretedValue ?? dateFallback.dateAfter;
  const hasResolvedDate = Boolean(preferredDate || preferredDateAfter);
  // Only trust the transcript fallback once Lex has actually resolved a date — otherwise a lone
  // time-of-day word (e.g. caller said "24 września wieczorem" but only "wieczorem" was heard)
  // would make hasAnyDateOrTime true on its own and silently search from today, dropping the date
  // the caller stated instead of flagging that it wasn't understood.
  const timeFallback = hasResolvedDate ? fallbackTime(rawTranscript) : {};
  const preferredTime = slots.preferredTime?.value?.interpretedValue ?? timeFallback.time;
  const preferredTimeBefore = slots.preferredTimeBefore?.value?.interpretedValue ?? timeFallback.timeBefore;
  const preferredTimeOfDay =
    slots.preferredTimeOfDay?.value?.interpretedValue ?? (hasResolvedDate ? fallbackTimeOfDay(rawTranscript) : undefined);
  const timeOfDayBounds = preferredTimeOfDay ? TIME_OF_DAY_BOUNDS[preferredTimeOfDay] : undefined;
  const effectiveMinTime = preferredTime ?? timeOfDayBounds?.min;
  const effectiveMaxTime = preferredTimeBefore ?? timeOfDayBounds?.max;
  const hasAnyDateOrTime = preferredDate || preferredDateAfter || effectiveMinTime || effectiveMaxTime;

  // Ask once for a day/time; if the answer still doesn't resolve to a date or time, re-prompt
  // once more with clearer phrasing before finally defaulting to "soonest overall".
  if (!hasAnyDateOrTime && incoming.bookingAsked !== 'reprompted') {
    const firstAsk = incoming.bookingAsked !== 'true';
    const message = firstAsk
      ? isEn
        ? 'What day, and what time, would work for you?'
        : 'Jaki dzień, i o której godzinie, Państwu odpowiada?'
      : isEn
        ? "I didn't catch a day or time. Please say a day, like 'tomorrow', and a time of day."
        : "Proszę podać dzień, na przykład 'jutro', oraz porę dnia.";
    return elicitSlot(
      'BookingIntent',
      'preferredDate',
      slots,
      { ...incoming, lastMessageText: message, bookingAsked: firstAsk ? 'true' : 'reprompted' },
      message,
    );
  }

  try {
    if (preferredDate) {
      const times = await downstream(record, () =>
        findAvailableTimesForDate(specialty, preferredDate, abort, effectiveMinTime, effectiveMaxTime),
      );
      if (times.length === 0) return proposeNearest(effectiveMinTime, effectiveMaxTime, preferredDate, 'dateUnavailable');
      const earliest = times[0];
      const message = isEn
        ? `I'm booking you with ${specialtyLabel(specialty, isEn)}, ${dayLabel(preferredDate, isEn)} at ${spokenTime(earliest, isEn)}. Is that correct?`
        : `Umawiam Państwa do ${specialty}, ${dayLabel(preferredDate, isEn)}, godzina ${spokenTime(earliest, isEn)}. Czy się zgadza?`;
      return confirmIntent(
        'BookingIntent',
        { ...slots, preferredDate: null, preferredDateAfter: null, preferredTime: null, preferredTimeBefore: null, preferredTimeOfDay: null },
        { ...incoming, lastMessageText: message, bookingDate: preferredDate, bookingTime: earliest },
        message,
      );
    }
    return await proposeNearest(effectiveMinTime, effectiveMaxTime, preferredDateAfter, hasAnyDateOrTime ? undefined : 'unparsed');
  } catch (error) {
    record.outcome = 'error';
    record.error = String(error);
    const message = isEn
      ? "Sorry, I'm having trouble searching for available times right now. Connecting you to an agent."
      : 'Przepraszam, mam teraz problem z wyszukaniem terminów. Łączę z konsultantem.';
    return close('BookingIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  }
};

const handleBookingFulfillment = async (
  slots: LexSlots,
  incoming: Record<string, string>,
  record: InvocationRecord,
  isEn: boolean,
): Promise<LexResponse> => {
  if (incoming.authenticated !== 'true') {
    return redirectToAuth('BookingIntent', slots, incoming, isEn);
  }

  const specialty = slots.specialty?.value?.interpretedValue ?? '';
  const date = incoming.bookingDate ?? '';
  const time = incoming.bookingTime ?? '';
  if (!incoming.patientId) {
    const message = isEn
      ? "Sorry, I'm having trouble booking the appointment right now. Connecting you to an agent."
      : 'Przepraszam, mam teraz problem z umówieniem wizyty. Łączę z konsultantem.';
    record.outcome = 'error';
    record.error = 'missing patientId';
    return close('BookingIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  }
  const patientId = Number(incoming.patientId);

  try {
    const booked = await downstream(record, () =>
      bookAppointment(specialty, null, date, time, patientId, AbortSignal.timeout(7000)),
    );
    const message = isEn
      ? booked
        ? 'Your appointment has been booked. Thank you.'
        : "Unfortunately that time is no longer available. Let's try again."
      : booked
        ? 'Wizyta została umówiona. Dziękuję.'
        : 'Niestety ten termin został już zajęty. Proszę spróbować ponownie.';
    return close('BookingIntent', { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
  } catch (error) {
    record.outcome = 'error';
    record.error = String(error);
    const message = isEn
      ? "Sorry, I'm having trouble booking the appointment right now. Connecting you to an agent."
      : 'Przepraszam, mam teraz problem z umówieniem wizyty. Łączę z konsultantem.';
    return close('BookingIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  }
};

const handleCancelDialog = async (
  slots: LexSlots,
  incoming: Record<string, string>,
  record: InvocationRecord,
  isEn: boolean,
  confirmationState?: 'None' | 'Confirmed' | 'Denied',
): Promise<LexResponse> => {
  if (incoming.authenticated !== 'true') {
    return redirectToAuth('CancelAppointmentIntent', slots, incoming, isEn);
  }

  if (confirmationState === 'Confirmed') {
    return handleCancelFulfillment(slots, incoming, record, isEn);
  }

  if (confirmationState === 'Denied') {
    const message = isEn
      ? "Alright, I'll leave that appointment as it is."
      : 'Dobrze, zostawiam tę wizytę bez zmian.';
    return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
  }

  const stage = incoming.cancelStage ?? '';
  const attempts = Number(incoming.cancelAttempts ?? '0');
  const abort = AbortSignal.timeout(7000);
  const patientId = Number(incoming.patientId);

  const giveUp = async (): Promise<LexResponse> => {
    const message = isEn
      ? "I wasn't able to cancel the appointment. Connecting you to an agent."
      : 'Nie udało się odwołać wizyty. Łączę z konsultantem.';
    return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  };

  if (stage === '') {
    try {
      const appointments = await downstream(record, () => listAppointments(patientId, abort));
      if (appointments.length === 0) {
        const message = isEn
          ? "You don't have any upcoming appointments."
          : 'Nie mają Państwo żadnych zaplanowanych wizyt.';
        return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
      }
      const options = appointments
        .slice(0, 3)
        .map((a, i) => `${i + 1} - ${specialtyLabel(a.specialty, isEn)}, ${dayLabel(a.date, isEn)}, ${isEn ? 'at' : 'godzina'} ${spokenTime(a.time, isEn)}`)
        .join('. ');
      const message = isEn
        ? `Which appointment would you like to cancel? ${options}. Please say the number.`
        : `Które wizyty Państwo chcą odwołać? ${options}. Proszę podać numer.`;
      return elicitSlot(
        'CancelAppointmentIntent',
        'selectedSlot',
        { ...slots, selectedSlot: null },
        { ...incoming, lastMessageText: message, cancelStage: 'select', cancelAttempts: '0' },
        message,
      );
    } catch (error) {
      record.outcome = 'error';
      record.error = String(error);
      const message = isEn
        ? "Sorry, I'm having trouble retrieving your appointments right now. Connecting you to an agent."
        : 'Przepraszam, mam teraz problem z pobraniem listy wizyt. Łączę z konsultantem.';
      return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
    }
  }

  const selectedSlot = Number(slots.selectedSlot?.value?.interpretedValue ?? '');
  try {
    const appointment = await downstream(record, () => resolveAppointment(patientId, selectedSlot, abort));
    if (appointment === null) {
      if (attempts + 1 >= CANCEL_ATTEMPT_LIMIT) return giveUp();
      const message = isEn
        ? "I didn't recognize that appointment number. Please try again."
        : 'Nie rozpoznałem podanego numeru wizyty. Proszę spróbować jeszcze raz.';
      return elicitSlot(
        'CancelAppointmentIntent',
        'selectedSlot',
        { ...slots, selectedSlot: null },
        { ...incoming, lastMessageText: message, cancelAttempts: String(attempts + 1) },
        message,
      );
    }
    const message = isEn
      ? `Cancelling appointment: ${specialtyLabel(appointment.specialty, isEn)}, ${dayLabel(appointment.date, isEn)} at ${spokenTime(appointment.time, isEn)}. Is that correct?`
      : `Odwołuję wizytę: ${appointment.specialty}, ${dayLabel(appointment.date, isEn)}, godzina ${spokenTime(appointment.time, isEn)}. Czy się zgadza?`;
    return confirmIntent(
      'CancelAppointmentIntent',
      { ...slots, selectedSlot: null },
      { ...incoming, lastMessageText: message, cancelSelection: String(selectedSlot) },
      message,
    );
  } catch (error) {
    record.outcome = 'error';
    record.error = String(error);
    const message = isEn
      ? "Sorry, I'm having trouble finding that appointment right now. Connecting you to an agent."
      : 'Przepraszam, mam teraz problem z wyszukaniem wizyty. Łączę z konsultantem.';
    return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  }
};

const handleCancelFulfillment = async (
  slots: LexSlots,
  incoming: Record<string, string>,
  record: InvocationRecord,
  isEn: boolean,
): Promise<LexResponse> => {
  if (incoming.authenticated !== 'true') {
    return redirectToAuth('CancelAppointmentIntent', slots, incoming, isEn);
  }

  // handleCancelDialog's own confirmation prompt nulls out selectedSlot in the slots it hands
  // back to Lex (so a decline doesn't re-echo a stale number), which means Lex arrives here at
  // fulfillment with that same null — the resolved index only survives in cancelSelection.
  const selectedSlot = Number(incoming.cancelSelection ?? '');
  if (!incoming.patientId) {
    const message = isEn
      ? "Sorry, I'm having trouble cancelling the appointment right now. Connecting you to an agent."
      : 'Przepraszam, mam teraz problem z odwołaniem wizyty. Łączę z konsultantem.';
    record.outcome = 'error';
    record.error = 'missing patientId';
    return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  }
  const patientId = Number(incoming.patientId);
  const abort = AbortSignal.timeout(7000);

  try {
    const appointment = await downstream(record, () => resolveAppointment(patientId, selectedSlot, abort));
    if (appointment === null) {
      const message = isEn
        ? "I wasn't able to cancel the appointment. Connecting you to an agent."
        : 'Nie udało się odwołać wizyty. Łączę z konsultantem.';
      record.outcome = 'error';
      record.error = 'appointment not found at fulfillment';
      return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
    }
    const cancelled = await downstream(record, () =>
      cancelAppointment(appointment.date, appointment.time, patientId, abort),
    );
    const message = isEn
      ? cancelled
        ? 'Your appointment has been cancelled. Thank you.'
        : "Unfortunately I wasn't able to cancel that appointment. Let's try again."
      : cancelled
        ? 'Wizyta została odwołana. Dziękuję.'
        : 'Niestety nie udało się odwołać tej wizyty. Proszę spróbować ponownie.';
    return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
  } catch (error) {
    record.outcome = 'error';
    record.error = String(error);
    const message = isEn
      ? "Sorry, I'm having trouble cancelling the appointment right now. Connecting you to an agent."
      : 'Przepraszam, mam teraz problem z odwołaniem wizyty. Łączę z konsultantem.';
    return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  }
};

const handleRescheduleDialog = async (
  slots: LexSlots,
  incoming: Record<string, string>,
  record: InvocationRecord,
  isEn: boolean,
  confirmationState?: 'None' | 'Confirmed' | 'Denied',
  rawTranscript = '',
): Promise<LexResponse> => {
  if (incoming.authenticated !== 'true') {
    return redirectToAuth('RescheduleIntent', slots, incoming, isEn);
  }

  if (confirmationState === 'Confirmed') {
    return handleRescheduleFulfillment(slots, incoming, record, isEn);
  }

  if (confirmationState === 'Denied' && !incoming.rescheduleApptSelection) {
    return handleRescheduleDialog({}, { ...incoming, rescheduleApptSelection: '' }, record, isEn);
  }

  if (
    confirmationState === 'Denied' &&
    !slots.preferredDate?.value?.interpretedValue &&
    !slots.preferredDateAfter?.value?.interpretedValue &&
    !slots.preferredTime?.value?.interpretedValue &&
    !slots.preferredTimeBefore?.value?.interpretedValue &&
    !slots.preferredTimeOfDay?.value?.interpretedValue
  ) {
    const message = isEn
      ? "Alright, let's pick a different time. What day, and what time, would work for you?"
      : 'Dobrze, wybierzmy inny termin. Jaki dzień, i o której godzinie, Państwu odpowiada?';
    return elicitSlot(
      'RescheduleIntent',
      'preferredDate',
      {},
      { ...incoming, lastMessageText: message, rescheduleAsked: 'true', rescheduleDate: '', rescheduleTime: '' },
      message,
    );
  }

  const attempts = Number(incoming.rescheduleAttempts ?? '0');
  const abort = AbortSignal.timeout(7000);
  const patientId = Number(incoming.patientId);

  const giveUp = async (): Promise<LexResponse> => {
    const message = isEn
      ? "I wasn't able to reschedule the appointment. Connecting you to an agent."
      : 'Nie udało się przełożyć wizyty. Łączę z konsultantem.';
    return close('RescheduleIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  };

  const offerAppointmentChoice = async (
    prefix: string,
    extra: Record<string, string> = {},
  ): Promise<LexResponse> => {
    const appointments = await downstream(record, () => listAppointments(patientId, abort));
    if (appointments.length === 0) {
      const message = isEn
        ? "You don't have any upcoming appointments."
        : 'Nie mają Państwo żadnych zaplanowanych wizyt.';
      return close('RescheduleIntent', { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
    }
    const options = appointments
      .slice(0, 3)
      .map((a, i) => `${i + 1} - ${specialtyLabel(a.specialty, isEn)}, ${dayLabel(a.date, isEn)}, ${isEn ? 'at' : 'godzina'} ${spokenTime(a.time, isEn)}`)
      .join('. ');
    const message = `${prefix}${options}. ${isEn ? 'Please say the number.' : 'Proszę podać numer.'}`;
    return elicitSlot(
      'RescheduleIntent',
      'selectedSlot',
      {},
      { ...incoming, ...extra, lastMessageText: message, rescheduleApptSelection: '' },
      message,
    );
  };

  let workingSlots = slots;
  let workingIncoming = incoming;

  // Step 1: which appointment to reschedule — only until it's resolved once.
  if (!workingIncoming.rescheduleApptSelection) {
    if (!workingSlots.selectedSlot?.value?.interpretedValue) {
      try {
        return await offerAppointmentChoice(
          isEn ? 'Which appointment would you like to reschedule? ' : 'Którą wizytę Państwo chcą przełożyć? ',
          { rescheduleAttempts: '0', rescheduleAsked: '' },
        );
      } catch (error) {
        record.outcome = 'error';
        record.error = String(error);
        const message = isEn
          ? "Sorry, I'm having trouble retrieving your appointments right now. Connecting you to an agent."
          : 'Przepraszam, mam teraz problem z pobraniem listy wizyt. Łączę z konsultantem.';
        return close('RescheduleIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
      }
    }

    const apptChoice = Number(workingSlots.selectedSlot.value.interpretedValue);
    try {
      const appointment = await downstream(record, () => resolveAppointment(patientId, apptChoice, abort));
      if (appointment === null) {
        if (attempts + 1 >= RESCHEDULE_ATTEMPT_LIMIT) return giveUp();
        const message = isEn
          ? "I didn't recognize that appointment number. Please try again."
          : 'Nie rozpoznałem podanego numeru wizyty. Proszę spróbować jeszcze raz.';
        return elicitSlot(
          'RescheduleIntent',
          'selectedSlot',
          { ...workingSlots, selectedSlot: null },
          { ...workingIncoming, lastMessageText: message, rescheduleAttempts: String(attempts + 1) },
          message,
        );
      }
      workingIncoming = {
        ...workingIncoming,
        rescheduleApptSelection: String(apptChoice),
        rescheduleSpecialty: appointment.specialty,
        rescheduleOldDate: appointment.date,
        rescheduleOldTime: appointment.time,
        rescheduleAttempts: '0',
      };
      workingSlots = { ...workingSlots, selectedSlot: null };
    } catch (error) {
      record.outcome = 'error';
      record.error = String(error);
      const message = isEn
        ? "Sorry, I'm having trouble finding that appointment right now. Connecting you to an agent."
        : 'Przepraszam, mam teraz problem z wyszukaniem wizyty. Łączę z konsultantem.';
      return close('RescheduleIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
    }
  }

  const specialty = workingIncoming.rescheduleSpecialty ?? '';
  const oldDate = workingIncoming.rescheduleOldDate ?? '';
  const oldTime = workingIncoming.rescheduleOldTime ?? '';

  const proposeNearest = async (
    minTime?: string,
    maxTime?: string,
    minDate?: string,
    reason?: 'dateUnavailable' | 'unparsed',
  ): Promise<LexResponse> => {
    const nearest = await downstream(record, () => findNearestAvailable(specialty, abort, minTime, maxTime, minDate));
    if (nearest === null) {
      if (attempts + 1 >= RESCHEDULE_ATTEMPT_LIMIT) return giveUp();
      return offerAppointmentChoice(
        isEn
          ? 'There are no available slots for that specialty. Which other appointment would you like to reschedule? '
          : 'Brak wolnych terminów dla tej specjalizacji. Którą inną wizytę Państwo chcą przełożyć? ',
        { rescheduleSpecialty: '', rescheduleAsked: '', rescheduleAttempts: String(attempts + 1) },
      );
    }
    const prefix =
      reason === 'dateUnavailable'
        ? isEn
          ? "Unfortunately there's nothing available at that time. "
          : 'Niestety brak wolnych terminów w podanym przez Państwa terminie. '
        : reason === 'unparsed'
          ? isEn
            ? "I couldn't quite catch a date or time. "
            : 'Nie udało mi się rozpoznać terminu. '
          : '';
    const message = isEn
      ? `${prefix}${specialtyLabel(specialty, isEn)}, ${dayLabel(oldDate, isEn)} at ${spokenTime(oldTime, isEn)}, ` +
        `to ${dayLabel(nearest.date, isEn)} at ${spokenTime(nearest.time, isEn)}. Is that correct?`
      : `${prefix}${specialty}, ${dayLabel(oldDate, isEn)}, godzina ${spokenTime(oldTime, isEn)}, ` +
        `na ${dayLabel(nearest.date, isEn)}, godzina ${spokenTime(nearest.time, isEn)}. Czy się zgadza?`;
    return confirmIntent(
      'RescheduleIntent',
      { ...workingSlots, preferredDate: null, preferredDateAfter: null, preferredTime: null, preferredTimeBefore: null, preferredTimeOfDay: null },
      { ...workingIncoming, lastMessageText: message, rescheduleDate: nearest.date, rescheduleTime: nearest.time },
      message,
    );
  };

  const dateFallback = fallbackDate(rawTranscript);
  const preferredDate = workingSlots.preferredDate?.value?.interpretedValue ?? dateFallback.date;
  const preferredDateAfter = workingSlots.preferredDateAfter?.value?.interpretedValue ?? dateFallback.dateAfter;
  const hasResolvedDate = Boolean(preferredDate || preferredDateAfter);
  // Only trust the transcript fallback once Lex has actually resolved a date — see the same
  // guard in handleBookingDialog for why.
  const timeFallback = hasResolvedDate ? fallbackTime(rawTranscript) : {};
  const preferredTime = workingSlots.preferredTime?.value?.interpretedValue ?? timeFallback.time;
  const preferredTimeBefore = workingSlots.preferredTimeBefore?.value?.interpretedValue ?? timeFallback.timeBefore;
  const preferredTimeOfDay =
    workingSlots.preferredTimeOfDay?.value?.interpretedValue ?? (hasResolvedDate ? fallbackTimeOfDay(rawTranscript) : undefined);
  const timeOfDayBounds = preferredTimeOfDay ? TIME_OF_DAY_BOUNDS[preferredTimeOfDay] : undefined;
  const effectiveMinTime = preferredTime ?? timeOfDayBounds?.min;
  const effectiveMaxTime = preferredTimeBefore ?? timeOfDayBounds?.max;
  const hasAnyDateOrTime = preferredDate || preferredDateAfter || effectiveMinTime || effectiveMaxTime;

  // Ask once for a day/time; if the answer still doesn't resolve to a date or time, re-prompt
  // once more with clearer phrasing before finally defaulting to "soonest overall".
  if (!hasAnyDateOrTime && workingIncoming.rescheduleAsked !== 'reprompted') {
    const firstAsk = workingIncoming.rescheduleAsked !== 'true';
    const message = firstAsk
      ? isEn
        ? 'What day, and what time, would work for you?'
        : 'Jaki dzień, i o której godzinie, Państwu odpowiada?'
      : isEn
        ? "I didn't catch a day or time. Please say a day, like 'tomorrow', and a time of day."
        : "Proszę podać dzień, na przykład 'jutro', oraz porę dnia.";
    return elicitSlot(
      'RescheduleIntent',
      'preferredDate',
      workingSlots,
      { ...workingIncoming, lastMessageText: message, rescheduleAsked: firstAsk ? 'true' : 'reprompted' },
      message,
    );
  }

  try {
    if (preferredDate) {
      const times = await downstream(record, () =>
        findAvailableTimesForDate(specialty, preferredDate, abort, effectiveMinTime, effectiveMaxTime),
      );
      if (times.length === 0) return proposeNearest(effectiveMinTime, effectiveMaxTime, preferredDate, 'dateUnavailable');
      const earliest = times[0];
      const message = isEn
        ? `${specialtyLabel(specialty, isEn)}, ${dayLabel(oldDate, isEn)} at ${spokenTime(oldTime, isEn)}, ` +
          `to ${dayLabel(preferredDate, isEn)} at ${spokenTime(earliest, isEn)}. Is that correct?`
        : `${specialty}, ${dayLabel(oldDate, isEn)}, godzina ${spokenTime(oldTime, isEn)}, ` +
          `na ${dayLabel(preferredDate, isEn)}, godzina ${spokenTime(earliest, isEn)}. Czy się zgadza?`;
      return confirmIntent(
        'RescheduleIntent',
        { ...workingSlots, preferredDate: null, preferredDateAfter: null, preferredTime: null, preferredTimeBefore: null, preferredTimeOfDay: null },
        { ...workingIncoming, lastMessageText: message, rescheduleDate: preferredDate, rescheduleTime: earliest },
        message,
      );
    }
    return await proposeNearest(effectiveMinTime, effectiveMaxTime, preferredDateAfter, hasAnyDateOrTime ? undefined : 'unparsed');
  } catch (error) {
    record.outcome = 'error';
    record.error = String(error);
    const message = isEn
      ? "Sorry, I'm having trouble searching for available times right now. Connecting you to an agent."
      : 'Przepraszam, mam teraz problem z wyszukaniem terminów. Łączę z konsultantem.';
    return close('RescheduleIntent', { ...workingIncoming, lastMessageText: message, transfer: 'true' }, message);
  }
};

const handleRescheduleFulfillment = async (
  slots: LexSlots,
  incoming: Record<string, string>,
  record: InvocationRecord,
  isEn: boolean,
): Promise<LexResponse> => {
  if (incoming.authenticated !== 'true') {
    return redirectToAuth('RescheduleIntent', slots, incoming, isEn);
  }

  const date = incoming.rescheduleDate ?? '';
  const time = incoming.rescheduleTime ?? '';
  if (!incoming.patientId) {
    const message = isEn
      ? "Sorry, I'm having trouble rescheduling the appointment right now. Connecting you to an agent."
      : 'Przepraszam, mam teraz problem z przełożeniem wizyty. Łączę z konsultantem.';
    record.outcome = 'error';
    record.error = 'missing patientId';
    return close('RescheduleIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  }
  const patientId = Number(incoming.patientId);
  const apptChoice = Number(incoming.rescheduleApptSelection ?? '');
  const abort = AbortSignal.timeout(7000);

  try {
    const appointment = await downstream(record, () => resolveAppointment(patientId, apptChoice, abort));
    if (appointment === null) {
      const message = isEn
        ? "I wasn't able to reschedule the appointment. Connecting you to an agent."
        : 'Nie udało się przełożyć wizyty. Łączę z konsultantem.';
      record.outcome = 'error';
      record.error = 'appointment not found at fulfillment';
      return close('RescheduleIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
    }
    const result = await downstream(record, () =>
      rescheduleAppointment(patientId, appointment.date, appointment.time, appointment.specialty, null, date, time, abort),
    );
    const message = isEn
      ? result.rescheduled
        ? 'Your appointment has been rescheduled. Thank you.'
        : "Unfortunately that time is no longer available. Let's try again."
      : result.rescheduled
        ? 'Wizyta została przełożona. Dziękuję.'
        : 'Niestety ten termin został już zajęty. Proszę spróbować ponownie.';
    return close('RescheduleIntent', { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
  } catch (error) {
    record.outcome = 'error';
    record.error = String(error);
    const message = isEn
      ? "Sorry, I'm having trouble rescheduling the appointment right now. Connecting you to an agent."
      : 'Przepraszam, mam teraz problem z przełożeniem wizyty. Łączę z konsultantem.';
    return close('RescheduleIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  }
};

const handleListAppointments = async (
  incoming: Record<string, string>,
  record: InvocationRecord,
  isEn: boolean,
): Promise<LexCloseResponse> => {
  try {
    const appointments = await downstream(record, () =>
      listAppointments(Number(incoming.patientId), AbortSignal.timeout(7000)),
    );
    if (appointments.length === 0) {
      const message = isEn
        ? "You don't have any upcoming appointments."
        : 'Nie mają Państwo żadnych zaplanowanych wizyt.';
      return close('ListAppointmentsIntent', { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
    }
    const lines = appointments
      .slice(0, 3)
      .map((a) => `${specialtyLabel(a.specialty, isEn)}, ${dayLabel(a.date, isEn)}, ${isEn ? 'at' : 'godzina'} ${spokenTime(a.time, isEn)}`)
      .join('. ');
    const overflow = appointments.length > 3 ? (isEn ? ' You have more upcoming appointments.' : ' Mają Państwo więcej zaplanowanych wizyt.') : '';
    const message = isEn
      ? `Your upcoming appointments: ${lines}.${overflow}`
      : `Najbliższe wizyty: ${lines}.${overflow}`;
    return close('ListAppointmentsIntent', { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
  } catch (error) {
    record.outcome = 'error';
    record.error = String(error);
    const message = isEn
      ? "Sorry, I'm having trouble retrieving your appointments right now. Connecting you to an agent."
      : 'Przepraszam, mam teraz problem z pobraniem listy wizyt. Łączę z konsultantem.';
    return close(
      'ListAppointmentsIntent',
      { ...incoming, lastMessageText: message, fallbackCount: '0', transfer: 'true' },
      message,
    );
  }
};

const finishAuth = async (
  intentName: string,
  sessionAttributes: Record<string, string>,
  record: InvocationRecord,
  isEn: boolean,
): Promise<LexResponse> => {
  const { pendingIntent, pendingSlots, ...rest } = sessionAttributes;
  const confirmedMessage = isEn ? 'Thank you. Your identity has been confirmed.' : 'Dziękuję. Tożsamość została potwierdzona.';
  const authenticated = { ...rest, lastMessageText: confirmedMessage };
  let resumedSlots: LexSlots = {};
  if (pendingSlots) {
    try {
      resumedSlots = JSON.parse(pendingSlots);
    } catch {
      resumedSlots = {};
    }
  }
  if (pendingIntent === 'BookingIntent') return handleBookingDialog(resumedSlots, authenticated, record, isEn);
  if (pendingIntent === 'CancelAppointmentIntent') return handleCancelDialog(resumedSlots, authenticated, record, isEn);
  if (pendingIntent === 'RescheduleIntent') return handleRescheduleDialog(resumedSlots, authenticated, record, isEn);
  if (pendingIntent === 'ListAppointmentsIntent') return handleListAppointments(authenticated, record, isEn);
  if (pendingIntent) {
    const message = isEn
      ? 'Thank you. Your identity has been confirmed. What else can I help you with?'
      : 'Dziękuję. Tożsamość została potwierdzona. W czym jeszcze mogę pomóc?';
    return elicitIntent({ ...rest, lastMessageText: message }, message);
  }
  return close(intentName, { ...rest, lastMessageText: confirmedMessage }, confirmedMessage);
};

const dispatch = async (event: LexEvent, record: InvocationRecord): Promise<LexResponse> => {
  const intentName = event.sessionState.intent.name;
  const incoming = event.sessionState.sessionAttributes ?? {};
  const isEn = event.bot?.localeId === 'en_US';
  const rawTranscript = event.inputTranscript ?? '';

  if (intentName === 'InfoIntent') {
    try {
      const facility = await downstream(record, () => fetchFacility(AbortSignal.timeout(7000)));
      const locale = isEn ? 'en' : 'pl';
      const message = isEn
        ? `Our address is ${ssmlAddress(facility.address, 'en')}. We are open from ${ssmlOpeningHour(facility.opensAt, locale)} to ${ssmlOpeningHour(facility.closesAt, locale)}, ${openDaysEn[facility.openDays] ?? facility.openDays}.`
        : `Nasz adres to ${ssmlAddress(facility.address)}. Jesteśmy czynni od ${ssmlOpeningHour(facility.opensAt, locale)} do ${ssmlOpeningHour(facility.closesAt, locale)}, ${facility.openDays}.`;
      return close(intentName, { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
    } catch (error) {
      record.outcome = 'error';
      record.error = String(error);
      const message = isEn
        ? "Sorry, I'm having trouble retrieving this information right now. Connecting you to an agent."
        : 'Przepraszam, mam teraz problem z pobraniem tych informacji. Łączę z konsultantem.';
      return close(intentName, { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
    }
  }

  if (intentName === 'AuthIntent') {
    const pesel = event.sessionState.intent.slots?.pesel?.value?.interpretedValue ?? '';
    const phone = event.sessionState.intent.slots?.phone?.value?.interpretedValue ?? '';
    const callerNumber = incoming.callerNumber ?? '';
    if (!pesel || !phone) {
      return delegate(intentName, event.sessionState.intent.slots ?? {}, incoming);
    }
    try {
      const result = await downstream(record, () =>
        beginOtpChallenge(pesel, phone, callerNumber, AbortSignal.timeout(7000)),
      );
      if ('authenticated' in result) {
        record.authPath = 'caller-id';
        return finishAuth(intentName, {
          ...incoming,
          fallbackCount: '0',
          authenticated: 'true',
          patientId: String(result.patientId),
          firstName: result.firstName,
          lastName: result.lastName,
          pesel,
          phone,
        }, record, isEn);
      }
      if (!result.isDemo && result.phone) {
        try {
          await downstream(record, () =>
            sns.send(
              new PublishCommand({
                PhoneNumber: result.phone ?? '',
                Message: isEn
                  ? `Your PhoneConnect Med verification code: ${result.code ?? ''}`
                  : `Twój kod weryfikacyjny PhoneConnect Med: ${result.code ?? ''}`,
              }),
            ),
          );
        } catch (error) {
          record.outcome = 'error';
          record.error = String(error);
        }
      }
      const message = isEn
        ? 'A verification code has been sent to the phone number on file. ' +
          'Enter the code on the keypad, then press the pound key. ' +
          'To receive a new code, press nine.'
        : 'Kod weryfikacyjny został wysłany na podany numer telefonu. ' +
          'Wprowadź otrzymany kod na klawiaturze telefonu, a następnie naciśnij krzyżyk. ' +
          'Aby otrzymać nowy kod, naciśnij dziewięć.';
      return elicitSlot(
        'OtpIntent',
        'otpCode',
        {},
        {
          ...incoming,
          lastMessageText: message,
          fallbackCount: '0',
          otpRequired: 'true',
          otpAttempts: '0',
          isDemo: String(result.isDemo),
          code: result.code ?? '',
          phone: result.phone ?? '',
          patientId: result.patientId !== undefined ? String(result.patientId) : '',
          firstName: result.firstName ?? '',
          lastName: result.lastName ?? '',
          pesel,
        },
        message,
      );
    } catch (error) {
      record.outcome = 'error';
      record.error = String(error);
      const message = isEn
        ? "Sorry, I'm having trouble verifying your identity right now. Connecting you to an agent."
        : 'Przepraszam, mam teraz problem z weryfikacją tożsamości. Łączę z konsultantem.';
      return close(
        intentName,
        { ...incoming, lastMessageText: message, fallbackCount: '0', transfer: 'true' },
        message,
      );
    }
  }

  if (intentName === 'OtpIntent') {
    const entered = event.sessionState.intent.slots?.otpCode?.value?.interpretedValue ?? '';
    const isDemo = incoming.isDemo === 'true';
    const expectedCode = incoming.code ?? '';
    const phone = incoming.phone ?? '';
    const patientId = incoming.patientId ?? '';
    const attempts = Number(incoming.otpAttempts ?? '0');

    if (entered === RESEND_DIGIT) {
      const freshCode = isDemo ? expectedCode : generateOtpCode();
      if (!isDemo && phone) {
        try {
          await downstream(record, () =>
            sns.send(
              new PublishCommand({
                PhoneNumber: phone,
                Message: isEn
                  ? `Your PhoneConnect Med verification code: ${freshCode}`
                  : `Twój kod weryfikacyjny PhoneConnect Med: ${freshCode}`,
              }),
            ),
          );
        } catch (error) {
          record.outcome = 'error';
          record.error = String(error);
        }
      }
      const message = isEn
        ? "We've sent a new code. Please enter it on the keypad."
        : 'Wysłaliśmy nowy kod. Proszę wprowadzić go na klawiaturze telefonu.';
      return elicitSlot(
        'OtpIntent',
        'otpCode',
        {},
        { ...incoming, lastMessageText: message, code: freshCode, otpAttempts: '0' },
        message,
      );
    }

    if (verifyOtpCode(expectedCode === '' ? null : expectedCode, entered)) {
      record.authPath = isDemo ? 'demo' : 'otp';
      return finishAuth(intentName, {
        ...incoming,
        fallbackCount: '0',
        authenticated: 'true',
        patientId,
        otpRequired: '',
      }, record, isEn);
    }

    if (attempts + 1 >= OTP_MISMATCH_LIMIT) {
      const message = isEn
        ? "I wasn't able to verify the code. Connecting you to an agent."
        : 'Nie udało się zweryfikować kodu. Łączę z konsultantem.';
      return close(
        intentName,
        { ...incoming, lastMessageText: message, fallbackCount: '0', transfer: 'true' },
        message,
      );
    }

    const message = isEn
      ? "That code isn't correct. Please try again."
      : 'Podany kod jest nieprawidłowy. Proszę spróbować jeszcze raz.';
    return elicitSlot(
      'OtpIntent',
      'otpCode',
      {},
      { ...incoming, lastMessageText: message, otpAttempts: String(attempts + 1) },
      message,
    );
  }

  if (intentName === 'BookingIntent') {
    const slots = event.sessionState.intent.slots ?? {};
    if (event.invocationSource === 'DialogCodeHook') {
      return handleBookingDialog(slots, incoming, record, isEn, event.sessionState.intent.confirmationState, rawTranscript);
    }
    return handleBookingFulfillment(slots, incoming, record, isEn);
  }

  if (intentName === 'CancelAppointmentIntent') {
    const slots = event.sessionState.intent.slots ?? {};
    if (event.invocationSource === 'DialogCodeHook') {
      return handleCancelDialog(slots, incoming, record, isEn, event.sessionState.intent.confirmationState);
    }
    return handleCancelFulfillment(slots, incoming, record, isEn);
  }

  if (intentName === 'RescheduleIntent') {
    const slots = event.sessionState.intent.slots ?? {};
    if (event.invocationSource === 'DialogCodeHook') {
      return handleRescheduleDialog(slots, incoming, record, isEn, event.sessionState.intent.confirmationState, rawTranscript);
    }
    return handleRescheduleFulfillment(slots, incoming, record, isEn);
  }

  if (intentName === 'ListAppointmentsIntent') {
    if (incoming.authenticated !== 'true') {
      return redirectToAuth('ListAppointmentsIntent', {}, incoming, isEn);
    }
    return handleListAppointments(incoming, record, isEn);
  }

  if (intentName === 'MainMenuIntent') {
    const message = isEn
      ? 'Please say what you need: the facility address and opening hours, ' +
        'repeat the last message, or connect to an agent.'
      : 'Proszę powiedzieć, czego Pan lub Pani potrzebuje: adres i godziny otwarcia placówki, ' +
        'powtórzenie ostatniej wiadomości, albo połączenie z konsultantem.';
    return close(intentName, { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
  }

  if (intentName === 'RepeatLastMessageIntent') {
    const message = incoming.lastMessageText ?? (isEn ? "I don't have anything to repeat yet." : 'Nie mam jeszcze nic do powtórzenia.');
    return close(intentName, { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
  }

  if (intentName === 'AgentTransferIntent') {
    const message = isEn ? "I'm connecting you to an agent now." : 'Już łączę z konsultantem.';
    return close(
      intentName,
      { ...incoming, lastMessageText: message, fallbackCount: '0', agentRequested: 'true' },
      message,
    );
  }

  const count = Number(incoming.fallbackCount ?? '0') + 1;
  const messages = isEn ? FALLBACK_MESSAGES_EN : FALLBACK_MESSAGES;
  const message = messages[Math.min(count, messages.length) - 1];
  return close(intentName, { ...incoming, lastMessageText: message, fallbackCount: String(count) }, message);
};

export const handler = (event: LexEvent): Promise<LexResponse> => {
  const contactId = event.sessionState.sessionAttributes?.contactId;
  const synthetic: ConnectEvent = {
    Details: {
      ContactData: contactId ? { ContactId: contactId } : undefined,
      Parameters: { variant: 'speech' },
    },
  };

  return measured('facility-info-speech', (_synthetic, record) => dispatch(event, record))(synthetic);
};
