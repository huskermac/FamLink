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

export async function createPresignedUpload(mimeType: string): Promise<{
  uploadUrl: string;
  key: string;
  publicUrl: string;
}> {
  const bucket = env.CLOUDFLARE_R2_BUCKET_NAME;
  const publicBase = env.CLOUDFLARE_R2_PUBLIC_URL;
  const ext = mimeType === "image/png" ? "png" : "jpg";
  const key = `${crypto.randomUUID()}.${ext}`;
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mimeType });
  const uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 300 });
  const publicUrl = `${publicBase.replace(/\/$/, "")}/${key}`;
  return { uploadUrl, key, publicUrl };
}

export async function deleteR2Object(key: string): Promise<void> {
  const bucket = env.CLOUDFLARE_R2_BUCKET_NAME;
  await getR2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
