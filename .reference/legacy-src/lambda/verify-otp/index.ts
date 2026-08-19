import { LexEvent, LexResponse } from '../shared/types';
import {
  getOtpSession,
  markOtpVerified,
  incrementOtpAttempts,
  logCall,
  lexClose,
  lexElicitSlot,
  getSlotValue,
  getSessionAttr,
} from '../shared/utils';

const MAX_OTP_ATTEMPTS = 3;

export const handler = async (event: LexEvent): Promise<LexResponse> => {
  const contactId = getSessionAttr(event, 'contactId') || event.sessionId;
  const otpSessionId = getSessionAttr(event, 'otpSessionId') || '';
  const otpInput = getSlotValue(event, 'KodOtp') || '';

  console.log('verify-otp invoked', { sessionId: event.sessionId, otpSessionId });

  if (!otpSessionId) {
    await logCall(contactId, 'OTP_NO_SESSION', {});
    return lexClose(event, 'Failed',
      'Sesja weryfikacji wygasła. Proszę rozpocząć proces logowania od nowa.',
      { authFailed: 'true', restartAuth: 'true' });
  }

  if (!otpInput || otpInput.length !== 6) {
    return lexElicitSlot(event, 'KodOtp',
      'Proszę podać sześciocyfrowy kod SMS.');
  }

  const session = await getOtpSession(otpSessionId);

  if (!session) {
    await logCall(contactId, 'OTP_SESSION_NOT_FOUND', { otpSessionId });
    return lexClose(event, 'Failed',
      'Sesja weryfikacji wygasła. Proszę rozpocząć logowanie od nowa.',
      { authFailed: 'true', restartAuth: 'true' });
  }

  // Check TTL
  const nowUnix = Math.floor(Date.now() / 1000);
  if (nowUnix > session.ttl) {
    await logCall(contactId, 'OTP_EXPIRED', { otpSessionId });
    return lexClose(event, 'Failed',
      'Kod weryfikacyjny wygasł. Proszę poprosić o nowy kod.',
      { otpExpired: 'true', otpSessionId });
  }

  // Check max attempts
  if (session.attempts >= MAX_OTP_ATTEMPTS) {
    await logCall(contactId, 'OTP_MAX_ATTEMPTS', { otpSessionId });
    return lexClose(event, 'Failed',
      'Przekroczono liczbę prób weryfikacji. Łączę z agentem.',
      { transferToAgent: 'true', reason: 'max_otp_attempts' });
  }

  // Verify code
  if (otpInput !== session.otpCode) {
    const attempts = await incrementOtpAttempts(otpSessionId);
    const remaining = MAX_OTP_ATTEMPTS - attempts;

    await logCall(contactId, 'OTP_WRONG', { otpSessionId, attempts });

    if (remaining <= 0) {
      return lexClose(event, 'Failed',
        'Nieprawidłowy kod. Łączę z agentem.',
        { transferToAgent: 'true', reason: 'max_otp_attempts' });
    }

    return lexElicitSlot(event, 'KodOtp',
      `Nieprawidłowy kod. Pozostało ${remaining} ${remaining === 1 ? 'próba' : 'próby'}. Proszę podać kod ponownie.`);
  }

  // SUCCESS
  await markOtpVerified(otpSessionId);
  await logCall(contactId, 'OTP_VERIFIED', { otpSessionId, pesel: session.pesel });

  return lexClose(event, 'Fulfilled',
    'Weryfikacja zakończona pomyślnie. Czym mogę Ci pomóc?',
    {
      authenticated: 'true',
      patientPesel: session.pesel,
      patientPhone: session.phoneNumber,
      authMethod: 'otp',
    });
};
