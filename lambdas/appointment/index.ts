const baseUrl = (): string => process.env.MOCK_BASE_URL as string;

export const findAvailableDays = async (specialty: string, timeOfDay: string, signal: AbortSignal): Promise<string[]> => {
  const url = `${baseUrl()}/appointment/days?specialty=${encodeURIComponent(specialty)}&timeOfDay=${encodeURIComponent(timeOfDay)}`;
  const response = await fetch(url, { signal });
  const body = (await response.json()) as { days: string[] };
  return body.days;
};

export const findAvailableTimes = async (
  specialty: string,
  timeOfDay: string,
  date: string,
  signal: AbortSignal,
): Promise<string[]> => {
  const url =
    `${baseUrl()}/appointment/times?specialty=${encodeURIComponent(specialty)}` +
    `&timeOfDay=${encodeURIComponent(timeOfDay)}&date=${encodeURIComponent(date)}`;
  const response = await fetch(url, { signal });
  const body = (await response.json()) as { times: string[] };
  return body.times;
};

export const resolveDay = async (
  specialty: string,
  timeOfDay: string,
  dayChoice: number,
  signal: AbortSignal,
): Promise<{ date: string | null }> => {
  const days = await findAvailableDays(specialty, timeOfDay, signal);
  return { date: days[dayChoice - 1] ?? null };
};

export const resolveTime = async (
  specialty: string,
  timeOfDay: string,
  date: string,
  timeChoice: number,
  signal: AbortSignal,
): Promise<{ time: string | null }> => {
  const times = await findAvailableTimes(specialty, timeOfDay, date, signal);
  return { time: times[timeChoice - 1] ?? null };
};

export const bookAppointment = async (
  specialty: string,
  timeOfDay: string,
  date: string,
  time: string,
  patientId: number,
  signal: AbortSignal,
): Promise<boolean> => {
  const response = await fetch(`${baseUrl()}/appointment/book`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ specialty, timeOfDay, date, time, patientId }),
    signal,
  });
  const body = (await response.json()) as { booked: boolean };
  return body.booked;
};
