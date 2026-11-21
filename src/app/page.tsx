import Image from "next/image";
import Link from "next/link";
import { GoogleAccount } from "./google-account";

function WardrobeCollage() {
  return (
    <div className="grid grid-cols-[2fr_1fr] grid-rows-2 gap-2" aria-label="A shirt, trousers, and sneakers" role="img">
      <div className="row-span-2 flex items-center justify-center rounded-[28px] bg-selected px-8 py-6">
        <svg viewBox="0 0 160 180" className="h-full max-h-48 w-full" aria-hidden="true">
          <path d="M53 25 28 37 10 74l26 14 12-19v83h64V69l12 19 26-14-18-37-25-12c-5 13-14 20-27 20S58 38 53 25Z" className="fill-primary" />
          <path d="m53 25 13 21 14-12 14 12 13-21M80 34v118" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" className="stroke-secondary" />
          <circle cx="80" cy="67" r="2.5" className="fill-canvas" />
          <circle cx="80" cy="83" r="2.5" className="fill-canvas" />
          <circle cx="80" cy="99" r="2.5" className="fill-canvas" />
        </svg>
      </div>
      <div className="flex items-center justify-center rounded-[24px] bg-selected">
        <svg viewBox="0 0 100 100" className="h-20 w-20" aria-hidden="true">
          <path d="M30 9h40l7 24-9 10 8 47H54l-4-34-4 34H24l8-47-9-10 7-24Z" className="fill-secondary" />
          <path d="M31 14h38M50 42v46" fill="none" strokeLinecap="round" strokeWidth="3" className="stroke-canvas" />
        </svg>
      </div>
      <div className="flex items-center justify-center rounded-[24px] bg-selected">
        <svg viewBox="0 0 100 100" className="h-20 w-20" aria-hidden="true">
          <path d="M17 59c13 0 23-9 28-24h13c4 13 10 19 22 24 6 3 9 9 9 18v7H16v-9c0-9 2-16 9-16Z" strokeLinejoin="round" strokeWidth="4" className="fill-canvas stroke-secondary" />
          <path d="M19 73h65M49 49l9 2m-13 5 10 2" fill="none" strokeLinecap="round" strokeWidth="4" className="stroke-primary" />
        </svg>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[390px] flex-1 flex-col px-6 pb-7 pt-5">
      <header className="flex items-center justify-between border-b border-divider pb-4">
        <Link href="/" className="flex h-[30px] items-center" aria-label="Closet home">
          <Image src="/closet-logo.svg" alt="" width={84} height={22} unoptimized />
        </Link>
        <span className="text-sm font-semibold text-secondary">Your personal stylist</span>
      </header>

      <section className="flex flex-1 flex-col pt-7">
        <WardrobeCollage />
        <h1 className="mt-9 font-heading text-[39px] font-bold leading-[1.08] tracking-[-0.045em] text-text">
          Get dressed from<br />your own closet.
        </h1>
        <p className="mt-5 max-w-[34ch] text-[17px] leading-[1.45] text-supporting">
          Add a few clothes, then tell us where you’re going. We’ll plan a look around what you already own.
        </p>
      </section>

      <GoogleAccount />
    </main>
  );
}
