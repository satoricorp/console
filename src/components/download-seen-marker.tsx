"use client";

import { useEffect } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export function DownloadSeenMarker() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const completeDownloadScreen = useMutation(
    api.userAppState.completeDownloadScreen,
  );

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    void completeDownloadScreen({});
  }, [completeDownloadScreen, isAuthenticated, isLoading]);

  return null;
}
