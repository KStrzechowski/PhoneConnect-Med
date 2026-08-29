import { measured, downstream } from '@pcm/measure';

export const handler = measured(
  'facility-info',
  async (_event, record): Promise<Record<string, string>> => {
    const abort = AbortSignal.timeout(1000);
    try {
      const response = await downstream(record, () =>
        fetch(`${process.env.MOCK_BASE_URL}/facility`, { signal: abort }),
      );
      const facility = (await response.json()) as {
        name: string;
        address: string;
        opensAt: string;
        closesAt: string;
        openDays: string;
      };
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
