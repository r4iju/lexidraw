import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import env from "@packages/env";
import fs from "node:fs";
import https from "node:https";
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

      // Diagnostic: Generate pre-signed URL for HeadObject
      try {
        const headObjectParams = {
          Bucket: env.SUPABASE_S3_BUCKET,
          Key: key,
        };
        const headUrl = await getSignedUrl(
          s3Client,
          new HeadObjectCommand(headObjectParams),
          { expiresIn: 60 }, // Short expiry for diagnostics
        );
        console.log(`
          VERIFY UPLOADED OBJECT METADATA:
          ----------------------------------
          Run this command in your terminal:
          curl -I "${headUrl}"
          ----------------------------------
        `);
      } catch (headError) {
        console.warn(
          "Could not generate pre-signed URL for HeadObject:",
          headError,
        );
      }

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

      // Diagnostic: Download the file back from S3 and verify its checksum
      const originalFileNameForRedownload = path.basename(key);
      const reDownloadedFilePath = path.join(
        diagnosticTempDir,
        `${originalFileNameForRedownload}.s3_redownloaded${path.extname(originalFileNameForRedownload)}`,
      );
      try {
        console.log(
          `Attempting to re-download S3 file from ${signedDownloadUrl} to ${reDownloadedFilePath} for checksum verification.`,
        );
        await new Promise<void>((resolve, reject) => {
          const file = fs.createWriteStream(reDownloadedFilePath);
          https
            .get(signedDownloadUrl, (response) => {
              if (response.statusCode !== 200) {
                reject(
                  new Error(
                    `Failed to re-download file from S3: Status Code ${response.statusCode} ${response.statusMessage}`,
                  ),
                );
                response.resume(); // Consume response data to free up memory
                return;
              }
              response.pipe(file);
              file.on("finish", () => {
                file.close(async (closeErr) => {
                  if (closeErr) {
                    return reject(closeErr);
                  }
                  try {
                    const reDownloadedFileBuffer =
                      fs.readFileSync(reDownloadedFilePath);
                    const reDownloadedHash = createHash("sha256");
                    reDownloadedHash.update(reDownloadedFileBuffer);
                    const reDownloadedBase64Sha256 =
                      reDownloadedHash.digest("base64");
                    console.log(
                      `File re-downloaded successfully to: ${reDownloadedFilePath}`,
                    );
                    console.log(
                      `Original ChecksumSHA256 (uploaded): ${base64Sha256Checksum}`,
                    );
                    console.log(
                      `Re-downloaded ChecksumSHA256:     ${reDownloadedBase64Sha256}`,
                    );
                    if (base64Sha256Checksum === reDownloadedBase64Sha256) {
                      console.log(
                        "Checksums MATCH. S3 roundtrip integrity verified.",
                      );
                    } else {
                      console.error(
                        "Checksums DO NOT MATCH. Potential S3 roundtrip integrity issue.",
                      );
                    }
                    resolve();
                  } catch (readError) {
                    reject(readError);
                  }
                });
              });
              file.on("error", (err) => {
                fs.unlink(reDownloadedFilePath, (unlinkErr) => {
                  if (unlinkErr)
                    console.error(
                      `Error deleting partial re-downloaded file ${reDownloadedFilePath} after write error:`,
                      unlinkErr,
                    );
                });
                reject(err);
              });
            })
            .on("error", (err) => {
              fs.unlink(reDownloadedFilePath, (unlinkErr) => {
                if (unlinkErr)
                  console.error(
                    `Error deleting partial re-downloaded file ${reDownloadedFilePath} after https.get error:`,
                    unlinkErr,
                  );
              });
              reject(err);
            });
        });
      } catch (downloadBackError) {
        console.error(
          "Failed to re-download file from S3 for diagnostics:",
          downloadBackError,
        );
      }

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
