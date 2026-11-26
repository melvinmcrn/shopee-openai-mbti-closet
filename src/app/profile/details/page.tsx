"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ProfileDetailsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/wardrobe/add?from=onboarding");
  }, [router]);

  return <p className="p-5 text-sm text-supporting" role="status">Opening your wardrobe…</p>;
}
