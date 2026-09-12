import { measured, downstream } from '@pcm/measure';
import {
  findAvailableDays,
  findAvailableTimes,
  resolveDay,
  resolveTime,
  bookAppointment,
  formatDayLabel,
  formatDayLabelEn,
  specialtyDisplayNamesEn,
  ssmlTime,
  joinNumbered,
} from '@pcm/appointment';

export const handler = measured(
  'booking',
  async (event, record): Promise<Record<string, string>> => {
    const {
      step = '',
      specialty = '',
      timeOfDay = '',
      dayChoice = '',
      timeChoice = '',
      authenticated = '',
      patientId = '',
      locale = 'pl',
    } = event.Details?.Parameters ?? {};

    const dayLabel = locale === 'en' ? formatDayLabelEn : formatDayLabel;

    if (authenticated !== 'true') return { needsAuth: 'true' };

    const abort = AbortSignal.timeout(7000);
    try {
      if (step === 'days') {
        const days = await downstream(record, () => findAvailableDays(specialty, timeOfDay, abort));
        if (days.length === 0) return { reachable: 'true', available: 'false' };
        return {
          reachable: 'true',
          available: 'true',
          daysList: joinNumbered(days.slice(0, 3).map(dayLabel)),
        };
      }

      if (step === 'times') {
        const { date } = await downstream(record, () => resolveDay(specialty, timeOfDay, Number(dayChoice), abort));
        if (date === null) return { reachable: 'true', available: 'false' };
        const times = await downstream(record, () => findAvailableTimes(specialty, timeOfDay, date, abort));
        if (times.length === 0) return { reachable: 'true', available: 'false' };
        return {
          reachable: 'true',
          available: 'true',
          date: dayLabel(date),
          timesList: joinNumbered(times.slice(0, 3).map(ssmlTime)),
        };
      }

      if (step === 'confirm') {
        const { date } = await downstream(record, () => resolveDay(specialty, timeOfDay, Number(dayChoice), abort));
        if (date === null) return { reachable: 'true', available: 'false' };
        const { time } = await downstream(record, () =>
          resolveTime(specialty, timeOfDay, date, Number(timeChoice), abort),
        );
        if (time === null) return { reachable: 'true', available: 'false' };
        const message =
          locale === 'en'
            ? `Booking: ${specialtyDisplayNamesEn[specialty] ?? specialty}, ${dayLabel(date)}, at ${ssmlTime(time)}`
            : `Umawiam wizytę: ${specialty}, ${dayLabel(date)}, godzina ${ssmlTime(time)}`;
        return {
          reachable: 'true',
          available: 'true',
          date,
          time,
          message,
        };
      }

      if (step === 'book') {
        if (!patientId) {
          const message = 'missing patientId';
          record.outcome = 'error';
          record.error = message;
          return { reachable: 'false', error: message };
        }
        const { date } = await downstream(record, () => resolveDay(specialty, timeOfDay, Number(dayChoice), abort));
        if (date === null) return { reachable: 'true', available: 'false' };
        const { time } = await downstream(record, () =>
          resolveTime(specialty, timeOfDay, date, Number(timeChoice), abort),
        );
        if (time === null) return { reachable: 'true', available: 'false' };
        const booked = await downstream(record, () =>
          bookAppointment(specialty, timeOfDay, date, time, Number(patientId), abort),
        );
        return { reachable: 'true', booked: String(booked) };
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
