"use client";

import { useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import { presignUpload, uploadToR2 } from "@/lib/api/photos";
import { updatePersonPhotoUrl } from "@/lib/api/family";

interface Props {
  personId: string;
}

export function ProfilePhotoUploadButton({ personId }: Props) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const mimeType = file.type as "image/jpeg" | "image/png" | "image/webp";
    setUploading(true);
    setError(null);
    try {
      const { uploadUrl, publicUrl } = await presignUpload(mimeType, getToken);
      await uploadToR2(uploadUrl, file, mimeType);
      await updatePersonPhotoUrl(personId, publicUrl, getToken);
      await qc.invalidateQueries({ queryKey: ["person", personId] });
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1">
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
        {uploading ? "Uploading…" : "Change photo"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
