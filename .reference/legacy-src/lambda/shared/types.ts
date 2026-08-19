// ============================================================
// SHARED TYPES – used across all Lambda functions
// ============================================================

export interface Patient {
  pesel: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  dateOfBirth: string;
  email?: string;
  address?: {
    street: string;
    city: string;
    postalCode: string;
  };
}

export interface Appointment {
  appointmentId: string;
  patientPesel: string;
  doctorName: string;
  specialization: string;
  dateTime: string; // ISO 8601
  facilityName: string;
  facilityAddress: string;
  status: 'scheduled' | 'cancelled' | 'completed';
  notes?: string;
}

export interface TimeSlot {
  slotId: string;
  doctorName: string;
  specialization: string;
  dateTime: string; // ISO 8601
  duration: number; // minutes
  facilityId: string;
}

export interface FacilityConfig {
  phoneNumber: string;
  facilityId: string;
  facilityName: string;
  address: string;
  city: string;
  openingHours: {
    monday: string;
    tuesday: string;
    wednesday: string;
    thursday: string;
    friday: string;
    saturday: string;
    sunday: string;
  };
  specializations: string[];
  hisApiUrl?: string;
}

export interface OtpSession {
  sessionId: string;
  pesel: string;
  phoneNumber: string;
  otpCode: string;
  createdAt: string;
  ttl: number; // Unix timestamp
  attempts: number;
  verified: boolean;
  clid?: string; // Caller Line ID if available
}

// ============================================================
// AMAZON CONNECT LAMBDA EVENT/RESPONSE TYPES
// ============================================================

export interface ConnectContactAttributes {
  [key: string]: string;
}

export interface ConnectEvent {
  Name: string;
  ContactId: string;
  InstanceARN: string;
  InitiationMethod: 'INBOUND' | 'OUTBOUND' | 'TRANSFER' | 'CALLBACK';
  SystemEndpoint?: { Address: string; Type: string };
  CustomerEndpoint?: { Address: string; Type: string };
  PreviousContactId?: string;
  Channel: 'VOICE' | 'CHAT';
  Details: {
    ContactData: {
      Attributes: ConnectContactAttributes;
      Channel: string;
      ContactId: string;
      CustomerEndpoint?: { Address: string; Type: string };
      InitialContactId: string;
      InitiationMethod: string;
      InstanceARN: string;
      MediaStreams?: Record<string, unknown>;
      PreviousContactId?: string;
      Queue?: { ARN: string; Name: string };
      SystemEndpoint?: { Address: string; Type: string };
    };
    Parameters: ConnectContactAttributes;
  };
}

export interface ConnectResponse {
  [key: string]: string | number | boolean;
}

// ============================================================
// AMAZON LEX V2 LAMBDA EVENT/RESPONSE TYPES
// ============================================================

export interface LexSlotValue {
  interpretedValue?: string;
  originalValue?: string;
  resolvedValues?: string[];
}

export interface LexSlot {
  value: LexSlotValue;
  shape?: string;
}

export interface LexSlots {
  [slotName: string]: LexSlot | null;
}

export interface LexIntent {
  name: string;
  nluConfidence?: { score: number };
  slots: LexSlots;
  state: 'Failed' | 'Fulfilled' | 'FulfillmentInProgress' | 'InProgress' | 'ReadyForFulfillment' | 'Waiting';
  confirmationState: 'Confirmed' | 'Denied' | 'None';
}

export interface LexEvent {
  messageVersion: string;
  invocationSource: 'DialogCodeHook' | 'FulfillmentCodeHook';
  inputMode: 'DTMF' | 'Speech' | 'Text';
  responseContentType: string;
  sessionId: string;
  inputTranscript?: string;
  bot: {
    id: string;
    name: string;
    aliasId: string;
    aliasName: string;
    localeId: string;
    version: string;
  };
  interpretations: Array<{
    intent: LexIntent;
    nluConfidence?: { score: number };
    sentimentResponse?: { sentiment: string; sentimentScore: Record<string, number> };
  }>;
  proposedNextState?: {
    intent: LexIntent;
    dialogAction: { type: string; slotToElicit?: string };
    prompt?: { attempt: string };
  };
  requestAttributes?: Record<string, string>;
  sessionState: {
    activeContexts?: Array<{
      name: string;
      contextAttributes: Record<string, string>;
      timeToLive: { timeToLiveInSeconds: number; turnsToLive: number };
    }>;
    sessionAttributes: Record<string, string>;
    runtimeHints?: Record<string, unknown>;
    dialogAction?: {
      type: 'Close' | 'ConfirmIntent' | 'Delegate' | 'ElicitIntent' | 'ElicitSlot' | 'None';
      slotToElicit?: string;
      slotElicitationStyle?: string;
    };
    intent: LexIntent;
    originatingRequestId?: string;
  };
}

export interface LexMessage {
  contentType: 'CustomPayload' | 'ImageResponseCard' | 'PlainText' | 'SSML';
  content: string;
}

export interface LexResponse {
  sessionState: {
    sessionAttributes: Record<string, string>;
    dialogAction: {
      type: 'Close' | 'ConfirmIntent' | 'Delegate' | 'ElicitIntent' | 'ElicitSlot' | 'None';
      slotToElicit?: string;
    };
    intent?: {
      name: string;
      state: 'Failed' | 'Fulfilled' | 'FulfillmentInProgress' | 'InProgress' | 'ReadyForFulfillment' | 'Waiting';
      slots?: LexSlots;
    };
    activeContexts?: Array<{
      name: string;
      contextAttributes: Record<string, string>;
      timeToLive: { timeToLiveInSeconds: number; turnsToLive: number };
    }>;
  };
  messages?: LexMessage[];
  requestAttributes?: Record<string, string>;
}
