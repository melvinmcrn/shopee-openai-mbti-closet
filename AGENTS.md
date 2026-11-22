# Repository Guidelines

## Project Structure

- `src/app/` contains Next.js routes and components; shared API and domain logic lives in `src/app/api/_server/`.
- `worker/` adapts requests for the Sites Worker. Database migrations are in `drizzle/` and `supabase/migrations/`; `public/` holds app assets, and `Shopee Database/` contains catalog data and source images.
- Tests live in `tests/` and beside the modules they cover (for example, `src/app/api/_server/wardrobe/*.test.mjs`). Build helpers are in `scripts/`.

## Development and Build Commands

- `npm install` installs dependencies.
- `npm run dev` builds the Sites app, applies local D1 migrations, and starts the Worker. Restart it after source changes.
- `npm run dev:frontend` runs the UI alone with Next.js hot reload. `npm run dev:vercel` runs the Vercel/Supabase target locally.
- `npm run build` builds the Sites export and Worker; `npm run build:vercel` builds the Vercel target.
- `npm run lint` runs ESLint. `node --test` runs the Node test suite; use `node --test tests/planner-generation.test.mjs` for one file. `npm run test:storage` runs the storage isolation test.

## Code Style and Tests

Use two-space indentation, double quotes, and existing TypeScript/ES module patterns. TypeScript is strict; `@/*` maps to `src/*`. ESLint uses Next.js Core Web Vitals and TypeScript configs; no formatter is configured. Keep route and utility filenames lowercase; name tests `*.test.mjs`. Node's built-in runner runs tests; no coverage threshold is configured. Add behavior tests beside a module or under `tests/`.

## Commits and Pull Requests

Recent commits use concise, imperative subjects, such as `Generate planner previews for incomplete outfits`; follow that style. A pull request should describe behavior changes, list relevant checks, link an issue when applicable, and include UI screenshots.

## Configuration

Keep OAuth, OpenAI, database, and storage secrets in ignored local files such as `.dev.vars` or `.env.local`, or in the deployment's server environment. Never commit credentials.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
