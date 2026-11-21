import { GoogleAccount } from "./google-account";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start justify-center gap-5 px-8 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">MBTI Closet</h1>
      <p>A personal style and outfit discovery app.</p>
      <GoogleAccount />
    </main>
  );
}
