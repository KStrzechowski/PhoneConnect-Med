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

export const openDaysEn: Record<string, string> = {
  'poniedziałek-piątek': 'Monday-Friday',
};

export const cityNamesEn: Record<string, string> = {
  Warszawa: 'Warsaw',
};

export const ssmlAddress = (address: string, locale: string = 'pl'): string => {
  const withStreetWord = address.replace(/^ul\.\s*/, locale === 'en' ? 'street ' : 'ulica ');
  const withCity =
    locale === 'en'
      ? Object.entries(cityNamesEn).reduce((acc, [pl, en]) => acc.replace(pl, en), withStreetWord)
      : withStreetWord;
  return withCity.replace(
    /(\d{2})-(\d{3})/,
    '<say-as interpret-as="digits">$1</say-as><break time="150ms"/><say-as interpret-as="digits">$2</say-as>',
  );
};
