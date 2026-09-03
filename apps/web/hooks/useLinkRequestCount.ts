"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { getPendingLinkRequests } from "@/lib/api/linkRequests";

export function useLinkRequestCount(): number {
  const { getToken } = useAuth();
  const pathname = usePathname();
  const { data, refetch } = useQuery({
    queryKey: ["link-requests-pending"],
    queryFn: () => getPendingLinkRequests(getToken)
  });
  // The badge stays mounted across navigation, so refetch on each path CHANGE. Skip the first
  // run — the initial fetch already comes from useQuery on mount, so refetching there would
  // duplicate that request on every page load.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    refetch();
  }, [pathname, refetch]);
  return data?.requests.length ?? 0;
}
