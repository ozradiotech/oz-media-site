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
| `src/pages/api/` | API routes for live stream metadata and CMS OAuth. |
| `src/content/` | Decap-managed content collections (`programs`, `announcers`, `activities`, `news`). |
| `public/admin/` | Decap admin config and CMS setup files. |
| `public/uploads/` | Uploaded media assets from Decap CMS. |
| `public/images/` | Static site branding and media assets. |
| `astro.config.mjs` | Astro configuration for the Vercel adapter. |

### Routes

| Route | Source | Notes |
| :--- | :--- | :--- |
| `/` | `src/pages/index.astro` | Landing page that selects the Bandung/Bali location. |
| `/oz-bandung/` | `src/pages/oz-bandung.astro` | Main OZ Bandung page with streaming and editorial sections. |
| `/oz-bali/` | `src/pages/oz-bali.astro` | Bali brand preview placeholder page. |
| `/admin` | `src/pages/admin.astro` | Decap CMS admin UI. |
| `/api/now-playing` | `src/pages/api/now-playing.ts` | Now-playing API route. |
| `/api/cms-auth` and `/api/cms-callback` | `src/pages/api/cms-auth.ts`, `src/pages/api/cms-callback.ts` | GitHub OAuth flow for Decap CMS. |
| `/uploads/*` | `public/uploads/` | CMS-uploaded image and media files. |

## Astro and Decap CMS

### Astro

- Astro docs: https://docs.astro.build
- Astro deployment guide: https://docs.astro.build/en/guides/deploy/
- Astro Vercel adapter: https://docs.astro.build/en/guides/integrations-guide/vercel/
- Astro content collections: https://docs.astro.build/en/guides/content-collections/
- `@astrojs/vercel` is configured in `astro.config.mjs` for server output and on-demand API routes.

### Decap CMS

- Decap CMS docs: https://decapcms.org/docs/intro/
- GitHub backend: https://decapcms.org/docs/github-backend/

Decap is configured to edit `brannn86/oz-proto` on its `main` branch. The GitHub OAuth routes keep the client secret on the server, validate the OAuth state, and return the access token only to the same-origin CMS window. Only trusted GitHub users with write access to this repository should be able to use the CMS.

### Deploy a Vercel preview

1. Push the reviewed project contents to GitHub and import the repository into Vercel. Keep the framework preset on Astro and use Node.js 22.x or later (`package.json` requires `>=22.12.0`); the default `npm run build` command is sufficient.
2. Use the stable project domain `https://oz-proto.vercel.app` or replace it in `public/admin/config.yml` with your chosen stable HTTPS Vercel domain. Set the exact same origin as `CMS_OAUTH_BASE_URL` in Vercel (no path or trailing slash). One-off preview URLs will not work for CMS OAuth; use this configured stable domain.
3. Create a GitHub OAuth App for the CMS. Set its **Authorization callback URL** to `<CMS_OAUTH_BASE_URL>/api/cms-callback`. Add these Vercel environment variables for the environments where the CMS will be used:
   - `GITHUB_OAUTH_CLIENT_ID`
   - `GITHUB_OAUTH_CLIENT_SECRET`
   - `CMS_OAUTH_BASE_URL`
4. Configure the GitHub OAuth App homepage URL to the same stable domain. Give the app only to trusted editors. GitHub's `repo` scope is required for Decap to write this private repository; it grants the app access to repositories the authorizing GitHub user can access, so use a dedicated OAuth App and restrict CMS users to people who should have repository access.
5. Deploy a Preview Deployment and test `/`, `/oz-bandung/`, `/oz-bali/`, `/api/now-playing`, and `/admin`. The CMS OAuth callback must be tested on the same stable Vercel domain configured above; a one-off preview URL will not match the registered OAuth callback. Protect preview deployments with Vercel Deployment Protection if their URLs should not be public.

The listener details form remains part of the tune-in flow, but the details are not sent to the server or saved. The values are used only in the current page session.

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
- The site is built with Astro and uses the Vercel adapter for server-rendered output.
