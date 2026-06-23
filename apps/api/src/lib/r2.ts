import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "node:crypto";
import { env } from "./env";

function getR2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY
    }
  });
}

/** Public URL for an R2 object key — always on our R2 public domain. */
export function publicUrlForKey(key: string): string {
  return `${env.CLOUDFLARE_R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
}

/** Key prefix that scopes an upload to the person who requested it. */
export function uploadKeyPrefix(ownerPersonId: string): string {
  return `uploads/${ownerPersonId}/`;
}

export async function createPresignedUpload(
  mimeType: string,
  ownerPersonId: string
): Promise<{
  uploadUrl: string;
  key: string;
  publicUrl: string;
}> {
  const bucket = env.CLOUDFLARE_R2_BUCKET_NAME;
  const ext = mimeType === "image/png" ? "png" : "jpg";
  const key = `${uploadKeyPrefix(ownerPersonId)}${crypto.randomUUID()}.${ext}`;
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mimeType });
  const uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 300 });
  return { uploadUrl, key, publicUrl: publicUrlForKey(key) };
}

export async function deleteR2Object(key: string): Promise<void> {
  const bucket = env.CLOUDFLARE_R2_BUCKET_NAME;
  await getR2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
