import { LexEvent, LexResponse } from '../shared/types';
import {
  HisApiClient,
  formatAppointments,
  logCall,
  lexClose,
  getSlotValue,
  getSessionAttr,
} from '../shared/utils';

export const handler = async (event: LexEvent): Promise<LexResponse> => {
  const contactId = getSessionAttr(event, 'contactId') || event.sessionId;
  const patientPesel = getSessionAttr(event, 'patientPesel') || '';
  const authenticated = getSessionAttr(event, 'authenticated') === 'true';

  if (!authenticated || !patientPesel) {
    return lexClose(event, 'Failed',
      'Odwołanie wizyty wymaga zalogowania.',
      { requireAuth: 'true' });
  }

  const his = await HisApiClient.create();

  // If no appointment ID yet, fetch and read them out
  let appointmentId = getSlotValue(event, 'WizytaId') || getSessionAttr(event, 'cancelTargetId') || '';

  if (!appointmentId) {
    try {
      const appointments = await his.getAppointments(patientPesel);
      const active = appointments.filter(a => a.status === 'scheduled');

      if (!active.length) {
        return lexClose(event, 'Fulfilled',
          'Nie masz żadnych aktywnych wizyt do odwołania.');
      }

      if (active.length === 1) {
        appointmentId = active[0].appointmentId;
      } else {
        const formatted = formatAppointments(active);
        return lexClose(event, 'Fulfilled',
          `Masz kilka wizyt: ${formatted}. Którą wizytę chcesz odwołać? Powiedz numer wizyty.`,
          { cancelCandidates: JSON.stringify(active.map(a => ({ id: a.appointmentId, dateTime: a.dateTime }))) });
      }
    } catch (err) {
      console.error('cancel fetch error', err);
      return lexClose(event, 'Failed',
        'Wystąpił problem z pobraniem wizyt. Proszę spróbować później.');
    }
  }

  try {
    await his.cancelAppointment(appointmentId);
    await logCall(contactId, 'APPOINTMENT_CANCELLED', { pesel: patientPesel, appointmentId });

    return lexClose(event, 'Fulfilled',
      'Wizyta została odwołana. Czy mogę jeszcze w czymś pomóc?');
  } catch (err) {
    console.error('cancel-appointment error', err);
    await logCall(contactId, 'CANCEL_APPOINTMENT_ERROR', { error: String(err), appointmentId });
    return lexClose(event, 'Failed',
      'Wystąpił problem z odwołaniem wizyty. Proszę spróbować później lub skontaktować się z rejestracją.');
  }
};
