# MBTI Closet

A Next.js App Router project initialized with the official `create-next-app` CLI. It uses TypeScript and Tailwind CSS. OpenAI Sites serves the Next.js static export and runs Google sign-in in a Worker.

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
The Next.js dev server serves the frontend. Google sign-in runs on the deployed Sites Worker.

## Production build

```bash
npm run build
```

The app exports to `out/` and is bundled with the Sites Worker at `dist/server/index.js`. The build uses Webpack because Turbopack's CSS worker cannot bind its local IPC port in some restricted environments.

## PWA files

- `src/app/manifest.ts` provides the install metadata.
- `public/sw.js` caches a public offline page and install assets.
- `src/app/service-worker-registration.tsx` registers the service worker in the browser.
- `public/icon.svg` and `public/icon-maskable.svg` provide the app icons.

## Google sign-in

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and an independent random `AUTH_SECRET` in the Sites runtime settings. Register the exact callback URL below on the Google OAuth web client under **Authorized redirect URIs**. The browser redirects through the server, so the Google client needs no JavaScript origin for this flow.

```text
https://mbti-closet.stonyimpala.chatgpt.site/api/auth/callback/google
```

Visitors must first have access to the private Site. The Google account session is separate from Sites access, and Google sign-out ends only the app session.
