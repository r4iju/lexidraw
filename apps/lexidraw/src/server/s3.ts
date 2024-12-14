import { S3Client } from '@aws-sdk/client-s3';
import env from '@packages/env';

const globalForS3 = globalThis as unknown as {
  s3Client: S3Client | undefined;
};
const createClient = () => {
  return new S3Client({
    forcePathStyle: true,
    region: env.SUPABASE_S3_REGION,
    endpoint: env.SUPABASE_S3_ENDPOINT,
    credentials: {
      accessKeyId: env.SUPABASE_S3_ACCESS_KEY_ID,
      secretAccessKey: env.SUPABASE_S3_SECRET_ACCESS_KEY,
    }
  })
}

export const s3 = globalForS3.s3Client ?? createClient();

if (env.NODE_ENV !== 'production') {
  globalForS3.s3Client = s3;
}