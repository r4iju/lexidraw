import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import env from "@packages/env";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

const s3Client = new S3Client({
  endpoint: env.SUPABASE_S3_ENDPOINT,
  region: env.SUPABASE_S3_REGION,
  credentials: {
    accessKeyId: env.SUPABASE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.SUPABASE_S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true, // Required for some S3-compatible services like Supabase/MinIO
});

// Ensure temp directory exists (consistent with download.service.ts)
const diagnosticTempDir = path.join(os.tmpdir(), "media-downloader");
if (!fs.existsSync(diagnosticTempDir)) {
  fs.mkdirSync(diagnosticTempDir, { recursive: true });
}

export class S3Service {
  async uploadFile(
    filePath: string,
    key: string,
    contentType: string,
  ): Promise<{ url: string; key: string; contentType: string }> {
    const fileBuffer = fs.readFileSync(filePath);

    const hash = createHash("sha256");
    hash.update(fileBuffer);
    const base64Sha256Checksum = hash.digest("base64");

    const uploadParams: PutObjectCommandInput = {
      Bucket: env.SUPABASE_S3_BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
      ContentLength: fileBuffer.length,
      ChecksumSHA256: base64Sha256Checksum,
    };

    try {
      await s3Client.send(new PutObjectCommand(uploadParams));
      console.log(
        `File uploaded successfully. Path: ${filePath}, S3 Key: ${key}, ContentType: ${contentType}, ContentLength: ${fileBuffer.length}, ChecksumSHA256: ${base64Sha256Checksum}`,
      );

      // Generate pre-signed URL for GetObject (for actual download)
      const getObjectParams = {
        Bucket: env.SUPABASE_S3_BUCKET,
        Key: key,
        ResponseContentType: contentType,
      };
      const signedDownloadUrl = await getSignedUrl(
        s3Client,
        new GetObjectCommand(getObjectParams),
        { expiresIn: 7 * 24 * 60 * 60 }, // 7 days
      );

      return {
        url: signedDownloadUrl,
        key: key,
        contentType: contentType,
      };
    } catch (error) {
      console.error(`Error uploading file ${filePath} to S3:`, error);
      throw error;
    }
  }
}
