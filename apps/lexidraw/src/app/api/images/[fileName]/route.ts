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
  const entityId = fileName.replace(/-dark.*|-light.*/, '');
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
  const anyOneCanEdit = entity.publicAccess === PublicAccess.EDIT;

  if (!isOwner && !anyOneCanEdit) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    if (!fileName.endsWith(".svg")) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
    }

    const command = new GetObjectCommand({
      Bucket: env.SUPABASE_S3_BUCKET,
      Key: fileName,
    });

    const signedUrl = await getSignedUrl(s3, command, {
      expiresIn: 24 * 60 * 60, // 24 hours
    });

    // client can cache
    const headers = new Headers();
    headers.set("Cache-Control", "public, max-age=86400, immutable");

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
