import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import {
  LexEvent,
  LexResponse,
  LexMessage,
  Patient,
  Appointment,
  TimeSlot,
  FacilityConfig,
  OtpSession,
} from './types';

// ============================================================
// AWS CLIENTS
// ============================================================

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-central-1' });
export const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || 'eu-central-1' });

// ============================================================
// SECRETS MANAGER
// ============================================================

let cachedHisSecret: { apiKey: string; baseUrl: string } | null = null;

export async function getHisConfig(): Promise<{ apiKey: string; baseUrl: string }> {
  if (cachedHisSecret) return cachedHisSecret;

  const secretName = process.env.HIS_SECRET_NAME || 'infolinia/his-api';
  const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretName }));

  if (!response.SecretString) {
    throw new Error('HIS secret not found or empty');
  }

  cachedHisSecret = JSON.parse(response.SecretString);
  return cachedHisSecret!;
}

// ============================================================
// HIS API CLIENT
// ============================================================

export class HisApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  static async create(): Promise<HisApiClient> {
    const hisApiUrl = process.env.HIS_API_URL;
    if (hisApiUrl) {
      // Use environment variable URL (mock in PoC)
      return new HisApiClient(hisApiUrl, 'mock-key');
    }
    const config = await getHisConfig();
    return new HisApiClient(config.baseUrl, config.apiKey);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HIS API error ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  async getPatient(pesel: string): Promise<Patient | null> {
    try {
      return await this.request<Patient>('GET', `/patients/${pesel}`);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('404')) return null;
      throw err;
    }
  }

  async verifyPatient(pesel: string, phoneNumber: string): Promise<boolean> {
    try {
      const patient = await this.getPatient(pesel);
      if (!patient) return false;
      // Normalize phone number comparison (strip country code, spaces)
      const normalize = (p: string) => p.replace(/[\s\-\+]/g, '').replace(/^48/, '');
      return normalize(patient.phoneNumber) === normalize(phoneNumber);
    } catch {
      return false;
    }
  }

  async getAppointments(pesel: string): Promise<Appointment[]> {
    return this.request<Appointment[]>('GET', `/appointments?pesel=${pesel}`);
  }

  async getAvailableSlots(
    specialization: string,
    timeOfDay: 'rano' | 'południe' | 'popołudnie',
    offset = 0
  ): Promise<TimeSlot[]> {
    const params = new URLSearchParams({
      specialization,
      timeOfDay,
      limit: '3',
      offset: String(offset),
    });
    return this.request<TimeSlot[]>('GET', `/slots?${params}`);
  }

  async bookAppointment(pesel: string, slotId: string): Promise<Appointment> {
    return this.request<Appointment>('POST', '/appointments', { pesel, slotId });
  }

  async cancelAppointment(appointmentId: string): Promise<void> {
    await this.request<void>('DELETE', `/appointments/${appointmentId}`);
  }

  async rescheduleAppointment(appointmentId: string, newSlotId: string): Promise<Appointment> {
    return this.request<Appointment>('PUT', `/appointments/${appointmentId}`, { newSlotId });
  }

  async getFacilityConfig(phoneNumber: string): Promise<FacilityConfig | null> {
    try {
      return await this.request<FacilityConfig>('GET', `/facilities/${encodeURIComponent(phoneNumber)}`);
    } catch {
      return null;
    }
  }
}

// ============================================================
// DYNAMODB HELPERS
// ============================================================

const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'infolinia-sessions';
const CALL_LOGS_TABLE = process.env.CALL_LOGS_TABLE || 'infolinia-call-logs';
const FACILITY_TABLE = process.env.FACILITY_TABLE || 'infolinia-facilities';

export async function saveOtpSession(session: OtpSession): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: SESSIONS_TABLE,
    Item: session,
  }));
}

export async function getOtpSession(sessionId: string): Promise<OtpSession | null> {
  const result = await ddb.send(new GetCommand({
    TableName: SESSIONS_TABLE,
    Key: { sessionId },
  }));
  return (result.Item as OtpSession) || null;
}

export async function markOtpVerified(sessionId: string): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: SESSIONS_TABLE,
    Key: { sessionId },
    UpdateExpression: 'SET verified = :v, attempts = attempts + :one',
    ExpressionAttributeValues: { ':v': true, ':one': 1 },
  }));
}

export async function incrementOtpAttempts(sessionId: string): Promise<number> {
  const result = await ddb.send(new UpdateCommand({
    TableName: SESSIONS_TABLE,
    Key: { sessionId },
    UpdateExpression: 'SET attempts = attempts + :one',
    ExpressionAttributeValues: { ':one': 1 },
    ReturnValues: 'ALL_NEW',
  }));
  return (result.Attributes?.attempts as number) || 0;
}

export async function logCall(contactId: string, event: string, data: Record<string, unknown>): Promise<void> {
  const timestamp = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: CALL_LOGS_TABLE,
    Item: {
      contactId,
      timestamp,
      event,
      data,
    },
  }));
}

export async function getFacilityFromDynamo(phoneNumber: string): Promise<FacilityConfig | null> {
  const result = await ddb.send(new GetCommand({
    TableName: FACILITY_TABLE,
    Key: { phoneNumber },
  }));
  return (result.Item as FacilityConfig) || null;
}

// ============================================================
// PESEL VALIDATION
// ============================================================

export function validatePesel(pesel: string): { valid: boolean; error?: string } {
  const cleaned = pesel.replace(/\s/g, '');

  if (!/^\d{11}$/.test(cleaned)) {
    return { valid: false, error: 'PESEL musi składać się z dokładnie 11 cyfr' };
  }

  // Check digit validation (weights: 1,3,7,9,1,3,7,9,1,3)
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const digits = cleaned.split('').map(Number);
  const sum = weights.reduce((acc, w, i) => acc + w * digits[i], 0);
  const checkDigit = (10 - (sum % 10)) % 10;

  if (checkDigit !== digits[10]) {
    return { valid: false, error: 'Nieprawidłowa cyfra kontrolna PESEL' };
  }

  return { valid: true };
}

// ============================================================
// PHONE NUMBER VALIDATION
// ============================================================

export function validatePhoneNumber(phone: string): { valid: boolean; normalized?: string; error?: string } {
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');

  // Accept +48XXXXXXXXX, 48XXXXXXXXX, or XXXXXXXXX (9 digits)
  const match = cleaned.match(/^(\+?48)?(\d{9})$/);
  if (!match) {
    return { valid: false, error: 'Numer telefonu powinien składać się z 9 cyfr' };
  }

  return { valid: true, normalized: match[2] };
}

// ============================================================
// OTP GENERATION
// ============================================================

export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function otpTtl(minutes: number): number {
  return Math.floor(Date.now() / 1000) + minutes * 60;
}

// ============================================================
// TIME OF DAY HELPERS
// ============================================================

export function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  const dayNames = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
  const day = dayNames[date.getDay()];
  const dateStr = date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${dateStr} o godzinie ${timeStr}`;
}

export function formatAppointments(appointments: Appointment[]): string {
  if (!appointments.length) return 'Nie masz żadnych zaplanowanych wizyt.';
  return appointments
    .filter(a => a.status === 'scheduled')
    .map((a, i) => `Wizyta ${i + 1}: ${a.specialization} u doktora ${a.doctorName}, ${formatDateTime(a.dateTime)}`)
    .join('. ') || 'Nie masz żadnych aktywnych wizyt.';
}

export function formatSlots(slots: TimeSlot[]): string {
  return slots
    .map((s, i) => `Opcja ${i + 1}: ${s.specialization} u doktora ${s.doctorName}, ${formatDateTime(s.dateTime)}`)
    .join('. ');
}

// ============================================================
// LEX RESPONSE BUILDERS
// ============================================================

export function lexClose(
  event: LexEvent,
  state: 'Fulfilled' | 'Failed',
  message: string,
  sessionAttributes?: Record<string, string>
): LexResponse {
  return {
    sessionState: {
      sessionAttributes: {
        ...event.sessionState.sessionAttributes,
        ...sessionAttributes,
      },
      dialogAction: { type: 'Close' },
      intent: {
        name: event.sessionState.intent.name,
        state,
      },
    },
    messages: [{ contentType: 'PlainText', content: message }],
  };
}

export function lexElicitSlot(
  event: LexEvent,
  slotToElicit: string,
  message: string,
  sessionAttributes?: Record<string, string>
): LexResponse {
  return {
    sessionState: {
      sessionAttributes: {
        ...event.sessionState.sessionAttributes,
        ...sessionAttributes,
      },
      dialogAction: { type: 'ElicitSlot', slotToElicit },
      intent: {
        name: event.sessionState.intent.name,
        state: 'InProgress',
        slots: event.sessionState.intent.slots,
      },
    },
    messages: [{ contentType: 'PlainText', content: message }],
  };
}

export function lexDelegate(
  event: LexEvent,
  sessionAttributes?: Record<string, string>
): LexResponse {
  return {
    sessionState: {
      sessionAttributes: {
        ...event.sessionState.sessionAttributes,
        ...sessionAttributes,
      },
      dialogAction: { type: 'Delegate' },
      intent: {
        name: event.sessionState.intent.name,
        state: 'InProgress',
        slots: event.sessionState.intent.slots,
      },
    },
  };
}

export function getSlotValue(event: LexEvent, slotName: string): string | undefined {
  const slot = event.sessionState.intent.slots?.[slotName];
  return slot?.value?.interpretedValue || slot?.value?.originalValue;
}

export function getSessionAttr(event: LexEvent, key: string): string | undefined {
  return event.sessionState.sessionAttributes?.[key];
}
