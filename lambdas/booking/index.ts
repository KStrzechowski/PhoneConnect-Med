import { measured, downstream } from '@pcm/measure';
import { findAvailableDays, findAvailableTimes, resolveDay, resolveTime, bookAppointment } from '@pcm/appointment';

const formatDayLabel = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
};

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
    } = event.Details?.Parameters ?? {};

    if (authenticated !== 'true') return { needsAuth: 'true' };

    const abort = AbortSignal.timeout(1000);
    try {
      if (step === 'days') {
        const days = await downstream(record, () => findAvailableDays(specialty, timeOfDay, abort));
        if (days.length === 0) return { reachable: 'true', available: 'false' };
        return {
          reachable: 'true',
          available: 'true',
          day1: days[0] ? formatDayLabel(days[0]) : '',
          day2: days[1] ? formatDayLabel(days[1]) : '',
          day3: days[2] ? formatDayLabel(days[2]) : '',
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
          date,
          time1: times[0] ?? '',
          time2: times[1] ?? '',
          time3: times[2] ?? '',
        };
      }

      if (step === 'confirm') {
        const { date } = await downstream(record, () => resolveDay(specialty, timeOfDay, Number(dayChoice), abort));
        if (date === null) return { reachable: 'true', available: 'false' };
        const { time } = await downstream(record, () =>
          resolveTime(specialty, timeOfDay, date, Number(timeChoice), abort),
        );
        if (time === null) return { reachable: 'true', available: 'false' };
        return {
          reachable: 'true',
          available: 'true',
          date,
          time,
          message: `Umawiam wizytę: ${specialty}, ${formatDayLabel(date)}, godzina ${time}.`,
        };
      }

      if (step === 'book') {
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
