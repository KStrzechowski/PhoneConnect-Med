import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { measured, downstream, type ConnectEvent, type InvocationRecord } from '@pcm/measure';
import { fetchFacility, openDaysEn, ssmlAddress } from '@pcm/facility';
import { beginOtpChallenge, generateOtpCode, verifyOtpCode } from '@pcm/patient';
import {
  findAvailableDays,
  findAvailableTimes,
  findAvailableTimesForDate,
  findNearestAvailable,
  resolveDay,
  resolveTime,
  bookAppointment,
  listAppointments,
  resolveAppointment,
  cancelAppointment,
  rescheduleAppointment,
  formatDayLabel,
  ssmlTime,
  ssmlOpeningHour,
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

const redirectToAuth = (pendingIntent: string, incoming: Record<string, string>): LexElicitSlotResponse => {
  const message =
    `${AUTH_REDIRECT_PREFIXES[pendingIntent]} ` +
    'Wprowadź numer PESEL na klawiaturze telefonu, a następnie naciśnij krzyżyk.';
  return elicitSlot('AuthIntent', 'pesel', {}, { ...incoming, lastMessageText: message, pendingIntent }, message);
};

const handleBookingDialog = async (
  slots: LexSlots,
  incoming: Record<string, string>,
  record: InvocationRecord,
  confirmationState?: 'None' | 'Confirmed' | 'Denied',
): Promise<LexResponse> => {
  const specialty = slots.specialty?.value?.interpretedValue;

  if (incoming.authenticated !== 'true') {
    return redirectToAuth('BookingIntent', incoming);
  }

  if (!specialty) {
    return delegate('BookingIntent', slots, incoming);
  }

  if (confirmationState === 'Confirmed') {
    return handleBookingFulfillment(slots, incoming, record);
  }

  if (
    confirmationState === 'Denied' &&
    !slots.preferredDate?.value?.interpretedValue &&
    !slots.preferredDateAfter?.value?.interpretedValue &&
    !slots.preferredTime?.value?.interpretedValue &&
    !slots.preferredTimeBefore?.value?.interpretedValue &&
    !slots.preferredTimeOfDay?.value?.interpretedValue
  ) {
    const message = 'Dobrze, wybierzmy inny termin. Jaki dzień Państwu odpowiada?';
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
        selectedSlot: null,
        selectedTime: null,
      },
      { ...incoming, lastMessageText: message, bookingStage: '' },
      message,
    );
  }

  const stage = incoming.bookingStage ?? '';
  const attempts = Number(incoming.bookingAttempts ?? '0');
  const abort = AbortSignal.timeout(7000);

  const giveUp = async (): Promise<LexResponse> => {
    const message = 'Nie udało się umówić wizyty. Łączę z konsultantem.';
    return close('BookingIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  };

  const proposeNearest = async (minTime?: string, maxTime?: string, minDate?: string): Promise<LexResponse> => {
    const nearest = await downstream(record, () => findNearestAvailable(specialty, abort, minTime, maxTime, minDate));
    if (nearest === null) {
      if (attempts + 1 >= BOOKING_ATTEMPT_LIMIT) return giveUp();
      const message = 'Brak wolnych terminów dla wybranej specjalizacji. Proszę podać inną specjalizację.';
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
        { ...incoming, lastMessageText: message, bookingStage: '', bookingAttempts: String(attempts + 1) },
        message,
      );
    }
    const message =
      `Najbliższy wolny termin do ${specialty} to ${formatDayLabel(nearest.date)}, godzina ${ssmlTime(nearest.time)}. ` +
      'Czy to Państwu odpowiada?';
    return confirmIntent(
      'BookingIntent',
      slots,
      {
        ...incoming,
        lastMessageText: message,
        bookingStage: 'confirm',
        bookingDate: nearest.date,
        bookingTime: nearest.time,
      },
      message,
    );
  };

  const directTime = slots.selectedTime?.value?.interpretedValue;
  if (stage === 'time' && (slots.selectedSlot?.value?.interpretedValue || directTime)) {
    const date = incoming.bookingDate ?? '';
    try {
      let time: string | null;
      if (directTime) {
        const times = await downstream(record, () => findAvailableTimesForDate(specialty, date, abort));
        time = times.includes(directTime) ? directTime : null;
      } else {
        // AMAZON.Number reliably parses a spoken hour word ("jedenasta" -> 11) but not as an
        // index into a 2-3 item list, so a caller repeating the hour back (rather than saying
        // "drugi") resolves to a number that's out of range as a position. Try the hour itself
        // against the offered times before giving up.
        const timeChoice = Number(slots.selectedSlot!.value!.interpretedValue);
        const times = await downstream(record, () => findAvailableTimesForDate(specialty, date, abort));
        const byHour = times.find((t) => Number(t.slice(0, 2)) === timeChoice);
        time = times[timeChoice - 1] ?? byHour ?? null;
      }
      if (time === null) {
        if (attempts + 1 >= BOOKING_ATTEMPT_LIMIT) return giveUp();
        const message = 'Nie rozpoznałem podanej godziny. Proszę spróbować jeszcze raz.';
        return elicitSlot(
          'BookingIntent',
          'selectedSlot',
          { ...slots, selectedSlot: null, selectedTime: null },
          { ...incoming, lastMessageText: message, bookingAttempts: String(attempts + 1) },
          message,
        );
      }
      const message = `Umawiam Państwa do ${specialty}, ${formatDayLabel(date)}, godzina ${ssmlTime(time)}. Czy się zgadza?`;
      return confirmIntent(
        'BookingIntent',
        slots,
        { ...incoming, lastMessageText: message, bookingStage: 'confirm', bookingTime: time },
        message,
      );
    } catch (error) {
      record.outcome = 'error';
      record.error = String(error);
      const message = 'Przepraszam, mam teraz problem z wyszukaniem terminów. Łączę z konsultantem.';
      return close('BookingIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
    }
  }

  // Initial turn, and any turn after a decline — decline always resets preferredDate/preferredTime/
  // selectedSlot, so the stage value doesn't matter here; we always re-derive from what's filled now.
  const preferredDate = slots.preferredDate?.value?.interpretedValue;
  const preferredDateAfter = slots.preferredDateAfter?.value?.interpretedValue;
  const preferredTime = slots.preferredTime?.value?.interpretedValue;
  const preferredTimeBefore = slots.preferredTimeBefore?.value?.interpretedValue;
  const preferredTimeOfDay = slots.preferredTimeOfDay?.value?.interpretedValue;
  const timeOfDayBounds = preferredTimeOfDay ? TIME_OF_DAY_BOUNDS[preferredTimeOfDay] : undefined;
  const effectiveMinTime = preferredTime ?? timeOfDayBounds?.min;
  const effectiveMaxTime = preferredTimeBefore ?? timeOfDayBounds?.max;
  try {
    if (preferredDate) {
      let times = await downstream(record, () => findAvailableTimesForDate(specialty, preferredDate, abort));
      if (effectiveMinTime) times = times.filter((t) => t >= effectiveMinTime);
      if (effectiveMaxTime) times = times.filter((t) => t <= effectiveMaxTime);
      if (times.length === 0) return proposeNearest(effectiveMinTime, effectiveMaxTime, preferredDate);
      if (times.length === 1) {
        const message =
          `Umawiam Państwa do ${specialty}, ${formatDayLabel(preferredDate)}, godzina ${ssmlTime(times[0])}. ` +
          'Czy się zgadza?';
        return confirmIntent(
          'BookingIntent',
          slots,
          {
            ...incoming,
            lastMessageText: message,
            bookingStage: 'confirm',
            bookingDate: preferredDate,
            bookingTime: times[0],
          },
          message,
        );
      }
      const options = times.map((t, i) => `${i + 1} - godzina ${ssmlTime(t)}`).join(', ');
      const message = `${formatDayLabel(preferredDate)}: ${options}. Którą godzinę Państwo wybierają?`;
      return elicitSlot(
        'BookingIntent',
        'selectedSlot',
        { ...slots, selectedSlot: null, selectedTime: null },
        { ...incoming, lastMessageText: message, bookingStage: 'time', bookingDate: preferredDate, bookingAttempts: '0' },
        message,
      );
    }
    return await proposeNearest(effectiveMinTime, effectiveMaxTime, preferredDateAfter);
  } catch (error) {
    record.outcome = 'error';
    record.error = String(error);
    const message = 'Przepraszam, mam teraz problem z wyszukaniem terminów. Łączę z konsultantem.';
    return close('BookingIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  }
};

const handleBookingFulfillment = async (
  slots: LexSlots,
  incoming: Record<string, string>,
  record: InvocationRecord,
): Promise<LexResponse> => {
  if (incoming.authenticated !== 'true') {
    return redirectToAuth('BookingIntent', incoming);
  }

  const specialty = slots.specialty?.value?.interpretedValue ?? '';
  const date = incoming.bookingDate ?? '';
  const time = incoming.bookingTime ?? '';
  if (!incoming.patientId) {
    const message = 'Przepraszam, mam teraz problem z umówieniem wizyty. Łączę z konsultantem.';
    record.outcome = 'error';
    record.error = 'missing patientId';
    return close('BookingIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  }
  const patientId = Number(incoming.patientId);

  try {
    const booked = await downstream(record, () =>
      bookAppointment(specialty, null, date, time, patientId, AbortSignal.timeout(7000)),
    );
    const message = booked
      ? 'Wizyta została umówiona. Dziękuję.'
      : 'Niestety ten termin został już zajęty. Proszę spróbować ponownie.';
    return close('BookingIntent', { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
  } catch (error) {
    record.outcome = 'error';
    record.error = String(error);
    const message = 'Przepraszam, mam teraz problem z umówieniem wizyty. Łączę z konsultantem.';
    return close('BookingIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  }
};

const handleCancelDialog = async (
  slots: LexSlots,
  incoming: Record<string, string>,
  record: InvocationRecord,
  confirmationState?: 'None' | 'Confirmed' | 'Denied',
): Promise<LexResponse> => {
  if (incoming.authenticated !== 'true') {
    return redirectToAuth('CancelAppointmentIntent', incoming);
  }

  if (confirmationState === 'Confirmed') {
    return handleCancelFulfillment(slots, incoming, record);
  }

  if (confirmationState === 'Denied') {
    const message = 'Dobrze, zostawiam tę wizytę bez zmian.';
    return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
  }

  const stage = incoming.cancelStage ?? '';
  const attempts = Number(incoming.cancelAttempts ?? '0');
  const abort = AbortSignal.timeout(7000);
  const patientId = Number(incoming.patientId);

  const giveUp = async (): Promise<LexResponse> => {
    const message = 'Nie udało się odwołać wizyty. Łączę z konsultantem.';
    return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  };

  if (stage === '') {
    try {
      const appointments = await downstream(record, () => listAppointments(patientId, abort));
      if (appointments.length === 0) {
        const message = 'Nie mają Państwo żadnych zaplanowanych wizyt.';
        return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
      }
      const options = appointments
        .slice(0, 3)
        .map((a, i) => `${i + 1} - ${a.specialty}, ${formatDayLabel(a.date)}, godzina ${ssmlTime(a.time)}`)
        .join('. ');
      const message = `Które wizyty Państwo chcą odwołać? ${options}. Proszę podać numer.`;
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
      const message = 'Przepraszam, mam teraz problem z pobraniem listy wizyt. Łączę z konsultantem.';
      return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
    }
  }

  const selectedSlot = Number(slots.selectedSlot?.value?.interpretedValue ?? '');
  try {
    const appointment = await downstream(record, () => resolveAppointment(patientId, selectedSlot, abort));
    if (appointment === null) {
      if (attempts + 1 >= CANCEL_ATTEMPT_LIMIT) return giveUp();
      const message = 'Nie rozpoznałem podanego numeru wizyty. Proszę spróbować jeszcze raz.';
      return elicitSlot(
        'CancelAppointmentIntent',
        'selectedSlot',
        { ...slots, selectedSlot: null },
        { ...incoming, lastMessageText: message, cancelAttempts: String(attempts + 1) },
        message,
      );
    }
    const message = `Odwołuję wizytę: ${appointment.specialty}, ${formatDayLabel(appointment.date)}, godzina ${ssmlTime(appointment.time)}. Czy się zgadza?`;
    return confirmIntent('CancelAppointmentIntent', slots, { ...incoming, lastMessageText: message }, message);
  } catch (error) {
    record.outcome = 'error';
    record.error = String(error);
    const message = 'Przepraszam, mam teraz problem z wyszukaniem wizyty. Łączę z konsultantem.';
    return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  }
};

const handleCancelFulfillment = async (
  slots: LexSlots,
  incoming: Record<string, string>,
  record: InvocationRecord,
): Promise<LexResponse> => {
  if (incoming.authenticated !== 'true') {
    return redirectToAuth('CancelAppointmentIntent', incoming);
  }

  const selectedSlot = Number(slots.selectedSlot?.value?.interpretedValue ?? '');
  if (!incoming.patientId) {
    const message = 'Przepraszam, mam teraz problem z odwołaniem wizyty. Łączę z konsultantem.';
    record.outcome = 'error';
    record.error = 'missing patientId';
    return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  }
  const patientId = Number(incoming.patientId);
  const abort = AbortSignal.timeout(7000);

  try {
    const appointment = await downstream(record, () => resolveAppointment(patientId, selectedSlot, abort));
    if (appointment === null) {
      const message = 'Nie udało się odwołać wizyty. Łączę z konsultantem.';
      record.outcome = 'error';
      record.error = 'appointment not found at fulfillment';
      return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
    }
    const cancelled = await downstream(record, () =>
      cancelAppointment(appointment.date, appointment.time, patientId, abort),
    );
    const message = cancelled
      ? 'Wizyta została odwołana. Dziękuję.'
      : 'Niestety nie udało się odwołać tej wizyty. Proszę spróbować ponownie.';
    return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
  } catch (error) {
    record.outcome = 'error';
    record.error = String(error);
    const message = 'Przepraszam, mam teraz problem z odwołaniem wizyty. Łączę z konsultantem.';
    return close('CancelAppointmentIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  }
};

const handleRescheduleDialog = async (
  slots: LexSlots,
  incoming: Record<string, string>,
  record: InvocationRecord,
  confirmationState?: 'None' | 'Confirmed' | 'Denied',
): Promise<LexResponse> => {
  if (incoming.authenticated !== 'true') {
    return redirectToAuth('RescheduleIntent', incoming);
  }

  if (confirmationState === 'Confirmed') {
    return handleRescheduleFulfillment(slots, incoming, record);
  }

  if (confirmationState === 'Denied') {
    return handleRescheduleDialog(
      { ...slots, selectedSlot: null },
      { ...incoming, rescheduleStage: '', rescheduleApptSelection: '', rescheduleDate: '' },
      record,
    );
  }

  const timeOfDay = slots.timeOfDay?.value?.interpretedValue;
  if (!timeOfDay) {
    return delegate('RescheduleIntent', slots, incoming);
  }

  const stage = incoming.rescheduleStage ?? '';
  const attempts = Number(incoming.rescheduleAttempts ?? '0');
  const abort = AbortSignal.timeout(7000);
  const patientId = Number(incoming.patientId);

  const giveUp = async (): Promise<LexResponse> => {
    const message = 'Nie udało się przełożyć wizyty. Łączę z konsultantem.';
    return close('RescheduleIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  };

  if (stage === '') {
    try {
      const appointments = await downstream(record, () => listAppointments(patientId, abort));
      if (appointments.length === 0) {
        const message = 'Nie mają Państwo żadnych zaplanowanych wizyt.';
        return close('RescheduleIntent', { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
      }
      const options = appointments
        .slice(0, 3)
        .map((a, i) => `${i + 1} - ${a.specialty}, ${formatDayLabel(a.date)}, godzina ${ssmlTime(a.time)}`)
        .join('. ');
      const message = `Którą wizytę Państwo chcą przełożyć? ${options}. Proszę podać numer.`;
      return elicitSlot(
        'RescheduleIntent',
        'selectedSlot',
        { ...slots, selectedSlot: null },
        { ...incoming, lastMessageText: message, rescheduleStage: 'select', rescheduleAttempts: '0' },
        message,
      );
    } catch (error) {
      record.outcome = 'error';
      record.error = String(error);
      const message = 'Przepraszam, mam teraz problem z pobraniem listy wizyt. Łączę z konsultantem.';
      return close('RescheduleIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
    }
  }

  if (stage === 'select' || stage === 'confirm') {
    const apptChoice = incoming.rescheduleApptSelection
      ? Number(incoming.rescheduleApptSelection)
      : Number(slots.selectedSlot?.value?.interpretedValue ?? '');
    try {
      const appointment = await downstream(record, () => resolveAppointment(patientId, apptChoice, abort));
      if (appointment === null) {
        if (attempts + 1 >= RESCHEDULE_ATTEMPT_LIMIT) return giveUp();
        const message = 'Nie rozpoznałem podanego numeru wizyty. Proszę spróbować jeszcze raz.';
        return elicitSlot(
          'RescheduleIntent',
          'selectedSlot',
          { ...slots, selectedSlot: null },
          { ...incoming, lastMessageText: message, rescheduleAttempts: String(attempts + 1) },
          message,
        );
      }
      const days = await downstream(record, () => findAvailableDays(appointment.specialty, timeOfDay, abort));
      if (days.length === 0) {
        if (attempts + 1 >= RESCHEDULE_ATTEMPT_LIMIT) return giveUp();
        const message = 'Brak wolnych terminów dla wybranej pory dnia. Proszę podać inną porę dnia.';
        return elicitSlot(
          'RescheduleIntent',
          'timeOfDay',
          { ...slots, timeOfDay: null },
          {
            ...incoming,
            lastMessageText: message,
            rescheduleApptSelection: String(apptChoice),
            rescheduleAttempts: String(attempts + 1),
          },
          message,
        );
      }
      const options = days.map((d, i) => `${i + 1} - ${formatDayLabel(d)}`).join(', ');
      const message = `Mam wolne terminy: ${options}. Który termin Państwu odpowiada? Proszę podać numer.`;
      return elicitSlot(
        'RescheduleIntent',
        'selectedSlot',
        { ...slots, selectedSlot: null },
        {
          ...incoming,
          lastMessageText: message,
          rescheduleApptSelection: String(apptChoice),
          rescheduleStage: 'day',
          rescheduleAttempts: '0',
        },
        message,
      );
    } catch (error) {
      record.outcome = 'error';
      record.error = String(error);
      const message = 'Przepraszam, mam teraz problem z wyszukaniem terminów. Łączę z konsultantem.';
      return close('RescheduleIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
    }
  }

  if (stage === 'day') {
    const apptChoice = Number(incoming.rescheduleApptSelection ?? '');
    const dayChoice = Number(slots.selectedSlot?.value?.interpretedValue ?? '');
    try {
      const appointment = await downstream(record, () => resolveAppointment(patientId, apptChoice, abort));
      if (appointment === null) return giveUp();
      const { date } = await downstream(record, () =>
        resolveDay(appointment.specialty, timeOfDay, dayChoice, abort),
      );
      if (date === null) {
        if (attempts + 1 >= RESCHEDULE_ATTEMPT_LIMIT) return giveUp();
        const message = 'Nie rozpoznałem podanego numeru terminu. Proszę spróbować jeszcze raz.';
        return elicitSlot(
          'RescheduleIntent',
          'selectedSlot',
          { ...slots, selectedSlot: null },
          { ...incoming, lastMessageText: message, rescheduleAttempts: String(attempts + 1) },
          message,
        );
      }
      const times = await downstream(record, () => findAvailableTimes(appointment.specialty, timeOfDay, date, abort));
      const options = times.map((t, i) => `${i + 1} - godzina ${ssmlTime(t)}`).join(', ');
      const message = `${formatDayLabel(date)}: ${options}. Którą godzinę Państwo wybierają?`;
      return elicitSlot(
        'RescheduleIntent',
        'selectedSlot',
        { ...slots, selectedSlot: null },
        {
          ...incoming,
          lastMessageText: message,
          rescheduleStage: 'time',
          rescheduleDate: date,
          rescheduleAttempts: '0',
        },
        message,
      );
    } catch (error) {
      record.outcome = 'error';
      record.error = String(error);
      const message = 'Przepraszam, mam teraz problem z wyszukaniem terminów. Łączę z konsultantem.';
      return close('RescheduleIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
    }
  }

  const apptChoice = Number(incoming.rescheduleApptSelection ?? '');
  const timeChoice = Number(slots.selectedSlot?.value?.interpretedValue ?? '');
  const date = incoming.rescheduleDate ?? '';
  try {
    const appointment = await downstream(record, () => resolveAppointment(patientId, apptChoice, abort));
    if (appointment === null) return giveUp();
    const { time } = await downstream(record, () =>
      resolveTime(appointment.specialty, timeOfDay, date, timeChoice, abort),
    );
    if (time === null) {
      if (attempts + 1 >= RESCHEDULE_ATTEMPT_LIMIT) return giveUp();
      const message = 'Nie rozpoznałem podanej godziny. Proszę spróbować jeszcze raz.';
      return elicitSlot(
        'RescheduleIntent',
        'selectedSlot',
        { ...slots, selectedSlot: null },
        { ...incoming, lastMessageText: message, rescheduleAttempts: String(attempts + 1) },
        message,
      );
    }
    const message =
      `${appointment.specialty}, ${formatDayLabel(appointment.date)}, godzina ${ssmlTime(appointment.time)}, ` +
      `na ${formatDayLabel(date)}, godzina ${ssmlTime(time)}. Czy się zgadza?`;
    return confirmIntent(
      'RescheduleIntent',
      slots,
      { ...incoming, lastMessageText: message, rescheduleStage: 'confirm', rescheduleTime: time },
      message,
    );
  } catch (error) {
    record.outcome = 'error';
    record.error = String(error);
    const message = 'Przepraszam, mam teraz problem z wyszukaniem terminów. Łączę z konsultantem.';
    return close('RescheduleIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  }
};

const handleRescheduleFulfillment = async (
  slots: LexSlots,
  incoming: Record<string, string>,
  record: InvocationRecord,
): Promise<LexResponse> => {
  if (incoming.authenticated !== 'true') {
    return redirectToAuth('RescheduleIntent', incoming);
  }

  const timeOfDay = slots.timeOfDay?.value?.interpretedValue ?? '';
  const date = incoming.rescheduleDate ?? '';
  const time = incoming.rescheduleTime ?? '';
  if (!incoming.patientId) {
    const message = 'Przepraszam, mam teraz problem z przełożeniem wizyty. Łączę z konsultantem.';
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
      const message = 'Nie udało się przełożyć wizyty. Łączę z konsultantem.';
      record.outcome = 'error';
      record.error = 'appointment not found at fulfillment';
      return close('RescheduleIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
    }
    const result = await downstream(record, () =>
      rescheduleAppointment(
        patientId,
        appointment.date,
        appointment.time,
        appointment.specialty,
        timeOfDay,
        date,
        time,
        abort,
      ),
    );
    const message = result.rescheduled
      ? 'Wizyta została przełożona. Dziękuję.'
      : 'Niestety ten termin został już zajęty. Proszę spróbować ponownie.';
    return close('RescheduleIntent', { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
  } catch (error) {
    record.outcome = 'error';
    record.error = String(error);
    const message = 'Przepraszam, mam teraz problem z przełożeniem wizyty. Łączę z konsultantem.';
    return close('RescheduleIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  }
};

const handleListAppointments = async (
  incoming: Record<string, string>,
  record: InvocationRecord,
): Promise<LexCloseResponse> => {
  try {
    const appointments = await downstream(record, () =>
      listAppointments(Number(incoming.patientId), AbortSignal.timeout(7000)),
    );
    if (appointments.length === 0) {
      const message = 'Nie mają Państwo żadnych zaplanowanych wizyt.';
      return close('ListAppointmentsIntent', { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
    }
    const lines = appointments
      .slice(0, 3)
      .map((a) => `${a.specialty}, ${formatDayLabel(a.date)}, godzina ${ssmlTime(a.time)}`)
      .join('. ');
    const overflow = appointments.length > 3 ? ' Mają Państwo więcej zaplanowanych wizyt.' : '';
    const message = `Najbliższe wizyty: ${lines}.${overflow}`;
    return close('ListAppointmentsIntent', { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
  } catch (error) {
    record.outcome = 'error';
    record.error = String(error);
    const message = 'Przepraszam, mam teraz problem z pobraniem listy wizyt. Łączę z konsultantem.';
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
): Promise<LexResponse> => {
  const { pendingIntent, ...rest } = sessionAttributes;
  const authenticated = { ...rest, lastMessageText: 'Dziękuję. Tożsamość została potwierdzona.' };
  if (pendingIntent === 'BookingIntent') return handleBookingDialog({}, authenticated, record);
  if (pendingIntent === 'CancelAppointmentIntent') return handleCancelDialog({}, authenticated, record);
  if (pendingIntent === 'RescheduleIntent') return handleRescheduleDialog({}, authenticated, record);
  if (pendingIntent === 'ListAppointmentsIntent') return handleListAppointments(authenticated, record);
  if (pendingIntent) {
    const message = 'Dziękuję. Tożsamość została potwierdzona. W czym jeszcze mogę pomóc?';
    return elicitIntent({ ...rest, lastMessageText: message }, message);
  }
  const message = 'Dziękuję. Tożsamość została potwierdzona.';
  return close(intentName, { ...rest, lastMessageText: message }, message);
};

const dispatch = async (event: LexEvent, record: InvocationRecord): Promise<LexResponse> => {
  const intentName = event.sessionState.intent.name;
  const incoming = event.sessionState.sessionAttributes ?? {};

  if (intentName === 'InfoIntent') {
    const isEn = event.bot?.localeId === 'en_US';
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
        }, record);
      }
      if (!result.isDemo && result.phone) {
        try {
          await downstream(record, () =>
            sns.send(
              new PublishCommand({
                PhoneNumber: result.phone ?? '',
                Message: `Twój kod weryfikacyjny PhoneConnect Med: ${result.code ?? ''}`,
              }),
            ),
          );
        } catch (error) {
          record.outcome = 'error';
          record.error = String(error);
        }
      }
      const message =
        'Kod weryfikacyjny został wysłany na podany numer telefonu. ' +
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
      const message = 'Przepraszam, mam teraz problem z weryfikacją tożsamości. Łączę z konsultantem.';
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
                Message: `Twój kod weryfikacyjny PhoneConnect Med: ${freshCode}`,
              }),
            ),
          );
        } catch (error) {
          record.outcome = 'error';
          record.error = String(error);
        }
      }
      const message = 'Wysłaliśmy nowy kod. Proszę wprowadzić go na klawiaturze telefonu.';
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
      }, record);
    }

    if (attempts + 1 >= OTP_MISMATCH_LIMIT) {
      const message = 'Nie udało się zweryfikować kodu. Łączę z konsultantem.';
      return close(
        intentName,
        { ...incoming, lastMessageText: message, fallbackCount: '0', transfer: 'true' },
        message,
      );
    }

    const message = 'Podany kod jest nieprawidłowy. Proszę spróbować jeszcze raz.';
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
      return handleBookingDialog(slots, incoming, record, event.sessionState.intent.confirmationState);
    }
    return handleBookingFulfillment(slots, incoming, record);
  }

  if (intentName === 'CancelAppointmentIntent') {
    const slots = event.sessionState.intent.slots ?? {};
    if (event.invocationSource === 'DialogCodeHook') {
      return handleCancelDialog(slots, incoming, record, event.sessionState.intent.confirmationState);
    }
    return handleCancelFulfillment(slots, incoming, record);
  }

  if (intentName === 'RescheduleIntent') {
    const slots = event.sessionState.intent.slots ?? {};
    if (event.invocationSource === 'DialogCodeHook') {
      return handleRescheduleDialog(slots, incoming, record, event.sessionState.intent.confirmationState);
    }
    return handleRescheduleFulfillment(slots, incoming, record);
  }

  if (intentName === 'ListAppointmentsIntent') {
    if (incoming.authenticated !== 'true') {
      return redirectToAuth('ListAppointmentsIntent', incoming);
    }
    return handleListAppointments(incoming, record);
  }

  if (intentName === 'MainMenuIntent') {
    const message =
      'Proszę powiedzieć, czego Pan lub Pani potrzebuje: adres i godziny otwarcia placówki, ' +
      'powtórzenie ostatniej wiadomości, albo połączenie z konsultantem.';
    return close(intentName, { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
  }

  if (intentName === 'RepeatLastMessageIntent') {
    const message = incoming.lastMessageText ?? 'Nie mam jeszcze nic do powtórzenia.';
    return close(intentName, { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
  }

  if (intentName === 'AgentTransferIntent') {
    const message = 'Już łączę z konsultantem.';
    return close(
      intentName,
      { ...incoming, lastMessageText: message, fallbackCount: '0', agentRequested: 'true' },
      message,
    );
  }

  const count = Number(incoming.fallbackCount ?? '0') + 1;
  const message = FALLBACK_MESSAGES[Math.min(count, FALLBACK_MESSAGES.length) - 1];
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
