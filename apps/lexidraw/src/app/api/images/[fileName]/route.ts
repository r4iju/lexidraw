import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "~/server/s3"; // Your S3 client setup
import env from "@packages/env";
import { auth } from "~/server/auth";
import { drizzle, eq, schema } from "@packages/drizzle";
import { PublicAccess } from "@packages/types";

export async function GET(req: NextRequest, { params }: { params: Promise<{ fileName: string }> }) {
  const fileName = (await params).fileName;
  // match first uuid with regex in filename
  const entityId = fileName.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/)?.[0];
  if (!entityId) {
    return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
  }
  const session = await auth();

  const entity = (await drizzle.select({
    id: schema.entity.id,
    userId: schema.entity.userId,
    publicAccess: schema.entity.publicAccess,
  }).from(schema.entity)
    .where(eq(schema.entity.id, entityId)))[0]

  if (!entity) {
    console.error('entity not found');
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }

  const isOwner = entity.userId === session?.user.id;
  const anyOneCanView = entity.publicAccess !== PublicAccess.PRIVATE;

  if (!isOwner && !anyOneCanView) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }


  try {
    if (
      !fileName.endsWith(".svg") &&
      !fileName.endsWith(".png") &&
      !fileName.endsWith(".jpg") &&
      !fileName.endsWith(".jpeg") &&
      !fileName.endsWith(".avif") &&
      !fileName.endsWith(".webp")
    ) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
    }

    const command = new GetObjectCommand({
      Bucket: env.SUPABASE_S3_BUCKET,
      Key: fileName,
    });

    const expiresIn = 7 * 24 * 60 * 60; // 7 days

    const signedUrl = await getSignedUrl(s3, command, {
      expiresIn,
    });

    // client can cache
    const headers = new Headers();
    headers.set("Cache-Control", `public, max-age=${expiresIn}, immutable`);
    headers.set("Access-Control-Allow-Origin", "*");

    // Redirect to the signed URL
    return NextResponse.redirect(signedUrl, {
      status: 302,
      headers,
    });
  } catch (error) {
    console.error("Error generating signed URL:", error);

    return NextResponse.json({ error: "Failed to generate signed URL" }, { status: 500 });
  }
}
