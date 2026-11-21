import Image from "next/image";
import { useState } from "react";
import { imageUrl, type Garment } from "./shared";

function WardrobeItem({ garment }: { garment: Garment }) {
  const [imageFailed, setImageFailed] = useState(false);
  const category = garment.category === "other" ? "Original photo" : garment.category;
  return (
    <li className="min-w-0 space-y-1">
      <div className="relative aspect-square max-h-32 overflow-hidden rounded-lg bg-selected">
        {garment.imageRef && !imageFailed && (
          <Image src={imageUrl(garment.imageRef)} alt={garment.name} fill unoptimized
            sizes="128px" className="object-contain" onError={() => setImageFailed(true)} />
        )}
      </div>
      <p className="wrap-break-word text-sm font-medium">{garment.name}</p>
      <p className="wrap-break-word text-xs capitalize text-supporting">
        {[garment.color, category].filter(Boolean).join(" · ")}
      </p>
    </li>
  );
}

export function WardrobePhotos({ garments }: { garments: Garment[] }) {
  if (!garments.length) return null;

  return (
    <div role="group" aria-label="Selected wardrobe photos" className="space-y-2">
      <p className="text-sm font-semibold">From your wardrobe</p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {garments.map(garment => <WardrobeItem key={garment.id + ":" + garment.imageRef} garment={garment} />)}
      </ul>
    </div>
  );
}
