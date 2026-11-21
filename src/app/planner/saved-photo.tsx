import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { imageUrl, type SavedLook } from "./shared";
import { requestTryOn } from "./try-on";

type SavedPhotoProps = { look: SavedLook; catalogItemIds: string[] };

export function SavedPhoto(props: SavedPhotoProps) {
  return <SavedPhotoForSelection key={JSON.stringify([props.look.id, props.look.previewRef, [...props.catalogItemIds].sort()])} {...props} />;
}

function SavedPhotoForSelection({ look, catalogItemIds }: SavedPhotoProps) {
  const matchesDetail = catalogItemIds.length === look.enhancements.length &&
    look.enhancements.every(product => catalogItemIds.includes(product.id));
  const [imageRef, setImageRef] = useState(matchesDetail ? look.previewRef : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(false);
  const [reload, setReload] = useState(0);
  const pending = useRef(false);

  async function generate() {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await requestTryOn("savedPreview", { id: look.id, catalogItemIds });
      setImageRef(result.imageRef);
      setChecked(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The try-on could not be created.");
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }

  if (imageRef && !error) return (
    <Image src={imageUrl(imageRef) + (reload ? "?retry=" + reload : "")} alt={`Full-body AI try-on for ${look.occasion}`}
      width={512} height={768} unoptimized className="aspect-[2/3] w-full rounded-xl bg-selected object-contain"
      onError={() => setError("The try-on photo couldn’t be loaded.")} />
  );
  if (checked && !loading && !error) return null;
  return (
    <div className="grid min-h-24 place-items-center gap-2 rounded-xl bg-selected p-4 text-center text-sm">
      {error && <p role="alert">{error}</p>}
      {imageRef ? (
        <button type="button" className="min-h-11 rounded-full border border-divider bg-surface px-4 font-semibold"
          onClick={() => { setReload(value => value + 1); setError(""); }}>Reload photo</button>
      ) : loading ? <p role="status">Creating your try-on…</p> : (!checked || error) && (
        <button type="button" className="min-h-11 rounded-full border border-divider bg-surface px-4 font-semibold"
          aria-describedby={`saved-photo-use-${look.id}`}
          onClick={generate}>{error ? "Retry try-on" : "Create try-on with my profile photo"}</button>
      )}
      {!loading && (
        <p id={`saved-photo-use-${look.id}`} className="text-supporting">
          OpenAI uses your photo to create the try-on.{" "}
          <Link href="/profile/settings" className="font-semibold underline">Add or update your profile photo</Link>
        </p>
      )}
    </div>
  );
}
