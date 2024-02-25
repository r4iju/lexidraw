import { type NextRequest } from 'next/server';
import { getGeoInfo } from '~/lib/get-geo-location';
import { generateAuthToken } from '~/lib/generate-auth-token';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for static files
  if (pathname.match(/\.(ico|svg|png|jpg|jpeg|css|js|txt|xml|json)$/)) {
    return;
  }

  if (request.method === 'GET') {
    const apiUrl = new URL(
      '/api/analytics',
      `https://${request.headers.get('host')}`
    ).toString();
    // Current page the user is visiting
    const pageVisited = request.nextUrl.href;
    const referer = request.headers.get('referer') ?? 'Direct/Bookmark';
    const userAgent = request.headers.get('user-agent')! || 'Unknown';
    const ipAddress = request.headers.get('x-forwarded-for')! || 'Unknown';
    const { city, country, region } = getGeoInfo(request);
    if (city && country && region) {
      const authToken = await generateAuthToken();
      fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
          cookie: request.headers.get('cookie') ?? '',
        },
        body: JSON.stringify({
          pageVisited,
          referer,
          userAgent,
          ipAddress,
          country,
          city,
          region,
        }),
      }).catch((error) => {
        console.error(error);
      });
    } else {
      console.error('Could not get geolocation. Dev environment?');
    }
  }

  return
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|assets|favicon|fonts|logo|_next/static|_next/image|favicon.ico).*)',
  ],
};
