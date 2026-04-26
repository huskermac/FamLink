import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiFetch } from "../lib/api";

export interface EventPhoto {
  id: string;
  eventId: string;
  uploadedById: string;
  key: string;
  url: string;
  createdAt: string;
}

export function useEventPhotos(eventId: string) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["event-photos", eventId],
    queryFn: () => apiFetch<EventPhoto[]>(`/api/v1/photos/events/${eventId}`)
  });
}

export function useUploadEventPhoto(eventId: string) {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ uri, mimeType }: { uri: string; mimeType: string }) => {
      const { uploadUrl, key, publicUrl } = await apiFetch<{
        uploadUrl: string;
        key: string;
        publicUrl: string;
      }>("/api/v1/photos/presign", {
        method: "POST",
        body: JSON.stringify({ mimeType })
      });

      const fileRes = await fetch(uri);
      const blob = await fileRes.blob();
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: blob
      });
      if (!uploadRes.ok) {
        throw new Error(`R2 upload failed: ${uploadRes.status}`);
      }

      return apiFetch<EventPhoto>(`/api/v1/photos/events/${eventId}`, {
        method: "POST",
        body: JSON.stringify({ key, url: publicUrl })
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["event-photos", eventId] });
    }
  });
}

export function useDeletePhoto(eventId: string) {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) =>
      apiFetch(`/api/v1/photos/${photoId}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["event-photos", eventId] });
    }
  });
}
