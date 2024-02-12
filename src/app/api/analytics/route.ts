import { z } from 'zod';
import { db } from '~/server/db';
import { validateAuthToken } from '~/lib/validate-auth-token';
import { generateVisitorId } from '~/lib/generate-visitor-id';

export async function POST(req: Request) {
  const isAuthed = await validateAuthToken(req.headers.get('Authorization'));
  if (!isAuthed) {
    return new Response('Unauthorized', { status: 401 });
  }

  const data = z.object({
    pageVisited: z.string(),
    referer: z.string(),
    userAgent: z.string(),
    ipAddress: z.string(),
    country: z.string(),
    city: z.string(),
    region: z.string(),
  });

  try {
    const input = data.parse(await req.json());

    const visitorId = await generateVisitorId({
      userAgent: input.userAgent,
      country: input.country,
      city: input.city,
      region: input.region,
    });

    const response = await db.analytics.create({
      data: {
        visitorId,
        pageVisited: input.pageVisited,
        referer: input.referer,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
        country: input.country,
        city: input.city,
        region: input.region,
      },
    });
    return new Response(JSON.stringify(response), { status: 200 });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify(error), { status: 500 });
  }
}
