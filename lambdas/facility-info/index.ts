import { measured, downstream } from '@pcm/measure';
import { fetchFacility } from '@pcm/facility';

export const handler = measured(
  'facility-info',
  async (_event, record): Promise<Record<string, string>> => {
    const abort = AbortSignal.timeout(1000);
    try {
      const facility = await downstream(record, () => fetchFacility(abort));
      return {
        reachable: 'true',
        name: facility.name,
        address: facility.address,
        opensAt: facility.opensAt,
        closesAt: facility.closesAt,
        openDays: facility.openDays,
      };
    } catch (error) {
      const message = String(error);
      record.outcome = 'error';
      record.error = message;
      return { reachable: 'false', error: message };
    }
  },
);
