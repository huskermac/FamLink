"use client";

import { useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  presignUpload,
  uploadToR2,
  confirmEventPhoto,
  getEventPhotos,
  deletePhoto,
  type EventPhoto
} from "@/lib/api/photos";

interface Props {
  eventId: string;
}

export function PhotoGallery({ eventId }: Props) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: photos = [], isLoading } = useQuery({
    queryKey: ["event-photos", eventId],
    queryFn: () => getEventPhotos(eventId, getToken)
  });

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const mimeType = file.type as "image/jpeg" | "image/png" | "image/webp";
    setUploading(true);
    setError(null);
    try {
      const { uploadUrl, key, publicUrl } = await presignUpload(mimeType, getToken);
      await uploadToR2(uploadUrl, file, mimeType);
      await confirmEventPhoto(eventId, key, publicUrl, getToken);
      await qc.invalidateQueries({ queryKey: ["event-photos", eventId] });
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(photo: EventPhoto) {
    try {
      await deletePhoto(photo.id, getToken);
      await qc.invalidateQueries({ queryKey: ["event-photos", eventId] });
    } catch {
      setError("Delete failed. Please try again.");
    }
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-md bg-slate-700" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Photos ({photos.length})
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFile}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 hover:bg-indigo-500"
        >
          {uploading ? "Uploading…" : "Add photo"}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {photos.length === 0 ? (
        <p className="text-sm text-slate-500 italic">No photos yet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="group relative aspect-square">
              <img
                src={photo.url}
                alt="Event photo"
                className="h-full w-full rounded-md object-cover"
              />
              <button
                onClick={() => handleDelete(photo)}
                className="absolute right-1 top-1 hidden rounded-full bg-black/60 px-1.5 py-0.5 text-xs text-white group-hover:block"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
