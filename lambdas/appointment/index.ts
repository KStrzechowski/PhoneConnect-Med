const baseUrl = (): string => process.env.MOCK_BASE_URL as string;

export const findAvailableDays = async (specialty: string, timeOfDay: string, signal: AbortSignal): Promise<string[]> => {
  const url = `${baseUrl()}/appointment/days?specialty=${encodeURIComponent(specialty)}&timeOfDay=${encodeURIComponent(timeOfDay)}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`GET /appointment/days failed: ${response.status}`);
  const body = (await response.json()) as { days: string[] };
  return body.days;
};

export const findAvailableTimes = async (
  specialty: string,
  timeOfDay: string | null,
  date: string,
  signal: AbortSignal,
): Promise<string[]> => {
  const url =
    `${baseUrl()}/appointment/times?specialty=${encodeURIComponent(specialty)}` +
    (timeOfDay ? `&timeOfDay=${encodeURIComponent(timeOfDay)}` : '') +
    `&date=${encodeURIComponent(date)}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`GET /appointment/times failed: ${response.status}`);
  const body = (await response.json()) as { times: string[] };
  return body.times;
};

export const findAvailableTimesForDate = (
  specialty: string,
  date: string,
  signal: AbortSignal,
): Promise<string[]> => findAvailableTimes(specialty, null, date, signal);

export const findNearestAvailable = async (
  specialty: string,
  signal: AbortSignal,
  minTime?: string,
): Promise<{ date: string; time: string } | null> => {
  const url =
    `${baseUrl()}/appointment/nearest?specialty=${encodeURIComponent(specialty)}` +
    (minTime ? `&minTime=${encodeURIComponent(minTime)}` : '');
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`GET /appointment/nearest failed: ${response.status}`);
  const body = (await response.json()) as { nearest: { date: string; time: string } | null };
  return body.nearest;
};

export const resolveTimeForDate = async (
  specialty: string,
  date: string,
  timeChoice: number,
  signal: AbortSignal,
): Promise<{ time: string | null }> => {
  const times = await findAvailableTimesForDate(specialty, date, signal);
  return { time: times[timeChoice - 1] ?? null };
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

export const listAppointments = async (
  patientId: number,
  signal: AbortSignal,
): Promise<{ specialty: string; date: string; time: string }[]> => {
  const url = `${baseUrl()}/appointment/mine?patientId=${encodeURIComponent(String(patientId))}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`GET /appointment/mine failed: ${response.status}`);
  const body = (await response.json()) as { appointments: { specialty: string; date: string; time: string }[] };
  return body.appointments;
};

export const formatDayLabel = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
};

export const formatDayLabelEn = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
};

const HOUR_WORDS_PL = [
  'zerowa', 'pierwsza', 'druga', 'trzecia', 'czwarta', 'piąta', 'szósta', 'siódma', 'ósma',
  'dziewiąta', 'dziesiąta', 'jedenasta', 'dwunasta', 'trzynasta', 'czternasta', 'piętnasta',
  'szesnasta', 'siedemnasta', 'osiemnasta', 'dziewiętnasta', 'dwudziesta', 'dwudziesta pierwsza',
  'dwudziesta druga', 'dwudziesta trzecia',
];

const HOUR_WORDS_PL_GENITIVE = [
  'zerowej', 'pierwszej', 'drugiej', 'trzeciej', 'czwartej', 'piątej', 'szóstej', 'siódmej', 'ósmej',
  'dziewiątej', 'dziesiątej', 'jedenastej', 'dwunastej', 'trzynastej', 'czternastej', 'piętnastej',
  'szesnastej', 'siedemnastej', 'osiemnastej', 'dziewiętnastej', 'dwudziestej', 'dwudziestej pierwszej',
  'dwudziestej drugiej', 'dwudziestej trzeciej',
];

export const ssmlTime = (time: string, locale: string = 'pl'): string => {
  const [hour, minute] = time.split(':').map(Number);
  if (locale === 'en') {
    return minute === 0
      ? `<say-as interpret-as="cardinal">${hour}</say-as>`
      : `<say-as interpret-as="cardinal">${hour}</say-as> <say-as interpret-as="cardinal">${minute}</say-as>`;
  }
  return minute === 0
    ? HOUR_WORDS_PL[hour]
    : `${HOUR_WORDS_PL[hour]} <say-as interpret-as="cardinal">${minute}</say-as>`;
};

export const ssmlOpeningHour = (time: string, locale: string = 'pl'): string => {
  if (locale === 'en') return ssmlTime(time, 'en');
  const [hour, minute] = time.split(':').map(Number);
  return minute === 0
    ? HOUR_WORDS_PL_GENITIVE[hour]
    : `${HOUR_WORDS_PL_GENITIVE[hour]} <say-as interpret-as="cardinal">${minute}</say-as>`;
};

export const joinNumbered = (items: string[]): string =>
  items.map((item, index) => `${index + 1} - ${item}`).join(', ');

export const joinList = (items: string[]): string => items.join('. ');

export const specialtyDisplayNamesEn: Record<string, string> = {
  kardiolog: 'Cardiology',
  dermatolog: 'Dermatology',
  okulista: 'Ophthalmology',
  laryngolog: 'ENT',
  neurolog: 'Neurology',
  ortopeda: 'Orthopedics',
  internista: 'Internal Medicine',
  ginekolog: 'Gynecology',
  pediatra: 'Pediatrics',
  endokrynolog: 'Endocrinology',
  chirurg: 'Surgery',
  urolog: 'Urology',
  psychiatra: 'Psychiatry',
  alergolog: 'Allergology',
  reumatolog: 'Rheumatology',
};

export const bookAppointment = async (
  specialty: string,
  timeOfDay: string | null,
  date: string,
  time: string,
  patientId: number,
  signal: AbortSignal,
): Promise<boolean> => {
  const response = await fetch(`${baseUrl()}/appointment/book`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(timeOfDay ? { specialty, timeOfDay, date, time, patientId } : { specialty, date, time, patientId }),
    signal,
  });
  if (!response.ok) throw new Error(`POST /appointment/book failed: ${response.status}`);
  const body = (await response.json()) as { booked: boolean };
  return body.booked;
};

export const resolveAppointment = async (
  patientId: number,
  selectedSlot: number,
  signal: AbortSignal,
): Promise<{ specialty: string; date: string; time: string } | null> => {
  const appointments = await listAppointments(patientId, signal);
  return appointments[selectedSlot - 1] ?? null;
};

export const cancelAppointment = async (
  date: string,
  time: string,
  patientId: number,
  signal: AbortSignal,
): Promise<boolean> => {
  const response = await fetch(`${baseUrl()}/appointment/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ date, time, patientId }),
    signal,
  });
  if (!response.ok) throw new Error(`POST /appointment/cancel failed: ${response.status}`);
  const body = (await response.json()) as { cancelled: boolean };
  return body.cancelled;
};

export const rescheduleAppointment = async (
  patientId: number,
  oldDate: string,
  oldTime: string,
  specialty: string,
  timeOfDay: string,
  newDate: string,
  newTime: string,
  signal: AbortSignal,
): Promise<{ rescheduled: boolean; oldSlotReleased: boolean }> => {
  const booked = await bookAppointment(specialty, timeOfDay, newDate, newTime, patientId, signal);
  if (!booked) return { rescheduled: false, oldSlotReleased: false };
  const oldSlotReleased = await cancelAppointment(oldDate, oldTime, patientId, signal);
  return { rescheduled: true, oldSlotReleased };
};
