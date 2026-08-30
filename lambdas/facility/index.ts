export type Facility = {
  name: string;
  address: string;
  opensAt: string;
  closesAt: string;
  openDays: string;
};

export const fetchFacility = async (signal: AbortSignal): Promise<Facility> => {
  const response = await fetch(`${process.env.MOCK_BASE_URL}/facility`, { signal });
  return (await response.json()) as Facility;
};
