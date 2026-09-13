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
  ssmlTime,
  joinNumbered,
} from '@pcm/appointment';

const formatAppointment = (
  appointment: { specialty: string; date: string; time: string },
  locale: string,
): string =>
  locale === 'en'
    ? `${specialtyDisplayNamesEn[appointment.specialty] ?? appointment.specialty}, ${formatDayLabelEn(appointment.date)}, at ${ssmlTime(appointment.time, locale)}`
    : `${appointment.specialty}, ${formatDayLabel(appointment.date)}, godzina ${ssmlTime(appointment.time, locale)}`;

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

    const abort = AbortSignal.timeout(7000);
    try {
      if (step === 'list') {
        const appointments = await downstream(record, () => listAppointments(Number(patientId), abort));
        if (appointments.length === 0) return { reachable: 'true', hasAppointments: 'false' };
        return {
          reachable: 'true',
          hasAppointments: 'true',
          apptsList: joinNumbered(appointments.slice(0, 3).map((a) => formatAppointment(a, locale))),
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
          daysList: joinNumbered(days.slice(0, 3).map(dayLabel)),
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
          date: dayLabel(date),
          timesList: joinNumbered(times.slice(0, 3).map((t) => ssmlTime(t, locale))),
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
            ? `${formatAppointment(appointment, locale)}, to ${dayLabel(date)}, at ${ssmlTime(time, locale)}`
            : `${formatAppointment(appointment, locale)}, na ${dayLabel(date)}, godzina ${ssmlTime(time, locale)}`;
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
