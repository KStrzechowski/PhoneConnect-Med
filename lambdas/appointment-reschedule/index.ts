import { measured, downstream } from '@pcm/measure';
import {
  listAppointments,
  resolveAppointment,
  resolveDay,
  resolveTime,
  findAvailableDays,
  findAvailableTimes,
  rescheduleAppointment,
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
  'appointment-reschedule',
  async (event, record): Promise<Record<string, string>> => {
    const {
      step = '',
      selectedSlot = '',
      timeOfDay = '',
      dayChoice = '',
      timeChoice = '',
      authenticated = '',
      patientId = '',
      locale = 'pl',
    } = event.Details?.Parameters ?? {};

    if (authenticated !== 'true') return { needsAuth: 'true' };

    const dayLabel = locale === 'en' ? formatDayLabelEn : formatDayLabel;

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

      if (step === 'days') {
        const appointment = await downstream(record, () =>
          resolveAppointment(Number(patientId), Number(selectedSlot), abort),
        );
        if (appointment === null) return { reachable: 'true', found: 'false' };
        const days = await downstream(record, () => findAvailableDays(appointment.specialty, timeOfDay, abort));
        if (days.length === 0) return { reachable: 'true', found: 'true', available: 'false' };
        return {
          reachable: 'true',
          found: 'true',
          available: 'true',
          day1: days[0] ? dayLabel(days[0]) : '',
          day2: days[1] ? dayLabel(days[1]) : '',
          day3: days[2] ? dayLabel(days[2]) : '',
        };
      }

      if (step === 'times') {
        const appointment = await downstream(record, () =>
          resolveAppointment(Number(patientId), Number(selectedSlot), abort),
        );
        if (appointment === null) return { reachable: 'true', found: 'false' };
        const { date } = await downstream(record, () =>
          resolveDay(appointment.specialty, timeOfDay, Number(dayChoice), abort),
        );
        if (date === null) return { reachable: 'true', found: 'true', available: 'false' };
        const times = await downstream(record, () => findAvailableTimes(appointment.specialty, timeOfDay, date, abort));
        if (times.length === 0) return { reachable: 'true', found: 'true', available: 'false' };
        return {
          reachable: 'true',
          found: 'true',
          available: 'true',
          date,
          time1: times[0] ?? '',
          time2: times[1] ?? '',
          time3: times[2] ?? '',
        };
      }

      if (step === 'confirm') {
        const appointment = await downstream(record, () =>
          resolveAppointment(Number(patientId), Number(selectedSlot), abort),
        );
        if (appointment === null) return { reachable: 'true', found: 'false' };
        const { date } = await downstream(record, () =>
          resolveDay(appointment.specialty, timeOfDay, Number(dayChoice), abort),
        );
        if (date === null) return { reachable: 'true', found: 'true', available: 'false' };
        const { time } = await downstream(record, () =>
          resolveTime(appointment.specialty, timeOfDay, date, Number(timeChoice), abort),
        );
        if (time === null) return { reachable: 'true', found: 'true', available: 'false' };
        const message =
          locale === 'en'
            ? `${formatAppointment(appointment, locale)}, to ${dayLabel(date)}, at ${time}`
            : `${formatAppointment(appointment, locale)}, na ${dayLabel(date)}, godzina ${time}`;
        return {
          reachable: 'true',
          found: 'true',
          available: 'true',
          date,
          time,
          message,
        };
      }

      if (step === 'reschedule') {
        const appointment = await downstream(record, () =>
          resolveAppointment(Number(patientId), Number(selectedSlot), abort),
        );
        if (appointment === null) return { reachable: 'true', found: 'false' };
        const { date } = await downstream(record, () =>
          resolveDay(appointment.specialty, timeOfDay, Number(dayChoice), abort),
        );
        if (date === null) return { reachable: 'true', found: 'true', available: 'false' };
        const { time } = await downstream(record, () =>
          resolveTime(appointment.specialty, timeOfDay, date, Number(timeChoice), abort),
        );
        if (time === null) return { reachable: 'true', found: 'true', available: 'false' };
        const result = await downstream(record, () =>
          rescheduleAppointment(
            Number(patientId),
            appointment.date,
            appointment.time,
            appointment.specialty,
            timeOfDay,
            date,
            time,
            abort,
          ),
        );
        return { reachable: 'true', found: 'true', available: 'true', rescheduled: String(result.rescheduled) };
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
