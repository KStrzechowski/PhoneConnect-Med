import { measured, downstream } from '@pcm/measure';
import { listAppointments, formatDayLabel, formatDayLabelEn, specialtyDisplayNamesEn, joinList } from '@pcm/appointment';

const formatAppointment = (
  appointment: { specialty: string; date: string; time: string },
  locale: string,
): string =>
  locale === 'en'
    ? `${specialtyDisplayNamesEn[appointment.specialty] ?? appointment.specialty}, ${formatDayLabelEn(appointment.date)}, at ${appointment.time}`
    : `${appointment.specialty}, ${formatDayLabel(appointment.date)}, godzina ${appointment.time}`;

export const handler = measured(
  'appointment-list',
  async (event, record): Promise<Record<string, string>> => {
    const { authenticated = '', patientId = '', locale = 'pl' } = event.Details?.Parameters ?? {};

    if (authenticated !== 'true') return { needsAuth: 'true' };

    const abort = AbortSignal.timeout(7000);
    try {
      const appointments = await downstream(record, () => listAppointments(Number(patientId), abort));
      if (appointments.length === 0) return { reachable: 'true', hasAppointments: 'false' };
      return {
        reachable: 'true',
        hasAppointments: 'true',
        hasMore: String(appointments.length > 3),
        apptsList: joinList(appointments.slice(0, 3).map((a) => formatAppointment(a, locale))),
      };
    } catch (error) {
      const message = String(error);
      record.outcome = 'error';
      record.error = message;
      return { reachable: 'false', error: message };
    }
  },
);
