import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import env from "@packages/env";
import fs from "node:fs";
import path from "node:path";

const s3Client = new S3Client({
  endpoint: env.SUPABASE_S3_ENDPOINT,
  region: env.SUPABASE_S3_REGION,
  credentials: {
    accessKeyId: env.SUPABASE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.SUPABASE_S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true, // Required for some S3-compatible services like Supabase/MinIO
});

export class S3Service {
  async uploadFile(
    filePath: string,
    fileName?: string,
    contentType?: string,
  ): Promise<{ url: string; key: string }> {
    try {
      const fileStream = fs.createReadStream(filePath);
      const key = `media-uploads/${fileName || path.basename(filePath)}`;

      const uploadParams = {
        Bucket: env.SUPABASE_S3_BUCKET,
        Key: key,
        Body: fileStream,
        ContentType: contentType || "application/octet-stream", // Default content type
        ACL: "public-read",
      } as const;

      console.log(
        `Uploading ${filePath} to S3 bucket ${uploadParams.Bucket} as ${key}`,
      );
      await s3Client.send(new PutObjectCommand(uploadParams));

      // Construct the URL. This might vary based on your S3 provider and bucket settings.
      // For Supabase, it's typically: ${ENDPOINT}/${BUCKET}/${KEY}
      const url = `${env.SUPABASE_S3_ENDPOINT}/${env.SUPABASE_S3_BUCKET}/${key}`;
      console.log(`File uploaded successfully. URL: ${url}`);

      return { url, key };
    } catch (error) {
      console.error("Error uploading file to S3:", error);
      throw error; // Re-throw the error to be handled by the caller
    }
  }
}
