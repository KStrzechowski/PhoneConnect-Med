import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import {
  LexEvent, LexResponse,
} from '../shared/types';
import {
  HisApiClient,
  validatePesel,
  validatePhoneNumber,
  generateOtp,
  otpTtl,
  saveOtpSession,
  logCall,
  lexClose,
  lexElicitSlot,
  getSlotValue,
  getSessionAttr,
} from '../shared/utils';

const snsClient = new SNSClient({ region: process.env.AWS_REGION || 'eu-central-1' });

export const handler = async (event: LexEvent): Promise<LexResponse> => {
  const contactId = getSessionAttr(event, 'contactId') || event.sessionId;
  console.log('verify-patient invoked', { sessionId: event.sessionId, contactId });

  const peselRaw = getSlotValue(event, 'Pesel') || '';
  const phoneRaw = getSlotValue(event, 'Telefon') || '';

  // Validate PESEL
  const peselValidation = validatePesel(peselRaw);
  if (!peselValidation.valid) {
    await logCall(contactId, 'PESEL_INVALID', { pesel: peselRaw, error: peselValidation.error });
    return lexElicitSlot(event, 'Pesel',
      'Podany numer PESEL jest nieprawidłowy. Proszę podać poprawny 11-cyfrowy numer PESEL.');
  }

  // Validate phone
  const phoneValidation = validatePhoneNumber(phoneRaw);
  if (!phoneValidation.valid) {
    await logCall(contactId, 'PHONE_INVALID', { phone: phoneRaw, error: phoneValidation.error });
    return lexElicitSlot(event, 'Telefon',
      'Podany numer telefonu jest nieprawidłowy. Proszę podać numer składający się z 9 cyfr.');
  }

  const pesel = peselRaw.replace(/\s/g, '');
  const phone = phoneValidation.normalized!;

  // Check CLID (silent verification)
  const clid = getSessionAttr(event, 'customerEndpointAddress') || '';
  const clidValidation = validatePhoneNumber(clid);
  const clidMatches = clidValidation.valid && clidValidation.normalized === phone;

  // Verify pair in HIS
  let pairValid = false;
  try {
    const his = await HisApiClient.create();
    pairValid = await his.verifyPatient(pesel, phone);
  } catch (err) {
    console.error('HIS verification error', err);
    await logCall(contactId, 'HIS_ERROR', { error: String(err) });
    return lexClose(event, 'Failed',
      'Przepraszam, wystąpił problem z weryfikacją. Łączę z agentem.',
      { transferToAgent: 'true', reason: 'his_error' });
  }

  if (!pairValid) {
    await logCall(contactId, 'PAIR_INVALID', { pesel, phone });
    // Neutral message – does not reveal whether account exists
    return lexClose(event, 'Failed',
      'Podane dane nie zostały rozpoznane w systemie. Proszę spróbować ponownie lub skontaktować się z rejestracją.',
      { authFailed: 'true' });
  }

  await logCall(contactId, 'PAIR_VERIFIED', { pesel, clidMatches });

  // If CLID matches – skip OTP, proceed directly
  if (clidMatches) {
    await logCall(contactId, 'CLID_MATCH_AUTH', { pesel });
    return lexClose(event, 'Fulfilled',
      'Tożsamość potwierdzona. Czym mogę Ci pomóc?',
      {
        authenticated: 'true',
        patientPesel: pesel,
        patientPhone: phone,
        authMethod: 'clid',
      });
  }

  // Generate and send OTP
  const otp = generateOtp();
  const sessionId = `otp-${contactId}-${Date.now()}`;
  const ttlMinutes = 5;

  await saveOtpSession({
    sessionId,
    pesel,
    phoneNumber: phone,
    otpCode: otp,
    createdAt: new Date().toISOString(),
    ttl: otpTtl(ttlMinutes),
    attempts: 0,
    verified: false,
    clid: clid || undefined,
  });

  // Send SMS via SNS
  try {
    await snsClient.send(new PublishCommand({
      TopicArn: process.env.OTP_TOPIC_ARN,
      Message: `Kod weryfikacyjny infolinii medycznej: ${otp}. Ważny ${ttlMinutes} minut.`,
      MessageAttributes: {
        'AWS.SNS.SMS.PhoneNumber': { DataType: 'String', StringValue: `+48${phone}` },
        'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
      },
    }));
  } catch (err) {
    console.error('SNS send error', err);
    // Continue – don't expose SMS failure to patient
  }

  await logCall(contactId, 'OTP_SENT', { pesel, phone, sessionId });

  // Neutral message – does not confirm whether number exists
  return lexClose(event, 'Fulfilled',
    'Jeśli podane dane są prawidłowe, wysłaliśmy kod weryfikacyjny SMS. Proszę go teraz podać.',
    {
      otpSessionId: sessionId,
      pendingPesel: pesel,
      pendingPhone: phone,
      authMethod: 'otp',
    });
};
