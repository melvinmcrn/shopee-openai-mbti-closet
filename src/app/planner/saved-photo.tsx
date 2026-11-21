import Image from "next/image";
import { useEffect, useState } from "react";
import { api, imageUrl, type SavedLook } from "./shared";
import type { LoadTryOn } from "./try-on";

export type FindTryOn = LoadTryOn["find"];

export function SavedPhoto({ look, findTryOn }: { look: SavedLook; findTryOn: FindTryOn }) {
  const existing = look.previewRef ? undefined : findTryOn(look);
  const [imageRef, setImageRef] = useState(look.previewRef);
  const [loading, setLoading] = useState(Boolean(existing));
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    existing?.then(result => {
      if (active) setImageRef(result.imageRef);
    }).catch(() => {
      if (active) setError("The try-on could not be created.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [existing]);

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ imageRef: string }>("savedPreview", { id: look.id });
      setImageRef(result.imageRef);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The try-on could not be created.");
    } finally {
      setLoading(false);
    }
  }

  if (imageRef) return (
    <Image src={imageUrl(imageRef)} alt={`Full-body AI try-on for ${look.occasion}`}
      width={512} height={768} unoptimized className="aspect-[2/3] w-full rounded-xl bg-selected object-contain"
      onError={() => { setImageRef(null); setError("The try-on photo couldn’t be loaded."); }} />
  );
  return (
    <div className="grid min-h-24 place-items-center gap-2 rounded-xl bg-selected p-4 text-center text-sm">
      {error && <p role="alert">{error}</p>}
      {loading ? <p role="status">Creating your try-on…</p> : (
        <button type="button" className="min-h-11 rounded-full border border-divider bg-surface px-4 font-semibold"
          onClick={generate}>{error ? "Retry try-on" : "Create try-on photo"}</button>
      )}
    </div>
  );
}
