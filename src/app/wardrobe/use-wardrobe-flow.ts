"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { privateFetch } from "../private-fetch.mjs";
import { wardrobeDestination, wardrobeOrigin } from "./flow.mjs";

export function useWardrobeFlow() {
  const origin = wardrobeOrigin(useSearchParams());
  const [completedAt, setCompletedAt] = useState<string | null>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const needsProfile = origin.from !== "planner" && origin.from !== "closet";

  useEffect(() => {
    if (!needsProfile) return;
    const controller = new AbortController();
    async function loadSetupStatus() {
      try {
        const response = await privateFetch("/api/profile", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Profile unavailable");
        const { setupCompletedAt } = await response.json();
        if (setupCompletedAt !== null && typeof setupCompletedAt !== "string") throw new Error("Invalid profile");
        if (!controller.signal.aborted) setCompletedAt(setupCompletedAt);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }
    void loadSetupStatus();
    return () => controller.abort();
  }, [attempt, needsProfile]);

  function retry() {
    setError(false);
    setAttempt(count => count + 1);
  }

  return { origin, destination: wardrobeDestination(origin, completedAt), error: needsProfile && error, retry };
}
