import { LexEvent, LexResponse } from '../shared/types';
import {
  HisApiClient,
  formatSlots,
  logCall,
  lexClose,
  getSlotValue,
  getSessionAttr,
} from '../shared/utils';

export const handler = async (event: LexEvent): Promise<LexResponse> => {
  const contactId = getSessionAttr(event, 'contactId') || event.sessionId;
  const authenticated = getSessionAttr(event, 'authenticated') === 'true';

  if (!authenticated) {
    return lexClose(event, 'Failed',
      'Rejestracja wizyt wymaga zalogowania.',
      { requireAuth: 'true' });
  }

  const specialization = getSlotValue(event, 'Specjalizacja') || getSessionAttr(event, 'bookingSpecjalizacja') || '';
  const timeOfDay = (getSlotValue(event, 'PoraDnia') || getSessionAttr(event, 'bookingPoraDnia') || 'rano') as 'rano' | 'południe' | 'popołudnie';
  const offsetStr = getSessionAttr(event, 'slotsOffset') || '0';
  const offset = parseInt(offsetStr, 10);

  if (!specialization) {
    return lexClose(event, 'Failed',
      'Brak informacji o specjalizacji. Proszę rozpocząć rejestrację od nowa.');
  }

  try {
    const his = await HisApiClient.create();
    const slots = await his.getAvailableSlots(specialization, timeOfDay, offset);

    await logCall(contactId, 'SLOTS_FETCHED', { specialization, timeOfDay, offset, count: slots.length });

    if (!slots.length) {
      return lexClose(event, 'Fulfilled',
        `Brak dostępnych terminów dla specjalizacji ${specialization} w preferowanej porze dnia. ` +
        'Proszę skontaktować się z rejestracją lub wybrać inną porę dnia.',
        { noSlotsAvailable: 'true' });
    }

    const formatted = formatSlots(slots);
    const newOffset = String(offset + slots.length);

    // Save slots to session for later booking confirmation
    const slotsJson = JSON.stringify(slots.map(s => ({ slotId: s.slotId, doctorName: s.doctorName, dateTime: s.dateTime })));

    return lexClose(event, 'Fulfilled',
      `Dostępne terminy: ${formatted}. Który termin wybierasz? Możesz powiedzieć na przykład: ten pierwszy, ten o dziesiątej trzydzieści, lub: następne, żeby usłyszeć więcej terminów.`,
      {
        bookingSpecjalizacja: specialization,
        bookingPoraDnia: timeOfDay,
        slotsOffset: newOffset,
        availableSlots: slotsJson,
      });
  } catch (err) {
    console.error('get-slots error', err);
    await logCall(contactId, 'SLOTS_ERROR', { error: String(err) });
    return lexClose(event, 'Failed',
      'Wystąpił problem z pobraniem terminów. Proszę spróbować później.');
  }
};
