import { measured, downstream } from '@pcm/measure';
import {
  listAppointments,
  resolveAppointment,
  cancelAppointment,
  formatDayLabel,
  formatDayLabelEn,
  specialtyDisplayNamesEn,
} from '@pcm/appointment';

const formatAppointment = (
  appointment: { specialty: string; date: string; time: string },
  locale: string,
): string =>
  locale === 'en'
    ? `${specialtyDisplayNamesEn[appointment.specialty] ?? appointment.specialty}, ${formatDayLabelEn(appointment.date)}, at ${appointment.time}`
    : `${appointment.specialty}, ${formatDayLabel(appointment.date)}, godzina ${appointment.time}`;

export const handler = measured(
  'appointment-cancel',
  async (event, record): Promise<Record<string, string>> => {
    const {
      step = '',
      selectedSlot = '',
      authenticated = '',
      patientId = '',
      locale = 'pl',
    } = event.Details?.Parameters ?? {};

    if (authenticated !== 'true') return { needsAuth: 'true' };

    const abort = AbortSignal.timeout(1000);
    try {
      if (step === 'list') {
        const appointments = await downstream(record, () => listAppointments(Number(patientId), abort));
        if (appointments.length === 0) return { reachable: 'true', hasAppointments: 'false' };
        return {
          reachable: 'true',
          hasAppointments: 'true',
          appt1: appointments[0] ? formatAppointment(appointments[0], locale) : '',
          appt2: appointments[1] ? formatAppointment(appointments[1], locale) : '',
          appt3: appointments[2] ? formatAppointment(appointments[2], locale) : '',
        };
      }

      if (step === 'confirm') {
        const appointment = await downstream(record, () =>
          resolveAppointment(Number(patientId), Number(selectedSlot), abort),
        );
        if (appointment === null) return { reachable: 'true', found: 'false' };
        return { reachable: 'true', found: 'true', message: formatAppointment(appointment, locale) };
      }

      if (step === 'cancel') {
        const appointment = await downstream(record, () =>
          resolveAppointment(Number(patientId), Number(selectedSlot), abort),
        );
        if (appointment === null) return { reachable: 'true', found: 'false' };
        const cancelled = await downstream(record, () =>
          cancelAppointment(appointment.date, appointment.time, Number(patientId), abort),
        );
        return { reachable: 'true', found: 'true', cancelled: String(cancelled) };
      }

      return { reachable: 'true', error: 'unknown step' };
    } catch (error) {
      const message = String(error);
      record.outcome = 'error';
      record.error = message;
      return { reachable: 'false', error: message };
    }
  },
);
