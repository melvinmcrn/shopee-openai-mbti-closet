import Image from "next/image";
import { useEffect, useState } from "react";
import type { CatalogProduct } from "./enhancement";
import { imageUrl, type Look } from "./shared";
import { listingKey, type LoadTryOn } from "./try-on";

type PhotoProps = { look: Look; products: CatalogProduct[]; loadTryOn: LoadTryOn; alt: string };

export function TryOnPhoto(props: PhotoProps) {
  return <PhotoForSelection key={JSON.stringify([props.look.id, props.look.slots, listingKey(props.products)])} {...props} />;
}

function PhotoForSelection({ look, products, loadTryOn, alt }: PhotoProps) {
  const [attempt, setAttempt] = useState(0);
  const [imageRef, setImageRef] = useState<string | null>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    loadTryOn(look, products).then(result => {
      if (active) setImageRef(result.imageRef);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : "Couldn’t generate the try-on.");
    });
    return () => { active = false; };
  }, [look, products, attempt, loadTryOn]);

  if (error) return (
    <div className="space-y-2 p-3 text-sm">
      <p role="alert">{error}</p>
      <button type="button" className="min-h-11 rounded-full border border-divider px-5 font-semibold" onClick={() => {
        setError("");
        setImageRef(undefined);
        setAttempt(count => count + 1);
      }}>Retry styled image</button>
    </div>
  );
  if (imageRef === null) return null;
  return (
    <div className="relative grid aspect-[2/3] place-items-center overflow-hidden rounded-xl bg-selected">
      {imageRef ? (
        <Image src={imageUrl(imageRef)} alt={alt} fill unoptimized className="object-contain"
          onError={() => setError("Couldn’t load the try-on.")} />
      ) : (
        <p role="status" className="px-5 text-center text-sm text-supporting">Creating your full-body try-on…</p>
      )}
    </div>
  );
}
