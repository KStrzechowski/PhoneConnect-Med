import { LexEvent, LexResponse } from '../shared/types';
import {
  HisApiClient,
  getFacilityFromDynamo,
  logCall,
  lexClose,
  getSessionAttr,
} from '../shared/utils';

export const handler = async (event: LexEvent): Promise<LexResponse> => {
  const contactId = getSessionAttr(event, 'contactId') || event.sessionId;
  const calledNumber = getSessionAttr(event, 'systemEndpointAddress') || '';

  let config = null;

  // Try DynamoDB cache first
  if (calledNumber) {
    config = await getFacilityFromDynamo(calledNumber);
  }

  // Fallback to HIS API
  if (!config) {
    try {
      const his = await HisApiClient.create();
      config = await his.getFacilityConfig(calledNumber);
    } catch (err) {
      console.error('get-facility-config error', err);
    }
  }

  if (!config) {
    await logCall(contactId, 'FACILITY_NOT_FOUND', { calledNumber });
    // Return generic info
    return lexClose(event, 'Fulfilled',
      'Witamy w infolinii medycznej. Mogę pomóc w rejestracji wizyt, ' +
      'sprawdzeniu harmonogramu oraz udzieleniu informacji. W czym mogę pomóc?',
      { facilityConfigLoaded: 'false' });
  }

  const hours = config.openingHours;
  const intentName = event.sessionState.intent.name;

  // If this was triggered by InfoIntent
  if (intentName === 'InfoIntent') {
    const hoursText = `Placówka czynna: poniedziałek-piątek ${hours.monday}, ` +
      `sobota ${hours.saturday}, niedziela ${hours.sunday}.`;
    return lexClose(event, 'Fulfilled',
      `${config.facilityName} mieści się pod adresem ${config.address}, ${config.city}. ` +
      `${hoursText} Czy mogę jeszcze w czymś pomóc?`);
  }

  // MainMenuIntent or first contact
  await logCall(contactId, 'FACILITY_CONFIG_LOADED', { facilityId: config.facilityId });

  return lexClose(event, 'Fulfilled',
    `Witamy w infolinii ${config.facilityName}. ` +
    'Mogę pomóc w rejestracji wizyty, sprawdzeniu Twoich wizyt lub udostępnieniu informacji o placówce. ' +
    'W czym mogę pomóc?',
    {
      facilityId: config.facilityId,
      facilityName: config.facilityName,
      facilityConfigLoaded: 'true',
    });
};
