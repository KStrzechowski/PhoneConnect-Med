import { measured, downstream } from '@pcm/measure';
import { fetchFacility, openDaysEn, ssmlAddress } from '@pcm/facility';
import { ssmlTime } from '@pcm/appointment';

export const handler = measured(
  'facility-info',
  async (event, record): Promise<Record<string, string>> => {
    const { locale = 'pl' } = event?.Details?.Parameters ?? {};
    const abort = AbortSignal.timeout(7000);
    try {
      const facility = await downstream(record, () => fetchFacility(abort));
      return {
        reachable: 'true',
        name: facility.name,
        address: ssmlAddress(facility.address, locale),
        opensAt: ssmlTime(facility.opensAt),
        closesAt: ssmlTime(facility.closesAt),
        openDays: locale === 'en' ? (openDaysEn[facility.openDays] ?? facility.openDays) : facility.openDays,
      };
    } catch (error) {
      const message = String(error);
      record.outcome = 'error';
      record.error = message;
      return { reachable: 'false', error: message };
    }
  },
);
