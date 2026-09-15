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

const dayLabel = (date: string, isEn: boolean): string => (isEn ? formatDayLabelEn(date) : formatDayLabel(date));
const spokenTime = (time: string, isEn: boolean): string => ssmlTime(time, isEn ? 'en' : 'pl');
const specialtyLabel = (specialty: string, isEn: boolean): string =>
  isEn ? (specialtyDisplayNamesEn[specialty] ?? specialty) : specialty;

type LexSlots = Record<string, { value?: { interpretedValue?: string } } | null>;

type LexEvent = {
  invocationSource: 'DialogCodeHook' | 'FulfillmentCodeHook';
  bot?: { localeId: string };
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

const redirectToAuth = (pendingIntent: string, incoming: Record<string, string>, isEn: boolean): LexElicitSlotResponse => {
  const message = isEn
    ? `${AUTH_REDIRECT_PREFIXES_EN[pendingIntent]} Enter your PESEL number on the keypad, then press the pound key.`
    : `${AUTH_REDIRECT_PREFIXES[pendingIntent]} Wprowadź numer PESEL na klawiaturze telefonu, a następnie naciśnij krzyżyk.`;
  return elicitSlot('AuthIntent', 'pesel', {}, { ...incoming, lastMessageText: message, pendingIntent }, message);
};

const handleBookingDialog = async (
  slots: LexSlots,
  incoming: Record<string, string>,
  record: InvocationRecord,
  isEn: boolean,
  confirmationState?: 'None' | 'Confirmed' | 'Denied',
): Promise<LexResponse> => {
  const specialty = slots.specialty?.value?.interpretedValue;

  if (incoming.authenticated !== 'true') {
    return redirectToAuth('BookingIntent', incoming, isEn);
  }

  if (!specialty) {
    return delegate('BookingIntent', slots, incoming);
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

  const proposeNearest = async (minTime?: string, maxTime?: string, minDate?: string): Promise<LexResponse> => {
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
    const message = isEn
      ? `The nearest available slot with ${specialtyLabel(specialty, isEn)} is ${dayLabel(nearest.date, isEn)} at ${spokenTime(nearest.time, isEn)}. Does that work for you?`
      : `Najbliższy wolny termin do ${specialty} to ${dayLabel(nearest.date, isEn)}, godzina ${spokenTime(nearest.time, isEn)}. Czy to Państwu odpowiada?`;
    return confirmIntent(
      'BookingIntent',
      slots,
      { ...incoming, lastMessageText: message, bookingDate: nearest.date, bookingTime: nearest.time },
      message,
    );
  };

  const preferredDate = slots.preferredDate?.value?.interpretedValue;
  const preferredDateAfter = slots.preferredDateAfter?.value?.interpretedValue;
  const preferredTime = slots.preferredTime?.value?.interpretedValue;
  const preferredTimeBefore = slots.preferredTimeBefore?.value?.interpretedValue;
  const preferredTimeOfDay = slots.preferredTimeOfDay?.value?.interpretedValue;
  const timeOfDayBounds = preferredTimeOfDay ? TIME_OF_DAY_BOUNDS[preferredTimeOfDay] : undefined;
  const effectiveMinTime = preferredTime ?? timeOfDayBounds?.min;
  const effectiveMaxTime = preferredTimeBefore ?? timeOfDayBounds?.max;
  const hasAnyDateOrTime = preferredDate || preferredDateAfter || effectiveMinTime || effectiveMaxTime;

  // First turn with nothing given at all: ask once, inviting both day and time in the same
  // breath, before defaulting to "soonest overall". If the caller's answer still doesn't resolve
  // to a date or time, bookingAsked is already set and we fall through to the soonest-overall search.
  if (!hasAnyDateOrTime && incoming.bookingAsked !== 'true') {
    const message = isEn
      ? 'What day, and what time, would work for you?'
      : 'Jaki dzień, i o której godzinie, Państwu odpowiada?';
    return elicitSlot('BookingIntent', 'preferredDate', slots, { ...incoming, lastMessageText: message, bookingAsked: 'true' }, message);
  }

  try {
    if (preferredDate) {
      let times = await downstream(record, () => findAvailableTimesForDate(specialty, preferredDate, abort));
      if (effectiveMinTime) times = times.filter((t) => t >= effectiveMinTime);
      if (effectiveMaxTime) times = times.filter((t) => t <= effectiveMaxTime);
      if (times.length === 0) return proposeNearest(effectiveMinTime, effectiveMaxTime, preferredDate);
      const earliest = times[0];
      const message = isEn
        ? `I'm booking you with ${specialtyLabel(specialty, isEn)}, ${dayLabel(preferredDate, isEn)} at ${spokenTime(earliest, isEn)}. Is that correct?`
        : `Umawiam Państwa do ${specialty}, ${dayLabel(preferredDate, isEn)}, godzina ${spokenTime(earliest, isEn)}. Czy się zgadza?`;
      return confirmIntent(
        'BookingIntent',
        slots,
        { ...incoming, lastMessageText: message, bookingDate: preferredDate, bookingTime: earliest },
        message,
      );
    }
    return await proposeNearest(effectiveMinTime, effectiveMaxTime, preferredDateAfter);
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
    return redirectToAuth('BookingIntent', incoming, isEn);
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
    return redirectToAuth('CancelAppointmentIntent', incoming, isEn);
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
    return confirmIntent('CancelAppointmentIntent', slots, { ...incoming, lastMessageText: message }, message);
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
    return redirectToAuth('CancelAppointmentIntent', incoming, isEn);
  }

  const selectedSlot = Number(slots.selectedSlot?.value?.interpretedValue ?? '');
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
): Promise<LexResponse> => {
  if (incoming.authenticated !== 'true') {
    return redirectToAuth('RescheduleIntent', incoming, isEn);
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
          { rescheduleAttempts: '0' },
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

  const proposeNearest = async (minTime?: string, maxTime?: string, minDate?: string): Promise<LexResponse> => {
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
    const message = isEn
      ? `${specialtyLabel(specialty, isEn)}, ${dayLabel(oldDate, isEn)} at ${spokenTime(oldTime, isEn)}, ` +
        `to ${dayLabel(nearest.date, isEn)} at ${spokenTime(nearest.time, isEn)}. Is that correct?`
      : `${specialty}, ${dayLabel(oldDate, isEn)}, godzina ${spokenTime(oldTime, isEn)}, ` +
        `na ${dayLabel(nearest.date, isEn)}, godzina ${spokenTime(nearest.time, isEn)}. Czy się zgadza?`;
    return confirmIntent(
      'RescheduleIntent',
      workingSlots,
      { ...workingIncoming, lastMessageText: message, rescheduleDate: nearest.date, rescheduleTime: nearest.time },
      message,
    );
  };

  const preferredDate = workingSlots.preferredDate?.value?.interpretedValue;
  const preferredDateAfter = workingSlots.preferredDateAfter?.value?.interpretedValue;
  const preferredTime = workingSlots.preferredTime?.value?.interpretedValue;
  const preferredTimeBefore = workingSlots.preferredTimeBefore?.value?.interpretedValue;
  const preferredTimeOfDay = workingSlots.preferredTimeOfDay?.value?.interpretedValue;
  const timeOfDayBounds = preferredTimeOfDay ? TIME_OF_DAY_BOUNDS[preferredTimeOfDay] : undefined;
  const effectiveMinTime = preferredTime ?? timeOfDayBounds?.min;
  const effectiveMaxTime = preferredTimeBefore ?? timeOfDayBounds?.max;
  const hasAnyDateOrTime = preferredDate || preferredDateAfter || effectiveMinTime || effectiveMaxTime;

  // First turn after the appointment is resolved, nothing given yet: ask once, inviting both day
  // and time together, before defaulting to "soonest overall".
  if (!hasAnyDateOrTime && workingIncoming.rescheduleAsked !== 'true') {
    const message = isEn
      ? 'What day, and what time, would work for you?'
      : 'Jaki dzień, i o której godzinie, Państwu odpowiada?';
    return elicitSlot(
      'RescheduleIntent',
      'preferredDate',
      workingSlots,
      { ...workingIncoming, lastMessageText: message, rescheduleAsked: 'true' },
      message,
    );
  }

  try {
    if (preferredDate) {
      let times = await downstream(record, () => findAvailableTimesForDate(specialty, preferredDate, abort));
      if (effectiveMinTime) times = times.filter((t) => t >= effectiveMinTime);
      if (effectiveMaxTime) times = times.filter((t) => t <= effectiveMaxTime);
      if (times.length === 0) return proposeNearest(effectiveMinTime, effectiveMaxTime, preferredDate);
      const earliest = times[0];
      const message = isEn
        ? `${specialtyLabel(specialty, isEn)}, ${dayLabel(oldDate, isEn)} at ${spokenTime(oldTime, isEn)}, ` +
          `to ${dayLabel(preferredDate, isEn)} at ${spokenTime(earliest, isEn)}. Is that correct?`
        : `${specialty}, ${dayLabel(oldDate, isEn)}, godzina ${spokenTime(oldTime, isEn)}, ` +
          `na ${dayLabel(preferredDate, isEn)}, godzina ${spokenTime(earliest, isEn)}. Czy się zgadza?`;
      return confirmIntent(
        'RescheduleIntent',
        workingSlots,
        { ...workingIncoming, lastMessageText: message, rescheduleDate: preferredDate, rescheduleTime: earliest },
        message,
      );
    }
    return await proposeNearest(effectiveMinTime, effectiveMaxTime, preferredDateAfter);
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
    return redirectToAuth('RescheduleIntent', incoming, isEn);
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
  const { pendingIntent, ...rest } = sessionAttributes;
  const confirmedMessage = isEn ? 'Thank you. Your identity has been confirmed.' : 'Dziękuję. Tożsamość została potwierdzona.';
  const authenticated = { ...rest, lastMessageText: confirmedMessage };
  if (pendingIntent === 'BookingIntent') return handleBookingDialog({}, authenticated, record, isEn);
  if (pendingIntent === 'CancelAppointmentIntent') return handleCancelDialog({}, authenticated, record, isEn);
  if (pendingIntent === 'RescheduleIntent') return handleRescheduleDialog({}, authenticated, record, isEn);
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
      return handleBookingDialog(slots, incoming, record, isEn, event.sessionState.intent.confirmationState);
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
      return handleRescheduleDialog(slots, incoming, record, isEn, event.sessionState.intent.confirmationState);
    }
    return handleRescheduleFulfillment(slots, incoming, record, isEn);
  }

  if (intentName === 'ListAppointmentsIntent') {
    if (incoming.authenticated !== 'true') {
      return redirectToAuth('ListAppointmentsIntent', incoming, isEn);
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
