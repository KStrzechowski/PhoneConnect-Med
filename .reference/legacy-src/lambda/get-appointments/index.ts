import { LexEvent, LexResponse } from '../shared/types';
import {
  HisApiClient,
  formatAppointments,
  logCall,
  lexClose,
  getSessionAttr,
} from '../shared/utils';

export const handler = async (event: LexEvent): Promise<LexResponse> => {
  const contactId = getSessionAttr(event, 'contactId') || event.sessionId;
  const patientPesel = getSessionAttr(event, 'patientPesel') || '';
  const authenticated = getSessionAttr(event, 'authenticated') === 'true';

  if (!authenticated || !patientPesel) {
    return lexClose(event, 'Failed',
      'Dostęp do wizyt wymaga wcześniejszego zalogowania.',
      { requireAuth: 'true' });
  }

  try {
    const his = await HisApiClient.create();
    const appointments = await his.getAppointments(patientPesel);
    const formatted = formatAppointments(appointments);

    await logCall(contactId, 'APPOINTMENTS_FETCHED', { pesel: patientPesel, count: appointments.length });

    return lexClose(event, 'Fulfilled',
      `${formatted} Czy mogę jeszcze w czymś pomóc?`);
  } catch (err) {
    console.error('get-appointments error', err);
    await logCall(contactId, 'APPOINTMENTS_ERROR', { error: String(err) });
    return lexClose(event, 'Failed',
      'Wystąpił problem z pobraniem wizyt. Proszę spróbować później.');
  }
};
