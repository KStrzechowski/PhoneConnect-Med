import { LexEvent, LexResponse } from '../shared/types';
import {
  HisApiClient,
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
      'Rejestracja wymaga zalogowania.',
      { requireAuth: 'true' });
  }

  // Resolve selected slot
  const selectedTermin = getSlotValue(event, 'WybranyTermin') || '';
  const availableSlotsJson = getSessionAttr(event, 'availableSlots') || '[]';

  let slotId: string | undefined;

  try {
    const slots: Array<{ slotId: string; doctorName: string; dateTime: string }> = JSON.parse(availableSlotsJson);

    if (slots.length === 0) {
      return lexClose(event, 'Failed',
        'Brak dostępnych terminów do zarezerwowania. Proszę rozpocząć wyszukiwanie od nowa.');
    }

    // Try to match by number (1, 2, 3) or "first", "second", etc.
    if (selectedTermin) {
      const num = parseInt(selectedTermin, 10);
      if (!isNaN(num) && num >= 1 && num <= slots.length) {
        slotId = slots[num - 1].slotId;
      } else {
        // Try keyword matching
        const lower = selectedTermin.toLowerCase();
        if (lower.includes('pierw') || lower.includes('jeden') || lower.includes('1')) slotId = slots[0]?.slotId;
        else if (lower.includes('drugi') || lower.includes('dwa') || lower.includes('2')) slotId = slots[1]?.slotId;
        else if (lower.includes('trzeci') || lower.includes('trzy') || lower.includes('3')) slotId = slots[2]?.slotId;
        else slotId = slots[0]?.slotId; // default to first
      }
    } else {
      slotId = slots[0]?.slotId;
    }
  } catch {
    slotId = undefined;
  }

  if (!slotId) {
    return lexClose(event, 'Failed',
      'Nie udało się rozpoznać wybranego terminu. Proszę spróbować ponownie.');
  }

  try {
    const his = await HisApiClient.create();
    const appointment = await his.bookAppointment(patientPesel, slotId);

    await logCall(contactId, 'APPOINTMENT_BOOKED', {
      pesel: patientPesel,
      appointmentId: appointment.appointmentId,
      dateTime: appointment.dateTime,
    });

    const dateFormatted = formatDateTime(appointment.dateTime);

    return lexClose(event, 'Fulfilled',
      `Wizyta została zarezerwowana. ${appointment.specialization} u doktora ${appointment.doctorName}, ` +
      `${dateFormatted}, ${appointment.facilityName}, ${appointment.facilityAddress}. ` +
      'Czy mogę jeszcze w czymś pomóc?',
      { lastBookedAppointmentId: appointment.appointmentId });
  } catch (err) {
    console.error('book-appointment error', err);
    await logCall(contactId, 'BOOK_APPOINTMENT_ERROR', { error: String(err), slotId });
    return lexClose(event, 'Failed',
      'Wystąpił problem z rezerwacją wizyty. Proszę spróbować później lub skontaktować się z rejestracją.');
  }
};
