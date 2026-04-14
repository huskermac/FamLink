"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateRsvp, type RsvpStatus } from "@/lib/api/events";

interface Props {
  eventId: string;
  currentStatus: RsvpStatus | null;
}

const STATUSES: RsvpStatus[] = ["YES", "NO", "MAYBE"];

const LABELS: Record<RsvpStatus, string> = {
  YES: "Yes",
  NO: "No",
  MAYBE: "Maybe",
  PENDING: "Pending"
};

export function RsvpButton({ eventId, currentStatus }: Props) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (status: RsvpStatus) => updateRsvp(eventId, status, getToken),
    onMutate: async (status) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ["event", eventId] });
      queryClient.setQueryData<{ rsvp: { status: RsvpStatus } }>(
        ["event", eventId, "myRsvp"],
        { rsvp: { status } }
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    }
  });

  return (
    <div className="flex gap-2" role="group" aria-label="RSVP">
      {STATUSES.map((status) => {
        const isActive = currentStatus === status;
        return (
          <button
            key={status}
            onClick={() => mutation.mutate(status)}
            disabled={mutation.isPending}
            aria-pressed={isActive}
            className={[
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-indigo-600 text-white"
                : "border border-slate-600 text-slate-300 hover:border-indigo-500 hover:text-indigo-300"
            ].join(" ")}
          >
            {LABELS[status]}
          </button>
        );
      })}
    </div>
  );
}
