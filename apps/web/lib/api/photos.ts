import { apiFetch } from "@/lib/api";

type GetToken = () => Promise<string | null>;

export interface PresignResponse {
  uploadUrl: string;
  key: string;
  publicUrl: string;
}

export interface EventPhoto {
  id: string;
  eventId: string;
  uploadedById: string;
  key: string;
  url: string;
  createdAt: string;
}

export async function presignUpload(
  mimeType: string,
  getToken: GetToken
): Promise<PresignResponse> {
  return apiFetch<PresignResponse>("/api/v1/photos/presign", {
    getToken,
    method: "POST",
    body: JSON.stringify({ mimeType })
  });
}

export async function uploadToR2(
  uploadUrl: string,
  file: File,
  mimeType: string
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: file
  });
  if (!res.ok) {
    throw new Error(`R2 upload failed: ${res.status}`);
  }
}

export async function confirmEventPhoto(
  eventId: string,
  key: string,
  url: string,
  getToken: GetToken
): Promise<EventPhoto> {
  return apiFetch<EventPhoto>(`/api/v1/photos/events/${encodeURIComponent(eventId)}`, {
    getToken,
    method: "POST",
    body: JSON.stringify({ key, url })
  });
}

export async function getEventPhotos(
  eventId: string,
  getToken: GetToken
): Promise<EventPhoto[]> {
  return apiFetch<EventPhoto[]>(`/api/v1/photos/events/${encodeURIComponent(eventId)}`, {
    getToken,
    method: "GET"
  });
}

export async function deletePhoto(
  photoId: string,
  getToken: GetToken
): Promise<void> {
  return apiFetch(`/api/v1/photos/${encodeURIComponent(photoId)}`, {
    getToken,
    method: "DELETE"
  });
}
