import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// ============================================================
// MOCK HIS DATA
// ============================================================

interface MockPatient {
  pesel: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  dateOfBirth: string;
  email: string;
  address: { street: string; city: string; postalCode: string };
}

interface MockAppointment {
  appointmentId: string;
  patientPesel: string;
  doctorName: string;
  specialization: string;
  dateTime: string;
  facilityName: string;
  facilityAddress: string;
  status: 'scheduled' | 'cancelled' | 'completed';
}

interface MockSlot {
  slotId: string;
  doctorName: string;
  specialization: string;
  dateTime: string;
  duration: number;
  facilityId: string;
}

// Seed data – mock patients
const PATIENTS: MockPatient[] = [
  {
    pesel: '80010112345',
    firstName: 'Jan',
    lastName: 'Kowalski',
    phoneNumber: '600100200',
    dateOfBirth: '1980-01-01',
    email: 'jan.kowalski@example.com',
    address: { street: 'ul. Marszałkowska 1', city: 'Warszawa', postalCode: '00-001' },
  },
  {
    pesel: '90020256789',
    firstName: 'Anna',
    lastName: 'Nowak',
    phoneNumber: '700200300',
    dateOfBirth: '1990-02-02',
    email: 'anna.nowak@example.com',
    address: { street: 'ul. Krakowska 5', city: 'Kraków', postalCode: '30-001' },
  },
  {
    pesel: '75030367890',
    firstName: 'Piotr',
    lastName: 'Wiśniewski',
    phoneNumber: '500300400',
    dateOfBirth: '1975-03-03',
    email: 'piotr.w@example.com',
    address: { street: 'ul. Wrocławska 12', city: 'Wrocław', postalCode: '50-001' },
  },
];

// In-memory appointments (simulated persistence per cold start)
let APPOINTMENTS: MockAppointment[] = [
  {
    appointmentId: 'APT-001',
    patientPesel: '80010112345',
    doctorName: 'dr Marek Zielony',
    specialization: 'internista',
    dateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    facilityName: 'Przychodnia Centralna',
    facilityAddress: 'ul. Medyczna 10, Warszawa',
    status: 'scheduled',
  },
  {
    appointmentId: 'APT-002',
    patientPesel: '80010112345',
    doctorName: 'dr Katarzyna Biała',
    specialization: 'kardiolog',
    dateTime: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    facilityName: 'Przychodnia Centralna',
    facilityAddress: 'ul. Medyczna 10, Warszawa',
    status: 'scheduled',
  },
];

// Available time slots (generated dynamically)
function generateSlots(specialization: string, timeOfDay: string, limit = 3, offset = 0): MockSlot[] {
  const doctors: Record<string, string[]> = {
    internista: ['dr Marek Zielony', 'dr Joanna Czerwona'],
    kardiolog: ['dr Katarzyna Biała', 'dr Roman Czarny'],
    dermatolog: ['dr Alicja Złota', 'dr Tomasz Srebrny'],
    ortopeda: ['dr Wojciech Brązowy'],
    neurolog: ['dr Magdalena Szara'],
    okulista: ['dr Paweł Niebieski'],
    ginekolog: ['dr Monika Różowa'],
    urolog: ['dr Krzysztof Fioletowy'],
    psychiatra: ['dr Elżbieta Zielona'],
    endokrynolog: ['dr Rafał Pomarańczowy'],
  };

  const docList = doctors[specialization.toLowerCase()] || ['dr Jan Przykładowy'];

  const hourMap: Record<string, number[]> = {
    rano: [8, 9, 10, 11],
    południe: [12, 13, 14],
    popołudnie: [15, 16, 17, 18],
  };

  const hours = hourMap[timeOfDay] || [9, 10, 11];
  const slots: MockSlot[] = [];
  let slotIndex = 0;
  const baseDate = new Date();
  baseDate.setHours(0, 0, 0, 0);

  for (let dayOffset = 1; slots.length < limit + offset && dayOffset < 30; dayOffset++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + dayOffset);
    if (date.getDay() === 0 || date.getDay() === 6) continue; // skip weekends

    for (const hour of hours) {
      if (slots.length >= limit + offset) break;
      const dateTime = new Date(date);
      dateTime.setHours(hour, 0, 0, 0);
      const doc = docList[slotIndex % docList.length];
      slots.push({
        slotId: `SLOT-${specialization.toUpperCase()}-${dayOffset}-${hour}`,
        doctorName: doc,
        specialization,
        dateTime: dateTime.toISOString(),
        duration: 20,
        facilityId: 'FAC-001',
      });
      slotIndex++;
    }
  }

  return slots.slice(offset, offset + limit);
}

const FACILITIES = [
  {
    phoneNumber: '+48221234567',
    facilityId: 'FAC-001',
    facilityName: 'Przychodnia Centralna',
    address: 'ul. Medyczna 10',
    city: 'Warszawa',
    openingHours: {
      monday: '8:00-18:00',
      tuesday: '8:00-18:00',
      wednesday: '8:00-18:00',
      thursday: '8:00-18:00',
      friday: '8:00-16:00',
      saturday: '9:00-13:00',
      sunday: 'nieczynne',
    },
    specializations: ['internista', 'kardiolog', 'dermatolog', 'ortopeda', 'neurolog'],
  },
];

// ============================================================
// RESPONSE HELPERS
// ============================================================

function ok(body: unknown): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}

function notFound(msg: string): APIGatewayProxyResult {
  return {
    statusCode: 404,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: msg }),
  };
}

function badRequest(msg: string): APIGatewayProxyResult {
  return {
    statusCode: 400,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: msg }),
  };
}

// ============================================================
// ROUTER
// ============================================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const { httpMethod, path, pathParameters, queryStringParameters, body } = event;
  const qs = queryStringParameters || {};

  console.log('mock-his request', { httpMethod, path, qs });

  // OPTIONS (CORS preflight)
  if (httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE' }, body: '' };
  }

  // ---- /patients ----
  if (path.startsWith('/patients')) {
    const pesel = pathParameters?.pesel;

    if (httpMethod === 'GET' && pesel) {
      const patient = PATIENTS.find(p => p.pesel === pesel);
      if (!patient) return notFound(`Patient not found: ${pesel}`);
      return ok(patient);
    }

    if (httpMethod === 'GET') {
      // Search by phone
      const phone = qs.phone;
      if (phone) {
        const normalize = (p: string) => p.replace(/[\s\-\+]/g, '').replace(/^48/, '');
        const found = PATIENTS.filter(p => normalize(p.phoneNumber) === normalize(phone));
        return ok(found);
      }
      return ok(PATIENTS);
    }
  }

  // ---- /appointments ----
  if (path.startsWith('/appointments')) {
    const appointmentId = pathParameters?.appointmentId;

    if (httpMethod === 'GET' && appointmentId) {
      const apt = APPOINTMENTS.find(a => a.appointmentId === appointmentId);
      if (!apt) return notFound(`Appointment not found: ${appointmentId}`);
      return ok(apt);
    }

    if (httpMethod === 'GET') {
      const pesel = qs.pesel;
      const filtered = pesel
        ? APPOINTMENTS.filter(a => a.patientPesel === pesel)
        : APPOINTMENTS;
      return ok(filtered);
    }

    if (httpMethod === 'POST') {
      const req = JSON.parse(body || '{}');
      const { pesel, slotId } = req;

      if (!pesel || !slotId) return badRequest('pesel and slotId are required');

      const patient = PATIENTS.find(p => p.pesel === pesel);
      if (!patient) return notFound(`Patient not found: ${pesel}`);

      // Parse slot info from ID
      const parts = slotId.split('-');
      const spec = parts[1]?.toLowerCase() || 'internista';
      const dayOff = parseInt(parts[2] || '1', 10);
      const hour = parseInt(parts[3] || '9', 10);

      const aptDate = new Date();
      aptDate.setDate(aptDate.getDate() + dayOff);
      aptDate.setHours(hour, 0, 0, 0);

      const newApt: MockAppointment = {
        appointmentId: `APT-${Date.now()}`,
        patientPesel: pesel,
        doctorName: 'dr Jan Przykładowy',
        specialization: spec,
        dateTime: aptDate.toISOString(),
        facilityName: 'Przychodnia Centralna',
        facilityAddress: 'ul. Medyczna 10, Warszawa',
        status: 'scheduled',
      };

      APPOINTMENTS.push(newApt);
      return ok(newApt);
    }

    if (httpMethod === 'DELETE' && appointmentId) {
      const idx = APPOINTMENTS.findIndex(a => a.appointmentId === appointmentId);
      if (idx === -1) return notFound(`Appointment not found: ${appointmentId}`);
      APPOINTMENTS[idx] = { ...APPOINTMENTS[idx], status: 'cancelled' };
      return ok({ success: true, appointmentId });
    }

    if (httpMethod === 'PUT' && appointmentId) {
      const req = JSON.parse(body || '{}');
      const { newSlotId } = req;
      const idx = APPOINTMENTS.findIndex(a => a.appointmentId === appointmentId);
      if (idx === -1) return notFound(`Appointment not found: ${appointmentId}`);

      // Parse new slot
      const parts = (newSlotId || '').split('-');
      const dayOff = parseInt(parts[2] || '2', 10);
      const hour = parseInt(parts[3] || '10', 10);
      const aptDate = new Date();
      aptDate.setDate(aptDate.getDate() + dayOff);
      aptDate.setHours(hour, 0, 0, 0);

      APPOINTMENTS[idx] = { ...APPOINTMENTS[idx], dateTime: aptDate.toISOString() };
      return ok(APPOINTMENTS[idx]);
    }
  }

  // ---- /slots ----
  if (path.startsWith('/slots')) {
    if (httpMethod === 'GET') {
      const specialization = qs.specialization || 'internista';
      const timeOfDay = qs.timeOfDay || 'rano';
      const limit = parseInt(qs.limit || '3', 10);
      const offset = parseInt(qs.offset || '0', 10);
      const slots = generateSlots(specialization, timeOfDay, limit, offset);
      return ok(slots);
    }
  }

  // ---- /facilities ----
  if (path.startsWith('/facilities')) {
    const phoneNumber = pathParameters?.phoneNumber
      ? decodeURIComponent(pathParameters.phoneNumber)
      : '';

    if (httpMethod === 'GET' && phoneNumber) {
      const normalize = (p: string) => p.replace(/[\s\-\+]/g, '').replace(/^48/, '');
      const facility = FACILITIES.find(f => normalize(f.phoneNumber) === normalize(phoneNumber));
      if (!facility) {
        // Return default facility for PoC
        return ok(FACILITIES[0]);
      }
      return ok(facility);
    }

    if (httpMethod === 'GET') {
      return ok(FACILITIES);
    }
  }

  return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Route not found: ${httpMethod} ${path}` }) };
};
