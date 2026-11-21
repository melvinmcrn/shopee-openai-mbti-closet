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

## Storage interfaces for Worker handlers

Use the existing Worker origin and method checks when adding authenticated routes. Resolve the owner from the session on every request. The same-origin `POST /api/account` response adds the numeric ID at `user.id`; signed-out clients receive JSON `null`. Sessions created before the stable Google subject was recorded need a fresh Google sign-in.

```js
const account = await resolveAccount(request, env);
if (!account) return new Response(null, { status: 401 });
const records = userData(env.DB, account.id);
```

Import `resolveAccount` from `worker/index.mjs`, `userData` from `worker/user-data.mjs`, and file operations from `worker/private-files.mjs`. The Worker supplies the private `DB` and `BUCKET` bindings.

| Caller | Contract |
| --- | --- |
| Wardrobe upload | `writePrivateFile(env, account, body, contentType)` returns an opaque file ID. Attach it with `records.createWardrobeItem({name, category, imageFileId})`. When attachment fails, call `deletePrivateFile(env, account, imageFileId)` on the unattached upload. |
| Profile | `getProfile()` reads the signed-in user's details and styles. `saveProfile({heightCm, weightKg, facePhotoFileId, setupCompletedAt, styles})` replaces the full profile and style list in one D1 batch. |
| Outfit planner | `listWardrobeItems(category?)` and `getActiveWardrobeItems(ids)` return confirmed, unarchived garments. Each carries a numeric `id`, `category`, and `imageFileId`. `getWardrobeItem(id)` can also load an owned draft or archived item. |
| Image display | Use `/api/files/` followed by `encodeURIComponent(imageFileId)` for GET or HEAD. The Worker checks the signed-in owner and the D1 reference before contacting R2. Signed-out requests receive 401 and other accounts' file IDs receive 404. |
| Image processing | `readPrivateFile(env, account, imageFileId)` returns the referenced R2 object or null. Replace or remove the D1 reference before deleting its object. Archiving retains the image for outfit history. |
| Saved looks | Pass final selections to `saveLook({sourceOptionId, name, slots: [{slot, itemId}]})`. `getSavedLook(id)` returns the saved IDs and captured item names. `getOutfitOption(sourceOptionId)` returns the original slots. A missing or foreign source or an ineligible garment yields null. |

For a shoe swap, keep the original option's shoes ID and pass the replacement shoes ID in the saved `shoes` slot. Reload both records in a fresh session to compare them.
