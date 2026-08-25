import { measured, downstream } from '@pcm/measure';

export const handler = measured(
  'connect-health',
  async (_event, record): Promise<Record<string, string>> => {
    const abort = AbortSignal.timeout(1000);
    try {
      const response = await downstream(record, () =>
        fetch(`${process.env.MOCK_BASE_URL}/health`, { signal: abort }),
      );
      const health = (await response.json()) as { service: string; status: string };
      return { reachable: 'true', service: health.service, status: health.status };
    } catch (error) {
      const message = String(error);
      record.outcome = 'error';
      record.error = message;
      return { reachable: 'false', error: message };
    }
  },
);
