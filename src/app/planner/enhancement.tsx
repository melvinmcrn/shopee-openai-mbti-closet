"use client";

import Image from "next/image";
import { useState } from "react";

export type CatalogProduct = {
  id: string;
  title: string;
  url: string;
  imageUrl: string;
  price: number;
  currency: string;
  wardrobeGap?: "top" | "bottom";
  catalogSlot?: string;
};

export function EnhancementProduct({ product, sponsored = false }: { product: CatalogProduct; sponsored?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <a
      href={product.url}
      target="_blank"
      rel={sponsored ? "sponsored noopener noreferrer" : "noopener noreferrer"}
      className="group flex min-w-0 flex-wrap items-start gap-3 rounded-xl border border-secondary/35 bg-selected p-3 hover:border-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
    >
      {!imageFailed && (
        <Image src={product.imageUrl} alt="" width={80} height={80} unoptimized
          className="size-20 shrink-0 rounded-lg bg-selected object-contain"
          onError={() => setImageFailed(true)}
        />
      )}
      <div className="min-w-0 flex-1 basis-32 space-y-1">
        <p className="flex flex-wrap items-center gap-x-1 text-xs font-semibold text-secondary">
          <span aria-hidden="true">✨</span>
          <span>Elevate your look</span>
          {product.wardrobeGap && <span>· {product.wardrobeGap === "top" ? "Suggested top" : "Suggested pants"}</span>}
          {product.catalogSlot && <span>· <span className="capitalize">{product.catalogSlot}</span></span>}
          {sponsored && <span>· Sponsored</span>}
        </p>
        <p className="wrap-break-word text-sm font-semibold">{product.title}</p>
        <p className="text-sm">{new Intl.NumberFormat("en", { style: "currency", currency: product.currency }).format(product.price)}</p>
        <span className="inline-block pt-1 text-sm font-semibold text-secondary underline underline-offset-2 group-hover:decoration-2">
          Buy on Shopee<span className="sr-only"> (opens in a new tab)</span>
        </span>
      </div>
    </a>
  );
}
