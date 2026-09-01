export type VerifyResult =
  | { matched: false }
  | { matched: true; id: number; firstName: string; lastName: string };

export type AuthResult = { authenticated: false } | { authenticated: true; patientId: number; firstName: string };

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
  return { authenticated: true, patientId: result.id, firstName: result.firstName };
};
