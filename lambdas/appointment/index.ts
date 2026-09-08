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
  timeOfDay: string,
  date: string,
  signal: AbortSignal,
): Promise<string[]> => {
  const url =
    `${baseUrl()}/appointment/times?specialty=${encodeURIComponent(specialty)}` +
    `&timeOfDay=${encodeURIComponent(timeOfDay)}&date=${encodeURIComponent(date)}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`GET /appointment/times failed: ${response.status}`);
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
