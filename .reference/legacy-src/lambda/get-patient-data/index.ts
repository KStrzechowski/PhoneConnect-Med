import { LexEvent, LexResponse } from '../shared/types';
import {
  HisApiClient,
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
      'Dostęp do danych wymaga wcześniejszego zalogowania.',
      { requireAuth: 'true' });
  }

  try {
    const his = await HisApiClient.create();
    const patient = await his.getPatient(patientPesel);

    if (!patient) {
      await logCall(contactId, 'PATIENT_NOT_FOUND', { pesel: patientPesel });
      return lexClose(event, 'Failed',
        'Nie znaleziono danych pacjenta w systemie. Proszę skontaktować się z rejestracją.');
    }

    await logCall(contactId, 'PATIENT_DATA_FETCHED', { pesel: patientPesel });

    const msg = `Twoje dane: imię i nazwisko – ${patient.firstName} ${patient.lastName}, ` +
      `PESEL – ${patient.pesel}, ` +
      `telefon – ${patient.phoneNumber}` +
      (patient.address ? `, adres – ${patient.address.street}, ${patient.address.city}` : '') +
      '. Czy mogę jeszcze w czymś pomóc?';

    return lexClose(event, 'Fulfilled', msg);
  } catch (err) {
    console.error('get-patient-data error', err);
    await logCall(contactId, 'PATIENT_DATA_ERROR', { error: String(err) });
    return lexClose(event, 'Failed',
      'Wystąpił problem z pobraniem danych. Proszę spróbować później.');
  }
};
