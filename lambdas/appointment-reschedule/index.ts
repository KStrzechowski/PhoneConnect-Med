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
} from '@pcm/appointment';

const formatAppointment = (appointment: { specialty: string; date: string; time: string }): string =>
  `${appointment.specialty}, ${formatDayLabel(appointment.date)}, godzina ${appointment.time}`;

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
          appt1: appointments[0] ? formatAppointment(appointments[0]) : '',
          appt2: appointments[1] ? formatAppointment(appointments[1]) : '',
          appt3: appointments[2] ? formatAppointment(appointments[2]) : '',
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
          day1: days[0] ? formatDayLabel(days[0]) : '',
          day2: days[1] ? formatDayLabel(days[1]) : '',
          day3: days[2] ? formatDayLabel(days[2]) : '',
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
        return {
          reachable: 'true',
          found: 'true',
          available: 'true',
          date,
          time,
          message: `${formatAppointment(appointment)}, na ${formatDayLabel(date)}, godzina ${time}`,
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
