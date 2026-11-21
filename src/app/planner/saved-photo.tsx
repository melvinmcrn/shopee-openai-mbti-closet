import Image from "next/image";
import { useEffect, useState } from "react";
import { api, imageUrl, type SavedLook } from "./shared";
import type { LoadTryOn, TryOnResult } from "./try-on";

export type FindTryOn = LoadTryOn["find"];

type SavedPhotoProps = { look: SavedLook; findTryOn: FindTryOn; catalogItemIds: string[] };

export function SavedPhoto(props: SavedPhotoProps) {
  return <SavedPhotoForSelection key={JSON.stringify([props.look.id, props.look.previewRef, [...props.catalogItemIds].sort()])} {...props} />;
}

function SavedPhotoForSelection({ look, findTryOn, catalogItemIds }: SavedPhotoProps) {
  const visible = look.enhancements.filter(product => catalogItemIds.includes(product.id));
  const matchesDetail = visible.length === catalogItemIds.length && visible.length === look.enhancements.length;
  const cached = matchesDetail ? look.previewRef : null;
  const existing = !cached && matchesDetail ? findTryOn(look, visible) : undefined;
  const [imageRef, setImageRef] = useState(cached);
  const [loading, setLoading] = useState(Boolean(existing));
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    existing?.then(result => {
      if (active) {
        setImageRef(result.imageRef);
        setChecked(true);
      }
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
      const result = await api<TryOnResult>("savedPreview", { id: look.id, catalogItemIds });
      setImageRef(result.imageRef);
      setChecked(true);
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
  if (checked && !loading && !error) return null;
  return (
    <div className="grid min-h-24 place-items-center gap-2 rounded-xl bg-selected p-4 text-center text-sm">
      {error && <p role="alert">{error}</p>}
      {loading ? <p role="status">Creating your try-on…</p> : (!checked || error) && (
        <button type="button" className="min-h-11 rounded-full border border-divider bg-surface px-4 font-semibold"
          onClick={generate}>{error ? "Retry try-on" : "Create try-on photo"}</button>
      )}
    </div>
  );
}
