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
  wardrobeGap?: "top" | "bottom";
};

export function EnhancementProduct({ product, sponsored = false }: { product: CatalogProduct; sponsored?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <a
      href={product.url}
      target="_blank"
      rel={sponsored ? "sponsored noopener noreferrer" : "noopener noreferrer"}
      className="group flex min-w-0 flex-wrap items-start gap-3 rounded-xl border border-divider bg-canvas p-3 hover:border-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
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

export function useLookEnhancement(optionId: string, slots: Record<string, string>) {
  const selection = JSON.stringify(slots, Object.keys(slots).sort());
  const key = optionId + selection;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; products?: CatalogProduct[]; failed?: boolean }>();

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api<CatalogProduct[]>("enhancements", { optionId, slots: JSON.parse(selection) })
        .then(products => { if (active) setResult({ key, products }); })
        .catch(() => { if (active) setResult({ key, failed: true }); });
    }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [optionId, key, selection, attempt]);

  const products = result?.key === key ? result.products : undefined;
  function retry() {
    setResult(undefined);
    setAttempt(value => value + 1);
  }
  return { products, failed: result?.key === key && result.failed, retry };
}

export function EnhancementCard({ products, failed, retry }: ReturnType<typeof useLookEnhancement>) {
  if (failed) return (
    <button type="button" className="min-h-11 text-sm font-semibold text-secondary underline"
      onClick={retry}>Retry enhancement check</button>
  );
  if (!products) return <p role="status" className="my-3 text-sm text-supporting">Checking for pieces to complete your look…</p>;
  if (!products.length) return null;
  return (
    <section aria-label="Elevate your look" className="my-3 space-y-2">
      {products.map(product => <EnhancementProduct key={product.id} product={product} />)}
    </section>
  );
}

export function LookEnhancement({ optionId, slots }: { optionId: string; slots: Record<string, string> }) {
  const enhancement = useLookEnhancement(optionId, slots);
  return <EnhancementCard {...enhancement} />;
}
