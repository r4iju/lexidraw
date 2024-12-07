import { headers as reqHeaders } from 'next/headers';
import { NextResponse } from 'next/server';
import { s3 } from '~/server/s3';
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import env from '@packages/env';

export async function GET() {
  // print # * 20
  console.log('#'.repeat(20), ' Cron job started ', '#'.repeat(20));
  const headers = await reqHeaders();
  if (headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    console.log('got: ', `Bearer ${headers.get('Authorization')}`);
    console.log('expected: ', `Bearer ${process.env.CRON_SECRET}`);
    return NextResponse.json({
      error: 'Unauthorized',
    }, { status: 401 });
  }

  // count files in bucket
  const res = await s3.send(new ListObjectsV2Command({
    Bucket: env.SUPABASE_S3_BUCKET
  }))

  console.log(`Current number of items in ${env.SUPABASE_S3_BUCKET} bucket: ${res.Contents?.length}`,)
  console.log('#'.repeat(20), ' Cron job finished ', '#'.repeat(20));
  return NextResponse.json({ ok: true, count: res.Contents?.length });
}
