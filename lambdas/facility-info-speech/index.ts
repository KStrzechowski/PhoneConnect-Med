import { measured, downstream, type ConnectEvent, type InvocationRecord } from '@pcm/measure';
import { fetchFacility } from '@pcm/facility';
import { authenticate } from '@pcm/patient';

type LexEvent = {
  invocationSource: 'FulfillmentCodeHook';
  sessionState: {
    sessionAttributes?: Record<string, string>;
    intent: { name: string; slots?: Record<string, { value?: { interpretedValue?: string } } | null> };
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

const dispatch = async (event: LexEvent, record: InvocationRecord): Promise<LexCloseResponse> => {
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
        authenticate(pesel, phone, callerNumber, AbortSignal.timeout(1000)),
      );
      if (result.authenticated) {
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
      record.outcome = 'transferred';
      const message = 'Kod weryfikacyjny został wysłany na podany numer telefonu.';
      return close(
        intentName,
        { ...incoming, lastMessageText: message, fallbackCount: '0', transfer: 'true' },
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

export const handler = (event: LexEvent): Promise<LexCloseResponse> => {
  const contactId = event.sessionState.sessionAttributes?.contactId;
  const synthetic: ConnectEvent = {
    Details: {
      ContactData: contactId ? { ContactId: contactId } : undefined,
      Parameters: { variant: 'speech' },
    },
  };

  return measured('facility-info-speech', (_synthetic, record) => dispatch(event, record))(synthetic);
};
