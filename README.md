# MBTI Closet

A Next.js App Router project initialized with the official `create-next-app` CLI. It uses TypeScript, Tailwind CSS, and static export so it can be hosted by OpenAI Sites.

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production build

```bash
npm run build
```

The static site is written to `out/`. The build uses Webpack because Turbopack's CSS worker cannot bind its local IPC port in some restricted environments.

## PWA files

- `src/app/manifest.ts` provides the install metadata.
- `public/sw.js` caches the app shell and same-origin assets for offline visits.
- `src/app/service-worker-registration.tsx` registers the service worker in the browser.
- `public/icon.svg` and `public/icon-maskable.svg` provide the app icons.

The starter is a static PWA. Server Actions, request-time APIs, and other Next.js features that require a persistent server runtime are not available with `output: "export"`.
