import { Suspense, type ReactNode } from "react";

export default function WardrobeLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p className="p-5" role="status">Opening wardrobe…</p>}>{children}</Suspense>;
}
