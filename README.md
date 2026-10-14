# OZ Media Astro Site

This project is a lightweight Astro site for OZ Media with Decap CMS-powered editorial content. It serves the multi-location brand experience, local content editing, and static uploads for media assets.

## Useful commands

Run these from the project root:

| Command | Action |
| :--- | :--- |
| `npm install` | Install project dependencies. |
| `npm run dev` | Start the Astro dev server at `http://localhost:4321`. |
| `npm run build` | Build the production site into `./dist/`. |
| `npm run preview` | Preview the built site locally. |
| `npm run cms:proxy` | Start the local Decap CMS proxy backend for local editing. |
| `npm run astro` | Run Astro CLI commands. |
| `npm run astro -- --help` | Show Astro CLI help and available commands. |
| `npx astro check` | Run Astro validation and type/content checks. |

## Directory and route map

### Project directories

| Path | Purpose |
| :--- | :--- |
| `src/pages/` | Astro routes and page entry points. |
| `src/pages/index.astro` | Landing/select page for OZ locations. |
| `src/pages/oz-bandung.astro` | Main Bandung media page and broadcast UI. |
| `src/pages/oz-bali.astro` | Bali landing placeholder page. |
| `src/pages/admin.astro` | Decap CMS admin UI entry point. |
| `src/pages/api/` | API routes for listener details, live stream metadata and CMS OAuth. |
| `src/content/` | Decap-managed content collections (`programs`, `announcers`, `activities`, `news`). |
| `public/admin/` | Decap admin config and CMS setup files. |
| `public/uploads/` | Uploaded media assets from Decap CMS. |
| `public/images/` | Static site branding and media assets. |
| `astro.config.mjs` | Astro configuration; picks the Vercel adapter on Vercel and the Node adapter elsewhere. |

### Routes

| Route | Source | Notes |
| :--- | :--- | :--- |
| `/` | `src/pages/index.astro` | Landing page that selects the Bandung/Bali location. |
| `/oz-bandung/` | `src/pages/oz-bandung.astro` | Main OZ Bandung page with streaming and editorial sections. |
| `/oz-bali/` | `src/pages/oz-bali.astro` | Bali brand preview placeholder page. |
| `/admin` | `src/pages/admin.astro` | Decap CMS admin UI. |
| `/api/listeners` | `src/pages/api/listeners.ts` | Saves listener details to `data/listeners.jsonl` (skipped on Vercel). |
| `/api/now-playing` | `src/pages/api/now-playing.ts` | Now-playing API route. |
| `/api/cms-auth` and `/api/cms-callback` | `src/pages/api/cms-auth.ts`, `src/pages/api/cms-callback.ts` | GitHub OAuth flow for Decap CMS. |
| `/uploads/*` | `public/uploads/` | CMS-uploaded image and media files. |

## Astro and Decap CMS

### Astro

- Astro docs: https://docs.astro.build
- Astro deployment guide: https://docs.astro.build/en/guides/deploy/
- Astro Vercel adapter: https://docs.astro.build/en/guides/integrations-guide/vercel/
- Astro content collections: https://docs.astro.build/en/guides/content-collections/
- Node adapter: `@astrojs/node` (standalone) is used for local and self-hosted builds.
- Vercel adapter: `@astrojs/vercel` is used automatically when building on Vercel (`VERCEL` env var).

### Decap CMS

- Decap CMS docs: https://decapcms.org/docs/intro/
- GitHub backend: https://decapcms.org/docs/github-backend/
- Local backend / dev workflow: https://decapcms.org/docs/working-with-a-local-git-backend/

Decap is configured to edit `brannn86/oz-proto` on its `main` branch. For local editing, run `npm run dev` and `npm run cms:proxy`, then open `http://localhost:4321/admin`; Decap uses the local proxy (`local_backend: true`) instead of GitHub. The GitHub OAuth routes keep the client secret on the server, validate the OAuth state, and return the access token only to the same-origin CMS window. Only trusted GitHub users with write access to this repository should be able to use the CMS.

### Deploy a Vercel preview

1. Push the reviewed project contents to GitHub and import the repository into Vercel. Keep the framework preset on Astro and use Node.js 22.x or later (`package.json` requires `>=22.12.0`); the default `npm run build` command is sufficient.
2. Use the stable project domain `https://oz-proto.vercel.app` or replace it in `public/admin/config.yml` with your chosen stable HTTPS Vercel domain. Set the exact same origin as `CMS_OAUTH_BASE_URL` in Vercel (no path or trailing slash). One-off preview URLs will not work for CMS OAuth; use this configured stable domain.
3. Create a GitHub OAuth App for the CMS. Set its **Authorization callback URL** to `<CMS_OAUTH_BASE_URL>/api/cms-callback`. Add these Vercel environment variables for the environments where the CMS will be used:
   - `GITHUB_OAUTH_CLIENT_ID`
   - `GITHUB_OAUTH_CLIENT_SECRET`
   - `CMS_OAUTH_BASE_URL`
4. Configure the GitHub OAuth App homepage URL to the same stable domain. Give the app only to trusted editors. GitHub's `repo` scope is required for Decap to write this private repository; it grants the app access to repositories the authorizing GitHub user can access, so use a dedicated OAuth App and restrict CMS users to people who should have repository access.
5. Deploy a Preview Deployment and test `/`, `/oz-bandung/`, `/oz-bali/`, `/api/now-playing`, and `/admin`. The CMS OAuth callback must be tested on the same stable Vercel domain configured above; a one-off preview URL will not match the registered OAuth callback. Protect preview deployments with Vercel Deployment Protection if their URLs should not be public.

Listener details are saved to `data/listeners.jsonl` on self-hosted (Node) deployments. On Vercel the filesystem is read-only, so `/api/listeners` accepts the details without storing them.

Uploaded media under `public/uploads/` is part of the repository so that current content references resolve in deployments. Review permissions and consent for portraits and other media before publishing.

## Brand palette

| Colour | Hex |
| :--- | :--- |
| Yellow | `#f2bd57` |
| Black | `#000000` |
| White | `#FFFFF3` |

## Notes

- Editorial content lives under `src/content/` and is grouped by collections such as `programs`, `announcers`, `activities`, and `news`.
- Images uploaded through Decap are stored in `public/uploads/` and served from `/uploads`.
- The site is built with Astro for server-rendered output, using the Node adapter when self-hosted and the Vercel adapter on Vercel.
