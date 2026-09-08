import { measured, downstream } from '@pcm/measure';
import { listAppointments, formatDayLabel, formatDayLabelEn, specialtyDisplayNamesEn } from '@pcm/appointment';

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

    const abort = AbortSignal.timeout(1000);
    try {
      const appointments = await downstream(record, () => listAppointments(Number(patientId), abort));
      if (appointments.length === 0) return { reachable: 'true', hasAppointments: 'false' };
      return {
        reachable: 'true',
        hasAppointments: 'true',
        hasMore: String(appointments.length > 3),
        appt1: appointments[0] ? formatAppointment(appointments[0], locale) : '',
        appt2: appointments[1] ? formatAppointment(appointments[1], locale) : '',
        appt3: appointments[2] ? formatAppointment(appointments[2], locale) : '',
      };
    } catch (error) {
      const message = String(error);
      record.outcome = 'error';
      record.error = message;
      return { reachable: 'false', error: message };
    }
  },
);
