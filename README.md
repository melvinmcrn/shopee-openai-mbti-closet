# Closet

A Next.js App Router project initialized with the official `create-next-app` CLI. It uses TypeScript and Tailwind CSS. It is hosted on Vercel with Supabase (PostgreSQL and private storage); Google sign-in runs in the Next.js Route Handler.

## Local development

```bash
npm install
npm run dev:vercel
```

Open [http://localhost:3000](http://localhost:3000).
`npm run dev:vercel` runs the Vercel/Supabase target locally (see below). For frontend hot reload only, use `npm run dev:frontend`, which serves the Next.js UI without the API.

To enable local sign-in, create an untracked `.env.local` file in the project root:

```dotenv
GOOGLE_CLIENT_ID=<local Google OAuth web client ID>
GOOGLE_CLIENT_SECRET=<local Google OAuth web client secret>
AUTH_SECRET=<random value from openssl rand -base64 32>
```

Add `http://localhost:3000/api/auth/callback/google` under **Authorized redirect URIs** in the local Google OAuth web client. Use `localhost` in the browser so the origin matches exactly.

## Wardrobe photo extraction

Set `OPENAI_API_KEY` as a server-only environment variable in Vercel (or in the ignored `.env.local` for local development). The API project must have access to GPT-6 Luna, Fast tier, and the built-in image generation tool.

Wardrobe extraction sends a normalized photo or a contact sheet of up to 20 photos in one OpenAI Responses request using `gpt-6-luna`, High reasoning, and Fast service. Luna identifies each visible garment and accessory, keeping a matched pair of shoes together. It uses `gpt-image-2.5-flare` to return transparent cutouts in the same order as each photo’s item list. The backend validates the layout and saves each cutout privately as a separate draft with an editable name, category, garment type, and color. A photo with missing or ambiguous cutouts stays available for manual review.

`WARDROBE_EXTRACTION_FIXTURES=1` is only for exact test/demo photos with precomputed cutouts; it is not a substitute for production API access.

## Production build

```bash
npm run build:vercel
```

The build uses Webpack because Turbopack's CSS worker cannot bind its local IPC port in some restricted environments.

## PWA files

- `src/app/manifest.webmanifest` provides the install metadata.
- `public/sw.js` caches a public offline page and install assets.
- `src/app/service-worker-registration.tsx` registers the service worker in the browser.
- `public/icon.svg` and `public/icon-maskable.svg` provide the app icons.

## Google sign-in

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and an independent random `AUTH_SECRET` in the Vercel project's environment variables. Register the exact callback URL below on the Google OAuth web client under **Authorized redirect URIs**. The browser redirects through the server, so the Google client needs no JavaScript origin for this flow.

```text
https://<your-vercel-domain>/api/auth/callback/google
```

Google sign-out ends only the app session.

## Vercel development with Supabase

Vercel uses `npm run build:vercel` from `vercel.json`. Its Next.js Route Handler serves the account, profile, wardrobe, private file, and planner APIs directly from `src/app/api/_server/`.

1. Create a separate Supabase development project and apply the SQL in `supabase/migrations/` there. Use the [Supabase CLI migration workflow](https://supabase.com/docs/guides/deployment/database-migrations) to link the development project and run `supabase db push`. Keep the `app` schema out of Supabase's exposed schemas.
2. Create a **private** Storage bucket named `closet-private`. The app checks file ownership before it reads or serves an object. Give the backend the project URL and a [Supabase secret key](https://supabase.com/docs/guides/api/api-keys), available only in server environment variables.
3. Set the variables listed in `.env.vercel.example` in Vercel. Use the Supabase transaction pooler connection string for `DATABASE_URL` with a dedicated runtime login. Set `APP_ORIGIN` to the exact stable Vercel development origin and set a separate `AUTH_SECRET`. `OPENAI_API_KEY` enables the existing AI features in development.
4. In the development Google OAuth web client, add `https://shopee-openai-mbti-closet.vercel.app/api/auth/callback/google` under **Authorized redirect URIs**. If you use a different stable development domain, use that domain in both the callback and `APP_ORIGIN`. Log in from the configured domain so the OAuth cookies and origin checks agree.

To run this target locally, copy `.env.vercel.example` to `.env.local`, fill in the development values, register `http://localhost:3000/api/auth/callback/google`, and run `npm run dev:vercel`. For Vercel development, use images under 4 MB to stay below the default [Function payload limit](https://vercel.com/docs/functions/limitations). ChatGPT Sites uses its existing upload limits.

Create the development runtime login from an admin `psql` session after applying the migration. The two SQL statements grant this login only the permissions defined by the migration. The psql password command prompts without putting the password in the command history.

```sql
CREATE ROLE mbti_closet_vercel LOGIN;
GRANT mbti_closet_runtime TO mbti_closet_vercel;
```

In the same session, run `\password mbti_closet_vercel`. In the pooler connection string, replace the `postgres` role in the username with `mbti_closet_vercel`, retain the project reference, and use the new password. Set `SUPABASE_DB_CA` to the full PEM certificate from Supabase Database Settings so the runtime can verify the pooler’s identity. Keep database and Storage secrets in Vercel’s server environment.

## Storage interfaces for Worker handlers

Use the existing Worker origin and method checks when adding authenticated routes. Resolve the owner from the session on every request. The same-origin `POST /api/account` response adds the numeric ID at `user.id`; signed-out clients receive JSON `null`. Sessions created before the stable Google subject was recorded need a fresh Google sign-in.

```js
const account = await resolveAccount(request, env);
if (!account) return new Response(null, { status: 401 });
const records = userData(env.DB, account.id);
```

Import `resolveAccount` from `src/app/api/_server/handle-api.mjs`, `userData` from `src/app/api/_server/user-data.mjs`, and file operations from `src/app/api/_server/private-files.mjs`. The Worker supplies the private `DB` and `BUCKET` bindings.

| Caller | Contract |
| --- | --- |
| Wardrobe upload | `writePrivateFile(env, account, body, contentType)` returns an opaque file ID. Attach it with `records.createWardrobeItem({name, category, imageFileId})`. When attachment fails, call `deletePrivateFile(env, account, imageFileId)` on the unattached upload. |
| Profile | `getProfile()` reads the signed-in user's details and styles. `saveProfile({heightCm, weightKg, facePhotoFileId, setupCompletedAt, styles})` replaces the full profile and style list in one D1 batch. |
| Outfit planner | `listWardrobeItems(category?)` and `getActiveWardrobeItems(ids)` return confirmed, unarchived garments. Each carries a numeric `id`, `category`, and `imageFileId`. `getWardrobeItem(id)` can also load an owned draft or archived item. |
| Image display | Use `/api/files/` followed by `encodeURIComponent(imageFileId)` for GET or HEAD. The Worker checks the signed-in owner and the D1 reference before contacting R2. Signed-out requests receive 401 and other accounts' file IDs receive 404. |
| Image processing | `readPrivateFile(env, account, imageFileId)` returns the referenced R2 object or null. Replace or remove the D1 reference before deleting its object. Archiving retains the image for outfit history. |
| Saved looks | Pass final selections to `saveLook({sourceOptionId, name, slots: [{slot, itemId}]})`. `getSavedLook(id)` returns the saved IDs and captured item names. `getOutfitOption(sourceOptionId)` returns the original slots. A missing or foreign source or an ineligible garment yields null. |

For a shoe swap, keep the original option's shoes ID and pass the replacement shoes ID in the saved `shoes` slot. Reload both records in a fresh session to compare them.

## Closet journey report

Operators can run one read-only aggregate query against the PostgreSQL deployment. The arguments are UTC dates, with the start included and the end excluded.

Use a configured read-only operator connection with SELECT access to `app.users` and `app.journey_activity`. The following uses the operator’s standard libpq connection settings.

```sh
node scripts/closet-journeys.mjs postgres 2026-12-01 2026-12-08 | psql -X -v ON_ERROR_STOP=1
```

- **First own look.** The denominator includes every account created during the window. An account succeeds when it saves a look containing at least one garment from its own wardrobe before the window ends. Starter samples, demo fixture cutouts and catalog pieces do not qualify. Time starts at account creation. The migration backfills existing saved looks. Future deletions preserve the first qualifying timestamp. Looks deleted before migration cannot be recovered.
- **Returning visits.** A visit groups signed-in foreground page opens, planner navigation and recorded outcomes for one account across tabs and devices until 30 minutes of inactivity. Account creation anchors the initial visit. The report counts subsequent visits that start within the window and contain an observed open. Existing accounts returning after the inactivity threshold qualify on their first observed visit after rollout. Each visit can count once per outcome. The report shows setup and planner recovery separately and together. It also shows successful reopen, newly logged wear, and the first of reopen or wear.
- **Reading the output.** `eligible` and `reached` are counts. `share_pct` is the percentage of eligible accounts or visits that reached the outcome by the exclusive end date. `median_seconds` uses successful accounts or visits only. An empty denominator or median appears as NULL. Visit times use the server’s first observation in the visit and have one-second resolution. Blocked or undelivered activity requests can leave visits or outcomes unobserved. Visit measurement starts at deployment.

Activity records contain the internal account key, server time and a fixed activity type. The browser sends observations to the app’s own authenticated endpoint. The report outputs aggregates and runs through a database connection.
