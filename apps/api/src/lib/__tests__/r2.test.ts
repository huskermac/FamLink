import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSignedUrl = vi.fn();
const mockSend = vi.fn();

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args)
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(function () { return { send: (...args: unknown[]) => mockSend(...args) }; }),
  PutObjectCommand: vi.fn(function (params: unknown) { return { ...(params as object), _type: "PutObjectCommand" }; }),
  DeleteObjectCommand: vi.fn(function (params: unknown) { return { ...(params as object), _type: "DeleteObjectCommand" }; })
}));

beforeEach(() => {
  vi.resetAllMocks();
  process.env.CLOUDFLARE_R2_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "test-key";
  process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "test-secret";
  process.env.CLOUDFLARE_R2_BUCKET_NAME = "test-bucket";
  process.env.CLOUDFLARE_R2_PUBLIC_URL = "https://pub.example.com";
  mockGetSignedUrl.mockResolvedValue("https://r2.example.com/presigned-url");
  mockSend.mockResolvedValue({});
});

describe("createPresignedUpload", () => {
  it("returns uploadUrl from getSignedUrl and key with .jpg ext for image/jpeg", async () => {
    const { createPresignedUpload } = await import("../r2");
    const result = await createPresignedUpload("image/jpeg");
    expect(result.uploadUrl).toBe("https://r2.example.com/presigned-url");
    expect(result.key).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(result.publicUrl).toBe(`https://pub.example.com/${result.key}`);
  });

  it("uses .png extension for image/png", async () => {
    const { createPresignedUpload } = await import("../r2");
    const result = await createPresignedUpload("image/png");
    expect(result.key).toMatch(/\.png$/);
  });

  it("uses .jpg extension for image/webp and image/heic", async () => {
    const { createPresignedUpload } = await import("../r2");
    const resultWebp = await createPresignedUpload("image/webp");
    const resultHeic = await createPresignedUpload("image/heic");
    expect(resultWebp.key).toMatch(/\.jpg$/);
    expect(resultHeic.key).toMatch(/\.jpg$/);
  });
});

describe("deleteR2Object", () => {
  it("calls send with DeleteObjectCommand", async () => {
    const { deleteR2Object } = await import("../r2");
    await deleteR2Object("some-key.jpg");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
