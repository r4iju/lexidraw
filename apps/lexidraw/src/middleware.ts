import { NextResponse, type NextRequest } from 'next/server';
import { getGeoInfo } from '~/lib/get-geo-location';
import { generateVisitorId } from './lib/generate-visitor-id';
import { drizzle, schema } from '@packages/drizzle';
import { auth } from './server/auth';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const analytics = async (req: NextRequest): Promise<void> => {
  if (req.method === 'GET') {
    // Current page the user is visiting
    const pageVisited = req.nextUrl.href;
    const referer = req.headers.get('referer') ?? 'Direct/Bookmark';
    const userAgent = req.headers.get('user-agent') ?? 'Unknown';
    const ipAddress = req.headers.get('x-forwarded-for') ?? 'Unknown';
    const { city, country, region } = getGeoInfo(req);
    if (city && country && region) {
      const visitorId = await generateVisitorId({ userAgent, country, city, region });
      drizzle.insert(schema.analytics)
        .values({
          visitorId,
          timestamp: new Date(),
          pageVisited,
          referer,
          userAgent,
          ipAddress,
          country,
          city,
          region,
        })
        .catch(console.error);
    } else {
      console.error('Could not get geolocation. Dev environment?');
    }
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for static files
  if (pathname.match(/\.(ico|svg|png|jpg|jpeg|css|js|txt|xml|json)$/)) {
    return;
  }

  const session = await auth()
  const url = new URL(request.url);
  const needsAuth = ["/dashboard", "/settings", "/profile", "/signout"];
  if (!session && needsAuth.includes(url.pathname)) {
    url.pathname = '/signin';
    return NextResponse.rewrite(url);
  }

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
