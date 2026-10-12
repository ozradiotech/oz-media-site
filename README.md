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
| `src/pages/api/` | API routes such as listener/status endpoints. |
| `src/content/` | Decap-managed content collections (`programs`, `announcers`, `activities`, `news`). |
| `public/admin/` | Decap admin config and CMS setup files. |
| `public/uploads/` | Uploaded media assets from Decap CMS. |
| `public/images/` | Static site branding and media assets. |
| `astro.config.mjs` | Astro configuration for the Node server adapter. |

### Routes

| Route | Source | Notes |
| :--- | :--- | :--- |
| `/` | `src/pages/index.astro` | Landing page that selects the Bandung/Bali location. |
| `/oz-bandung/` | `src/pages/oz-bandung.astro` | Main OZ Bandung page with streaming and editorial sections. |
| `/oz-bali/` | `src/pages/oz-bali.astro` | Bali brand preview placeholder page. |
| `/admin` | `src/pages/admin.astro` | Decap CMS admin UI. |
| `/api/listeners` | `src/pages/api/listeners.ts` | Listener-related API route. |
| `/api/now-playing` | `src/pages/api/now-playing.ts` | Now-playing API route. |
| `/uploads/*` | `public/uploads/` | CMS-uploaded image and media files. |

## Astro and Decap CMS

### Astro

- Astro docs: https://docs.astro.build
- Astro deployment guide: https://docs.astro.build/en/guides/deploy/
- Astro content collections: https://docs.astro.build/en/guides/content-collections/
- Node adapter: `@astrojs/node` is configured in `astro.config.mjs` for server output.

### Decap CMS

- Decap CMS docs: https://decapcms.org/docs/intro/
- Git Gateway backend: https://decapcms.org/docs/backend-git-gateway/
- Local backend / dev workflow: https://decapcms.org/docs/working-with-a-local-git-backend/

This project is configured to let editors manage content through `/admin`, with Decap writing to the repository from the local proxy. The current setup is intentionally local-only and is defined in `public/admin/config.yml` with `local_backend: true` and the `git-gateway` backend placeholder.

Before deploying public CMS editing, switch the backend to a hosted Git provider, configure the repository and auth, and remove the local backend flag from `public/admin/config.yml`.

## Brand palette

| Colour | Hex |
| :--- | :--- |
| Yellow | `#f2bd57` |
| Black | `#000000` |
| White | `#FFFFF3` |

## Notes

- Editorial content lives under `src/content/` and is grouped by collections such as `programs`, `announcers`, `activities`, and `news`.
- Images uploaded through Decap are stored in `public/uploads/` and served from `/uploads`.
- The site is built with Astro and uses the Node server adapter for a server-rendered output.
