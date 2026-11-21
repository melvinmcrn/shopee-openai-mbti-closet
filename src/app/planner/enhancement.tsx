"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { api } from "./shared";

export type CatalogProduct = {
  id: string;
  title: string;
  url: string;
  imageUrl: string;
  price: number;
  currency: string;
};

export function EnhancementProduct({ product, sponsored = false }: { product: CatalogProduct; sponsored?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-xl border border-divider bg-canvas p-3">
      {!imageFailed && (
        <Image src={product.imageUrl} alt="" width={80} height={80} unoptimized
          className="size-20 shrink-0 rounded-lg bg-selected object-contain"
          onError={() => setImageFailed(true)}
        />
      )}
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-semibold text-secondary">Optional enhancement{sponsored && " · Sponsored"}</p>
        <p className="wrap-break-word text-sm font-semibold">{product.title}</p>
        <p className="text-sm">{new Intl.NumberFormat("en", { style: "currency", currency: product.currency }).format(product.price)}</p>
        <a href={product.url} target="_blank" rel={sponsored ? "sponsored noopener noreferrer" : "noopener noreferrer"}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-secondary underline underline-offset-2">
          Buy on Shopee<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </div>
  );
}

function EnhancementForSelection({ optionId, selection }: { optionId: string; selection: string }) {
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    // Let rapid swaps settle before evaluating the draft.
    const timer = setTimeout(() => {
      api<CatalogProduct | null>("enhancement", { optionId, slots: JSON.parse(selection) })
        .then(result => { if (active) setProduct(result); })
        .catch(() => { if (active) setFailed(true); });
    }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [optionId, selection, attempt]);

  if (failed) return (
    <button type="button" className="min-h-11 text-sm font-semibold text-secondary underline" onClick={() => {
      setFailed(false);
      setAttempt(value => value + 1);
    }}>Retry enhancement check</button>
  );
  return product && <div className="my-3"><EnhancementProduct product={product} /></div>;
}

export function LookEnhancement({ optionId, slots }: { optionId: string; slots: Record<string, string> }) {
  if (!Object.keys(slots).length) return null;
  const selection = JSON.stringify(slots, Object.keys(slots).sort());
  return <EnhancementForSelection key={optionId + selection} optionId={optionId} selection={selection} />;
}
