export const handler = async (): Promise<Record<string, string>> => {
  const abort = AbortSignal.timeout(1000);
  try {
    const response = await fetch(`${process.env.MOCK_BASE_URL}/health`, { signal: abort });
    const health = (await response.json()) as { service: string; status: string };
    return { reachable: 'true', service: health.service, status: health.status };
  } catch (error) {
    return { reachable: 'false', error: String(error) };
  }
};
