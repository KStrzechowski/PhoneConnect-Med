import { LexEvent, LexResponse } from '../shared/types';
import {
  HisApiClient,
  formatSlots,
  formatDateTime,
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
      'Przełożenie wizyty wymaga zalogowania.',
      { requireAuth: 'true' });
  }

  const appointmentId = getSlotValue(event, 'WizytaId') || getSessionAttr(event, 'rescheduleTargetId') || '';
  const timeOfDay = (getSlotValue(event, 'NowaPoraDnia') || 'rano') as 'rano' | 'południe' | 'popołudnie';

  const his = await HisApiClient.create();

  // If no appointment ID, fetch and list active ones
  if (!appointmentId) {
    try {
      const appointments = await his.getAppointments(patientPesel);
      const active = appointments.filter(a => a.status === 'scheduled');
      if (!active.length) {
        return lexClose(event, 'Fulfilled', 'Nie masz żadnych aktywnych wizyt do przełożenia.');
      }
      if (active.length === 1) {
        // Auto-select the only appointment and fetch new slots
        const specialization = active[0].specialization;
        const slots = await his.getAvailableSlots(specialization, timeOfDay);
        const formatted = formatSlots(slots);
        return lexClose(event, 'Fulfilled',
          `Przełożenie wizyty u ${active[0].doctorName}. Dostępne nowe terminy: ${formatted}. Który wybierasz?`,
          {
            rescheduleTargetId: active[0].appointmentId,
            rescheduleSpecialization: specialization,
            availableSlots: JSON.stringify(slots.map(s => ({ slotId: s.slotId, dateTime: s.dateTime }))),
          });
      }
      return lexClose(event, 'Fulfilled',
        `Masz ${active.length} wizyt. Którą chcesz przełożyć? Powiedz numer wizyty.`,
        { rescheduleCandidates: JSON.stringify(active.map((a, i) => ({ num: i + 1, id: a.appointmentId, spec: a.specialization }))) });
    } catch (err) {
      console.error('reschedule fetch error', err);
      return lexClose(event, 'Failed', 'Wystąpił problem. Proszę spróbować później.');
    }
  }

  // If we have appointment ID but user is selecting a new slot
  const availableSlotsJson = getSessionAttr(event, 'availableSlots') || '[]';
  const selectedTermin = getSlotValue(event, 'WybranyTermin') || '';
  let newSlotId: string | undefined;

  try {
    const slots: Array<{ slotId: string; dateTime: string }> = JSON.parse(availableSlotsJson);
    if (slots.length > 0 && selectedTermin) {
      const num = parseInt(selectedTermin, 10);
      if (!isNaN(num) && num >= 1 && num <= slots.length) {
        newSlotId = slots[num - 1].slotId;
      } else {
        newSlotId = slots[0].slotId;
      }
    } else if (slots.length > 0) {
      // Fetch slots first
      const specialization = getSessionAttr(event, 'rescheduleSpecialization') || '';
      const newSlots = await his.getAvailableSlots(specialization, timeOfDay);
      const formatted = formatSlots(newSlots);
      return lexClose(event, 'Fulfilled',
        `Dostępne nowe terminy: ${formatted}. Który wybierasz?`,
        { availableSlots: JSON.stringify(newSlots.map(s => ({ slotId: s.slotId, dateTime: s.dateTime }))) });
    }
  } catch {
    newSlotId = undefined;
  }

  if (!newSlotId) {
    return lexClose(event, 'Failed',
      'Nie udało się rozpoznać wybranego terminu. Proszę spróbować ponownie.');
  }

  try {
    const appointment = await his.rescheduleAppointment(appointmentId, newSlotId);
    await logCall(contactId, 'APPOINTMENT_RESCHEDULED', {
      pesel: patientPesel,
      appointmentId,
      newSlotId,
      newDateTime: appointment.dateTime,
    });

    return lexClose(event, 'Fulfilled',
      `Wizyta została przełożona. Nowy termin: ${formatDateTime(appointment.dateTime)}. Czy mogę jeszcze w czymś pomóc?`);
  } catch (err) {
    console.error('reschedule error', err);
    await logCall(contactId, 'RESCHEDULE_ERROR', { error: String(err) });
    return lexClose(event, 'Failed',
      'Wystąpił problem z przełożeniem wizyty. Proszę spróbować później.');
  }
};
