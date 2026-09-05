export type VerifyResult =
  | { matched: false }
  | {
      matched: true;
      id: number;
      firstName: string;
      lastName: string;
      isDemo: boolean;
      demoOtpCode: string | null;
    };

export type AuthResult =
  | { authenticated: false }
  | { authenticated: true; patientId: number; firstName: string; lastName: string };

export type OtpChallengeResult =
  | { authenticated: true; patientId: number; firstName: string; lastName: string }
  | {
      otpRequired: true;
      isDemo: boolean;
      code: string | null;
      phone: string | null;
      patientId?: number;
      firstName: string | null;
      lastName: string | null;
    };

export const verifyPatient = async (pesel: string, phone: string, signal: AbortSignal): Promise<VerifyResult> => {
  const response = await fetch(`${process.env.MOCK_BASE_URL}/patient/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pesel, phone }),
    signal,
  });
  return (await response.json()) as VerifyResult;
};

export const authenticate = async (
  pesel: string,
  phone: string,
  callerNumber: string,
  signal: AbortSignal,
): Promise<AuthResult> => {
  const result = await verifyPatient(pesel, phone, signal);
  if (!result.matched || callerNumber !== phone) return { authenticated: false };
  return { authenticated: true, patientId: result.id, firstName: result.firstName, lastName: result.lastName };
};

export const generateOtpCode = (): string => String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');

export const beginOtpChallenge = async (
  pesel: string,
  phone: string,
  callerNumber: string,
  signal: AbortSignal,
): Promise<OtpChallengeResult> => {
  const result = await verifyPatient(pesel, phone, signal);
  if (result.matched && callerNumber === phone) {
    return { authenticated: true, patientId: result.id, firstName: result.firstName, lastName: result.lastName };
  }
  if (result.matched) {
    return result.isDemo
      ? {
          otpRequired: true,
          isDemo: true,
          code: result.demoOtpCode,
          phone: null,
          patientId: result.id,
          firstName: result.firstName,
          lastName: result.lastName,
        }
      : {
          otpRequired: true,
          isDemo: false,
          code: generateOtpCode(),
          phone,
          patientId: result.id,
          firstName: result.firstName,
          lastName: result.lastName,
        };
  }
  return { otpRequired: true, isDemo: false, code: null, phone: null, firstName: null, lastName: null };
};

export const verifyOtpCode = (expected: string | null, entered: string): boolean =>
  expected !== null && expected === entered;
