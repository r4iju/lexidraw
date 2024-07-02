import { geolocation } from '@vercel/edge';

export const runtime = 'edge';

export function getGeoInfo(request: Request) {
  const { city, country, region } = geolocation(request);
  return { city, country, region };
}
