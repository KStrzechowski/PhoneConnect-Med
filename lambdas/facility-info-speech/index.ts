import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { measured, downstream, type ConnectEvent, type InvocationRecord } from '@pcm/measure';
import { fetchFacility } from '@pcm/facility';
import { beginOtpChallenge, generateOtpCode, verifyOtpCode } from '@pcm/patient';
import { findAvailableDays, findAvailableTimes, resolveDay, resolveTime, bookAppointment } from '@pcm/appointment';

const sns = new SNSClient({});
const RESEND_DIGIT = '9';
const BOOKING_ATTEMPT_LIMIT = 3;

type LexSlots = Record<string, { value?: { interpretedValue?: string } } | null>;

type LexEvent = {
  invocationSource: 'DialogCodeHook' | 'FulfillmentCodeHook';
  sessionState: {
    sessionAttributes?: Record<string, string>;
    intent: { name: string; slots?: LexSlots };
  };
};

type LexCloseResponse = {
  sessionState: {
    dialogAction: { type: 'Close' };
    intent: { name: string; state: 'Fulfilled' };
    sessionAttributes: Record<string, string>;
  };
  messages: [{ contentType: 'PlainText'; content: string }];
};

type LexElicitSlotResponse = {
  sessionState: {
    dialogAction: { type: 'ElicitSlot'; slotToElicit: string };
    intent: { name: string; slots: LexSlots; state: 'InProgress' };
    sessionAttributes: Record<string, string>;
  };
  messages: [{ contentType: 'PlainText'; content: string }];
};

type LexConfirmIntentResponse = {
  sessionState: {
    dialogAction: { type: 'ConfirmIntent' };
    intent: { name: string; slots: LexSlots; state: 'InProgress' };
    sessionAttributes: Record<string, string>;
  };
  messages: [{ contentType: 'PlainText'; content: string }];
};

type LexDelegateResponse = {
  sessionState: {
    dialogAction: { type: 'Delegate' };
    intent: { name: string; slots: LexSlots; state: 'InProgress' };
    sessionAttributes: Record<string, string>;
  };
};

type LexResponse = LexCloseResponse | LexElicitSlotResponse | LexConfirmIntentResponse | LexDelegateResponse;

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
  messages: [{ contentType: 'PlainText', content: message }],
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
  messages: [{ contentType: 'PlainText', content: message }],
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
  messages: [{ contentType: 'PlainText', content: message }],
});

const delegate = (intentName: string, slots: LexSlots, sessionAttributes: Record<string, string>): LexDelegateResponse => ({
  sessionState: {
    dialogAction: { type: 'Delegate' },
    intent: { name: intentName, slots, state: 'InProgress' },
    sessionAttributes,
  },
});

const formatDayLabel = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
};

const handleBookingDialog = async (
  slots: LexSlots,
  incoming: Record<string, string>,
  record: InvocationRecord,
): Promise<LexResponse> => {
  const specialty = slots.specialty?.value?.interpretedValue;
  const timeOfDay = slots.timeOfDay?.value?.interpretedValue;

  if (incoming.authenticated !== 'true') {
    const message = 'Aby umówić wizytę, proszę się najpierw zidentyfikować.';
    return close('BookingIntent', { ...incoming, lastMessageText: message, needsAuth: 'true' }, message);
  }

  if (!specialty || !timeOfDay) {
    return delegate('BookingIntent', slots, incoming);
  }

  const stage = incoming.bookingStage ?? '';
  const attempts = Number(incoming.bookingAttempts ?? '0');
  const abort = AbortSignal.timeout(1000);

  const giveUp = async (): Promise<LexResponse> => {
    const message = 'Nie udało się umówić wizyty. Łączę z konsultantem.';
    return close('BookingIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
  };

  const retry = (slotName: string, message: string, extra: Record<string, string> = {}): LexResponse =>
    elicitSlot(
      'BookingIntent',
      slotName,
      { ...slots, [slotName]: null },
      { ...incoming, lastMessageText: message, bookingAttempts: String(attempts + 1), ...extra },
      message,
    );

  if (stage === '' || stage === 'confirm') {
    try {
      const days = await downstream(record, () => findAvailableDays(specialty, timeOfDay, abort));
      if (days.length === 0) {
        if (attempts + 1 >= BOOKING_ATTEMPT_LIMIT) return giveUp();
        const message =
          'Brak wolnych terminów dla wybranej specjalizacji i pory dnia. Proszę podać inną specjalizację lub porę dnia.';
        return elicitSlot(
          'BookingIntent',
          'specialty',
          { ...slots, specialty: null, timeOfDay: null },
          { ...incoming, lastMessageText: message, bookingStage: '', bookingAttempts: String(attempts + 1) },
          message,
        );
      }
      const options = days.map((d, i) => `${i + 1} - ${formatDayLabel(d)}`).join(', ');
      const message = `Mam wolne terminy: ${options}. Który termin Pani/Panu odpowiada? Proszę podać numer.`;
      return elicitSlot(
        'BookingIntent',
        'selectedSlot',
        { ...slots, selectedSlot: null },
        { ...incoming, lastMessageText: message, bookingStage: 'day', bookingAttempts: '0' },
        message,
      );
    } catch (error) {
      record.outcome = 'error';
      record.error = String(error);
      const message = 'Przepraszam, mam teraz problem z wyszukaniem terminów. Łączę z konsultantem.';
      return close('BookingIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
    }
  }

  if (stage === 'day') {
    const dayChoice = Number(slots.selectedSlot?.value?.interpretedValue ?? '');
    try {
      const { date } = await downstream(record, () => resolveDay(specialty, timeOfDay, dayChoice, abort));
      if (date === null) {
        if (attempts + 1 >= BOOKING_ATTEMPT_LIMIT) return giveUp();
        return retry('selectedSlot', 'Nie rozpoznałem podanego numeru terminu. Proszę spróbować jeszcze raz.');
      }
      const times = await downstream(record, () => findAvailableTimes(specialty, timeOfDay, date, abort));
      const options = times.map((t, i) => `${i + 1} - godzina ${t}`).join(', ');
      const message = `${formatDayLabel(date)}: ${options}. Którą godzinę Pani/Pan wybiera?`;
      return elicitSlot(
        'BookingIntent',
        'selectedSlot',
        { ...slots, selectedSlot: null },
        { ...incoming, lastMessageText: message, bookingStage: 'time', bookingDate: date, bookingAttempts: '0' },
        message,
      );
    } catch (error) {
      record.outcome = 'error';
      record.error = String(error);
      const message = 'Przepraszam, mam teraz problem z wyszukaniem terminów. Łączę z konsultantem.';
      return close('BookingIntent', { ...incoming, lastMessageText: message, transfer: 'true' }, message);
    }
  }

  const timeChoice = Number(slots.selectedSlot?.value?.interpretedValue ?? '');
  const date = incoming.bookingDate ?? '';
  try {
    const { time } = await downstream(record, () => resolveTime(specialty, timeOfDay, date, timeChoice, abort));
    if (time === null) {
      if (attempts + 1 >= BOOKING_ATTEMPT_LIMIT) return giveUp();
      return retry('selectedSlot', 'Nie rozpoznałem podanej godziny. Proszę spróbować jeszcze raz.');
    }
    const message = `Umawiam Panią/Pana do ${specialty}, ${formatDayLabel(date)}, godzina ${time}. Czy się zgadza?`;
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
};

const handleBookingFulfillment = async (
  slots: LexSlots,
  incoming: Record<string, string>,
  record: InvocationRecord,
): Promise<LexCloseResponse> => {
  if (incoming.authenticated !== 'true') {
    const message = 'Aby umówić wizytę, proszę się najpierw zidentyfikować.';
    return close('BookingIntent', { ...incoming, lastMessageText: message, needsAuth: 'true' }, message);
  }

  const specialty = slots.specialty?.value?.interpretedValue ?? '';
  const timeOfDay = slots.timeOfDay?.value?.interpretedValue ?? '';
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
      bookAppointment(specialty, timeOfDay, date, time, patientId, AbortSignal.timeout(1000)),
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

const dispatch = async (event: LexEvent, record: InvocationRecord): Promise<LexResponse> => {
  const intentName = event.sessionState.intent.name;
  const incoming = event.sessionState.sessionAttributes ?? {};

  if (intentName === 'InfoIntent') {
    try {
      const facility = await downstream(record, () => fetchFacility(AbortSignal.timeout(1000)));
      const message = `Nasz adres to ${facility.address}. Jesteśmy czynni od ${facility.opensAt} do ${facility.closesAt}, ${facility.openDays}.`;
      return close(intentName, { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
    } catch (error) {
      record.outcome = 'error';
      record.error = String(error);
      const message = 'Przepraszam, mam teraz problem z pobraniem tych informacji. Łączę z konsultantem.';
      return close(intentName, { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
    }
  }

  if (intentName === 'AuthIntent') {
    const pesel = event.sessionState.intent.slots?.pesel?.value?.interpretedValue ?? '';
    const phone = event.sessionState.intent.slots?.phone?.value?.interpretedValue ?? '';
    const callerNumber = incoming.callerNumber ?? '';
    try {
      const result = await downstream(record, () =>
        beginOtpChallenge(pesel, phone, callerNumber, AbortSignal.timeout(1000)),
      );
      if ('authenticated' in result) {
        record.authPath = 'caller-id';
        const message = 'Dziękuję. Tożsamość została potwierdzona.';
        return close(
          intentName,
          {
            ...incoming,
            lastMessageText: message,
            fallbackCount: '0',
            authenticated: 'true',
            patientId: String(result.patientId),
          },
          message,
        );
      }
      if (!result.isDemo) {
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
      const message = 'Kod weryfikacyjny został wysłany na podany numer telefonu.';
      return close(
        intentName,
        {
          ...incoming,
          lastMessageText: message,
          fallbackCount: '0',
          otpRequired: 'true',
          isDemo: String(result.isDemo),
          code: result.code ?? '',
          phone: result.phone ?? '',
          patientId: result.patientId !== undefined ? String(result.patientId) : '',
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

    if (entered === RESEND_DIGIT) {
      const freshCode = isDemo ? expectedCode : generateOtpCode();
      if (!isDemo) {
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
      return close(
        intentName,
        { ...incoming, lastMessageText: message, fallbackCount: '0', code: freshCode },
        message,
      );
    }

    if (verifyOtpCode(expectedCode === '' ? null : expectedCode, entered)) {
      record.authPath = isDemo ? 'demo' : 'otp';
      const message = 'Dziękuję. Tożsamość została potwierdzona.';
      return close(
        intentName,
        { ...incoming, lastMessageText: message, fallbackCount: '0', authenticated: 'true', patientId },
        message,
      );
    }

    const message = 'Podany kod jest nieprawidłowy.';
    return close(
      intentName,
      { ...incoming, lastMessageText: message, fallbackCount: '0', otpMismatch: 'true' },
      message,
    );
  }

  if (intentName === 'BookingIntent') {
    const slots = event.sessionState.intent.slots ?? {};
    if (event.invocationSource === 'DialogCodeHook') {
      return handleBookingDialog(slots, incoming, record);
    }
    return handleBookingFulfillment(slots, incoming, record);
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
    return close(intentName, { ...incoming, lastMessageText: message, fallbackCount: '0' }, message);
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
