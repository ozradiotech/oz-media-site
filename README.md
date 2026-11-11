# OZ Media Astro Site

This project is a lightweight Astro site for OZ Media. It serves the multi-location brand experience. On the `payload` branch, editorial content (news, programs, announcers, activities, monthly social numbers) comes from a self-hosted [Payload CMS](https://payloadcms.com) in the separate `oz-cms` repo; see [Content (Payload CMS)](#content-payload-cms). Elsewhere it still comes from Decap CMS and the Markdown in `src/content/`.

## Useful commands

Run these from the project root:

| Command | Action |
| :--- | :--- |
| `npm install` | Install project dependencies. |
| `astro dev --background --host 127.0.0.1` | Start the Astro dev server at `http://127.0.0.1:4321` (`astro dev status`, `astro dev logs`, `astro dev stop`). Use `npx astro` if `astro` isn't on the PATH. Without `--host 127.0.0.1` it may listen on IPv6 only, which Chrome can't open. |
| `npm run build` | Build the production site into `./dist/`. |
| `npm run preview` | Preview the built site locally. |
| `npm run cms:proxy` | Start the local Decap CMS proxy backend for local editing. |
| `npm run astro` | Run Astro CLI commands. |
| `npm run astro -- --help` | Show Astro CLI help and available commands. |
| `npx astro check` | Run Astro validation and type/content checks. |

## Content (Payload CMS)

On this branch the site reads its content from Payload at request time through Astro's [live content collections](https://docs.astro.build/en/guides/content-collections/), so a published edit shows up within about 30 seconds, with no rebuild or commit. The CMS itself lives in the `oz-cms` repo (`D:\Work\oz-cms` locally); its README covers setup, roles and deployment.

| Piece | Where | What it does |
| :--- | :--- | :--- |
| Live collections | `src/live.config.ts` | `programs`, `announcers`, `activities`, `news` and `analytics` (the social numbers), each mapped to the shape the old Markdown had, so pages read `entry.data` as before. Rich text arrives as HTML for `render(entry)`. |
| CMS client | `src/lib/cms.ts` | Fetches `/api/...` from the CMS with the website API key, caches each response for 30 seconds, and picks the smallest stored image size that is wide enough (`cmsImage`). |
| Pages | `oz-bandung.astro`, `oz-bandung/news/*`, `sitemap.xml.ts`, `analytics.astro` | Render on demand (`prerender = false`). If the CMS is down, a section comes out empty and the error is logged, rather than the page failing. |

Only published items reach the site. Unpublishing an item in the CMS hides it without deleting it, which replaces Decap's "Show on site" switch. The order of programs, announcers and activities is set by dragging in the CMS list.

### Running it locally

Three things need to run:

1. **Docker Desktop**, for the CMS database (Postgres). The `oz-cms-postgres-1` container starts on its own.
2. **The CMS**: `cd D:\Work\oz-cms` then `npm run dev`. Admin panel at `http://localhost:3000/admin`.
3. **This site**: `astro dev --background --host 127.0.0.1`, then open `http://127.0.0.1:4321/oz-bandung`.

`.env` needs:

| Variable | Value |
| :--- | :--- |
| `CMS_URL` | The CMS address: `http://localhost:3000` locally, `https://cms.ozmedianet.com` once deployed. |
| `CMS_API_KEY` | The API key of the CMS's `website` user. Needed for the social numbers on `/analytics` and the chat roles; published content reads without it. Locally it is in `oz-cms/dev-accounts.local.txt`. |
| `SITE_URL` | This site's own address: `https://ozmedianet.com` on the VPS, `http://127.0.0.1:4321` locally. Canonical links, share URLs, the sitemap and robots.txt use it, so it must match the domain the site is served on. Read at build time (`astro.config.mjs`); ozradio.id when unset. |

### What the CMS drives

| On the site | In the CMS |
| :--- | :--- |
| OZ News articles, with the byline (the article's **Author**, or "OZ Radio Bandung Newsroom" when empty) and a **Source** line under the text | **OZ News** |
| The category kicker on every news card, and the filter on `/oz-bandung/news` (`?category=sports` etc.; only categories with published stories are offered) | The article's **Category**. The list lives in `oz-cms/src/newsCategories.ts` and `src/lib/news.ts`; change both together |
| `/about` (starter text shows until the page is written) | **About page** (editorial) |
| Programs, announcers, activities and their order | **Programs**, **Announcers**, **On-ground activities** |
| `/analytics` social numbers | **Social media numbers** (digital) |
| Chat badges and who can moderate | **Chat roles** (developers only), see Live chat → Moderation |

News pictures are meant to be landscape 16:9 (best 1600 × 900 px, at least 1200 × 675). Anything narrower than 3:2 is shown whole on a blurred copy of itself instead of being cropped (`imageFrame` in `src/lib/news.ts`, styles in `src/styles/media-fit.css`), on the cards and on the article's lead photo.

On OZ Bandung, once a stream is playing and the visitor scrolls past the broadcast section, a mini player appears at the bottom (`data-station-mini` in `oz-bandung.astro`): what's on, a link back to the player, and stop.

### ozmedianet.com (the Payload site on the VPS)

The `payload` branch runs on the same aaPanel VPS as ozradio.id, next to it, from its own clone:

| | ozradio.id | ozmedianet.com |
| :--- | :--- | :--- |
| Branch | `main` | `payload` (on `ozradiotech/oz-media-site`) |
| Folder | `/www/wwwroot/oz-media` | `/www/wwwroot/ozmedianet` |
| Port | 4321 | 4322 |
| Content | Decap (Markdown in Git) | Payload at `https://cms.ozmedianet.com` (`ozradiotech/oz-cms`, Docker, port 3000) |

Both sites share the Firebase project, so the live chat is one room on both. ozradio.id's daily `/api/chat-cleanup` cron covers it.

**First setup** (done once, as root):

```sh
cd /www/wwwroot
git clone --branch payload "$(git -C oz-media remote get-url origin)" ozmedianet
cd ozmedianet && cp ../oz-media/.env .env && chmod 600 .env
# then in .env: PORT=4322, HOST=127.0.0.1, SITE_URL=https://ozmedianet.com, CMS_URL=http://127.0.0.1:3000 and CMS_API_KEY=<key>
npm ci && npm run build
```

- `CMS_API_KEY` belongs to a **Website** user made in the VPS CMS (**Users → Create new**, role Website only, **Enable API Key**).
- `CMS_URL` talks to the CMS container directly; images still load from `https://cms.ozmedianet.com`.
- aaPanel: **Website → Node project** for `/www/wwwroot/ozmedianet`, start command `node --env-file=.env dist/server/entry.mjs`, port 4322, domains `ozmedianet.com` and `www.ozmedianet.com`, Let's Encrypt SSL with Force HTTPS.
- Firebase **Authentication → Settings → Authorized domains** includes `ozmedianet.com`, for Google sign-in. If App Check is enforced, the reCAPTCHA Enterprise key also needs `ozmedianet.com` in its domains.
- DNS (Hostinger): `A @`, `A cms` → the VPS IP; `CNAME www` → `ozmedianet.com`.

**Updating** after pushing to `payload`:

```sh
git push production payload
```

then on the server:

```sh
cd /www/wwwroot/ozmedianet
git pull && npm ci && npm run build
```

and restart the ozmedianet Node project in aaPanel. Content edits need none of this: they are live within about 30 seconds of publishing in the CMS.

## Git workflow

| Branch | Purpose |
| :--- | :--- |
| `main` | Main development branch and source of truth. Decap CMS commits here. |
| `test` | Scratch branch for major features. Gets its own Vercel preview URL. |
| `deploy` | Vercel test deployment (not production). Only ever updated from `main`. |

Changes flow one way only: **test → main → deploy**. Never commit directly on `deploy`.

### Small change (fix, tweak, text)

```sh
git switch main
git pull
# edit, then:
npm run build                 # make sure it builds
git add -A && git commit -m "fix: ..."
git push
```

### Big feature

```sh
git switch test
git reset --hard main         # start clean (only if test has nothing you still need)
# work, commit often, git push to get a Vercel preview
```

When it's done:

```sh
git switch main
git merge test
npm run build
git push
```

### Update the Vercel test site

```sh
git push origin main:deploy
git fetch
```

This is a fast-forward. If it is refused, something was committed on `deploy` that shouldn't have been; make that change on `main` instead.

### Content edits

- **`payload` branch**: content is edited in Payload (`http://localhost:3000/admin` locally) and is not in Git; see [Content (Payload CMS)](#content-payload-cms). The bullets below are for the Decap setup on `main`.
- **Online CMS** (`https://ozradio.id/admin`) commits to `main` on `ozradiotech/oz-media-site` (the `production` remote). Run `git pull production main` before you start coding; run the deploy script on the server to publish the edits (see Self-hosting).
- **Local CMS**: run `npm run dev` and `npm run cms:proxy`, open `http://localhost:4321/admin`. Edits are written to your files; commit them like code.

### Don't

- Put hosting-specific config on one branch. `astro.config.mjs` picks the Vercel or Node adapter automatically, so the same code runs everywhere.
- Commit build output (`dist/`, `.vercel/`).
- Merge `deploy` or `test` back into `main`, except to finish a feature from `test`.

### Self-hosting (ozradio.id)

The live site runs on an aaPanel VPS as a Node project in `/www/wwwroot/oz-media`, started with
`node --env-file=.env dist/server/entry.mjs` on `127.0.0.1:4321` behind Nginx. The server's clone tracks
`ozradiotech/oz-media-site` (its `origin`; `production` in local clones) and builds `main`, so publish by pushing there:

```sh
git push production main
```

Then, on the server as root:

```sh
bash /www/wwwroot/oz-media/scripts/deploy.sh
```

and restart the Node project in aaPanel. The script resets the server copy to `origin/main` (discarding the files
the build's image step rewrites), runs `npm ci` when the lockfile changed, and rebuilds. `.env`, `data/` and `dist/`
are git-ignored and kept. Vercel Cron does not run here; an aaPanel cron calls `/api/chat-cleanup` daily with
`Authorization: Bearer $CRON_SECRET`.

## Directory and route map

### Project directories

| Path | Purpose |
| :--- | :--- |
| `src/pages/` | Astro routes and page entry points. |
| `src/pages/index.astro` | Landing/select page for OZ locations. |
| `src/pages/oz-bandung.astro` | Main Bandung media page and broadcast UI. |
| `src/pages/oz-bali.astro` | Bali landing placeholder page. |
| `src/pages/admin.astro` | Decap CMS admin UI entry point. |
| `src/pages/api/` | API routes for listener details, live stream metadata, live chat and CMS OAuth. |
| `src/lib/` | Server-only code for the live chat (Firebase Admin, word filter). |
| `scripts/chat-admin.mjs` | Grants the chat moderator role and lifts bans. |
| `src/live.config.ts` | Live collections read from Payload (`payload` branch). |
| `src/lib/cms.ts` | Payload REST client, response cache and image size picker (`payload` branch). |
| `src/content/` | Decap-managed Markdown. On the `payload` branch it is no longer read (it was imported into Payload) and is kept only until the switch is final. |
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
| `/admin` | `src/pages/admin.astro` | Decap CMS admin UI. On the `payload` branch, edit in the Payload admin instead. |
| `/api/listeners` | `src/pages/api/listeners.ts` | Saves listener details to `data/listeners.jsonl` (skipped on Vercel). |
| `/api/now-playing` | `src/pages/api/now-playing.ts` | Now-playing API route. |
| `/api/chat` | `src/pages/api/chat.ts` | Sends and reports live chat messages (signed-in users). |
| `/api/chat-mod` | `src/pages/api/chat-mod.ts` | Moderator actions: delete, mute, ban, slow mode. |
| `/api/chat-cleanup` | `src/pages/api/chat-cleanup.ts` | Daily cron: removes chat messages older than 24 hours. |
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

On the `payload` branch Decap no longer feeds the site. This section applies to `main` until the switch to Payload is merged.

- Decap CMS docs: https://decapcms.org/docs/intro/
- GitHub backend: https://decapcms.org/docs/github-backend/
- Local backend / dev workflow: https://decapcms.org/docs/working-with-a-local-git-backend/

Decap is configured to edit `ozradiotech/oz-media-site` on its `main` branch. For local editing, run `npm run dev` and `npm run cms:proxy`, then open `http://localhost:4321/admin`; Decap uses the local proxy (`local_backend: true`) instead of GitHub. The GitHub OAuth routes keep the client secret on the server, validate the OAuth state, and return the access token only to the same-origin CMS window. Only trusted GitHub users with write access to this repository should be able to use the CMS.

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

## Live chat

The chat on `/oz-bandung/` uses the Firebase Realtime Database. Anyone can read it; sending needs Google sign-in. Browsers only read the database: every write goes through `/api/chat` or `/api/chat-mod`, which verify the user, rate-limit them, filter words and block links before writing. Security rules are in `database.rules.json`.

### Setup

1. Firebase console → **Build → Realtime Database** → create a database. Copy its URL.
2. **Rules** tab: paste `database.rules.json` and publish (or run `firebase deploy --only database`).
3. **Project settings → Service accounts → Generate new private key**.
4. Optional but recommended: in the Google Cloud console (same project), enable the **reCAPTCHA Enterprise API** and create a **website** key for your domains, plus `localhost` for local testing. Then in Firebase **App Check → Apps**, register the web app with **reCAPTCHA Enterprise** using that site key. Once chat works, turn on App Check **enforcement** for the Realtime Database.
5. Add the variables to `.env` and to Vercel (Settings → Environment Variables):

| Variable | Value |
| :--- | :--- |
| `PUBLIC_FIREBASE_DATABASE_URL` | The database URL from step 1. |
| `FIREBASE_SERVICE_ACCOUNT` | The whole key file from step 3 as one line of JSON. In `.env`, wrap it in single quotes. |
| `PUBLIC_FIREBASE_APPCHECK_SITE_KEY` | Optional. The reCAPTCHA Enterprise site key from step 4. When set, the chat API requires App Check. |
| `CRON_SECRET` | Any long random string. Vercel Cron sends it to `/api/chat-cleanup`. |
| `ANALYTICS_SALT` | Optional. Any long random string, the key for the hashed chatter ids in the chat analytics (see Analytics → Live chat). |
| `GA_PROPERTY_ID` | Optional. The GA4 property number for the Website panel on `/analytics` (see Analytics → Website panel). |

### Moderation

Moderation happens in three places: `scripts/chat-admin.mjs` for roles and bans, the ⋯ menu on each chat message, and the Firebase console (**Realtime Database → Data**) for everything else. Run the script from the project root; it reads `.env`.

**On the `payload` branch (ozmedianet.com)**, chat roles are set in the CMS under **Admin → Chat roles**, which only developers can see: the person's Google account email and a role, **Dev**, **Operator**, **Host** or **Mod**. Every role can moderate; the role is the badge on their messages (DEV solid, OPERATOR outlined, HOST accent, MOD soft accent). Changes apply within a minute; the person signs out of the chat and back in. Accounts given `mod` with the script below still moderate, as Mod. ozradio.id shares the chat room and still shows every moderator as MOD.

#### Moderators

```sh
node --env-file=.env scripts/chat-admin.mjs mod someone@gmail.com     # make a moderator
node --env-file=.env scripts/chat-admin.mjs unmod someone@gmail.com   # remove the role
```

- The person must have signed in on the site once, and must sign out and back in after the change.
- Moderators get a ⋯ menu on every message with **Delete message**, **Mute for 10 minutes** and **Ban from chat**, plus a **Slow mode** menu (off, 5, 10, 30 or 60 seconds) in the chat header.
- Their messages show a MOD badge. They skip slow mode, may post links, and can't be muted or banned.
- Signed-in listeners get **Report message** in the ⋯ menu. Signed-out visitors can only read.

#### Bans and mutes

```sh
node --env-file=.env scripts/chat-admin.mjs unban someone@gmail.com   # lifts a ban and any mute
```

- **Ban** (by a moderator): blocks the user from sending and reporting, and removes their messages still in the chat. Banned users are listed at `chat/private/bans`.
- **Mute**: a moderator's mute lasts 10 minutes. Three strikes within a minute (posting too fast, repeating a message, links, severe words) mute a user automatically for 5 minutes. Mutes expire on their own.
- By hand in the Firebase console: delete `chat/private/bans/<uid>` to unban, or `chat/private/users/<uid>/mutedUntil` to unmute.

#### Filtered, reported and deleted messages

| What happened | What is kept | Where (Firebase console) |
| :--- | :--- | :--- |
| Mild swear word | Posted with the word masked (`a*****`); the original isn't kept | `chat/rooms/<room>/messages` |
| Severe word, link or spam | Rejected; nothing is saved | — |
| Reported by 3 listeners | Hidden from the chat; a full copy with the report count | `chat/private/flagged/<room>/<message id>` |
| Deleted, muted or banned by a moderator | Who did what to whom, with the message text | `chat/private/modlog` |

There is no review page on the site yet. In the Firebase console you can:

- **Edit a live message**: change `chat/rooms/<room>/messages/<id>/t`. Everyone sees the change straight away.
- **Restore a hidden message**: copy its entry from `chat/private/flagged/<room>` back under `chat/rooms/<room>/messages`, then delete the flagged copy.
- **Clear old records**: flagged messages and the mod log are not cleaned up automatically. Delete entries once reviewed.

Live messages are deleted after 24 hours by the daily `/api/chat-cleanup` job.

#### Word lists

The built-in lists are in `src/lib/chat-filter.ts`: **mild** words are masked, **severe** words reject the message and give a strike. Matching ignores letter case, leetspeak (`4nj1ng`), stretched letters (`anjiiing`), spaced-out spelling (`k o n t o l`) and common Indonesian affixes (`siAnjing`, `goblokmu`).

To add words without a redeploy, create `chat/private/blocklist` in the database with two text fields:

```json
{ "mild": "word1, word2", "severe": "word3, word4" }
```

The server picks up changes within a minute. Removing a built-in word needs a code change in `chat-filter.ts`.

The `jwks-rsa` override in `package.json` keeps `firebase-admin` on `jose` 5. `jose` 6 can't be loaded with `require()` on Vercel's runtime, which crashes every chat route. Remove the override only once `jwks-rsa` stops using `require('jose')`.

## Analytics

`/analytics` (not linked anywhere) shows live listeners, listener forms and monthly social numbers. Every section exports to CSV. On the `payload` branch the monthly social numbers are entered in the CMS by the Digital role (**Social media numbers**) and read with `CMS_API_KEY`.

### Listener forms

Listener details are personal data, so that panel needs Google sign-in with the analytics role:

```sh
node --env-file=.env scripts/chat-admin.mjs analytics someone@gmail.com     # grant access
node --env-file=.env scripts/chat-admin.mjs unanalytics someone@gmail.com   # remove it
```

The person must have signed in on `/analytics` once; a reload picks up the new role. Google sign-in only works on domains listed in the Firebase console under **Authentication → Settings → Authorized domains** (`localhost` and `ozradio.id`).

### Google Analytics 4

`src/components/GoogleAnalytics.astro` adds the GA4 tag to the public pages (not `/analytics` or the CMS). It is only included in production builds, and only when `.env` has:

| Variable | Value |
| --- | --- |
| `PUBLIC_GA_MEASUREMENT_ID` | The web stream's Measurement ID, `G-XXXXXXXXXX` (GA4 → **Admin → Data streams**). |

The ID is baked in at build time, so on the server add it to `.env` and run `scripts/deploy.sh`.

Google's script only loads after a visitor clicks **Accept** in the cookie banner (`ConsentBanner.astro`); until then, or after **Decline**, nothing is sent and no `_ga` cookies are set. The choice is kept in the browser (`oz-analytics-consent`), and **Cookie settings** in the footers brings the banner back. The banner and notice also show on the dev server so they can be tried out, but GA never loads there.

#### Website panel (GA4 reports on /analytics)

The **Website** panel on `/analytics` shows GA4's numbers for the chosen dates: overview, traffic channels and sources, most visited and landing pages, new vs returning visitors, devices, browsers, operating systems, cities, UTM campaigns and events. Each table exports to CSV. `src/lib/ga4.ts` reads them through the GA4 Data API, signed in as the Firebase service account with read-only Analytics access; results are cached for 10 minutes.

Setup, once:

1. `GA_PROPERTY_ID` in `.env`: the number in GA4 → **Admin → Property details** (not the `G-` Measurement ID).
2. In the Google Cloud console for project `oz-media-site`, enable **Google Analytics Data API**.
3. In GA4 → **Admin → Property access management**, add the service account's email (`client_email` in `FIREBASE_SERVICE_ACCOUNT`) as a **Viewer**.

Until then the panel says which step is missing. GA4 has no exit-page report outside its own Explorations, so exits aren't shown.

#### Events

Besides page views, the site sends these GA4 events through `track()` in `src/scripts/oz-track.ts` (only with consent; on the dev server they are logged to the browser console instead). Parameters never carry names, emails or locations.

| Event | When | Parameters |
| --- | --- | --- |
| `play_click` | A stream is picked in the tune-in dialog, or the player's play button is pressed | `stream_type` (`audio`/`video`), `source` (`tune_in`, `station_page`, `mini_player`) |
| `stream_start` | Audio actually starts playing (once per run of playback), or the livestream is opened | `stream_type`, `source` |
| `stream_stop` | The mini player's stop button | `stream_type`, `source` |
| `listener_form_view` / `listener_form_submit` | The listener form opens / is sent | `stream_type`, `signed_in` (submit only) |
| `chat_sign_in` | Chat sign-in pressed, and how it ended | `status` (`attempt`, `cancelled`, `failed`), `error_code` |
| `login` | Chat sign-in succeeded (GA4's own event) | `method` (`Google`) |
| `chat_sign_out` | Sign out in the chat | |
| `chat_message_send` | A chat message is sent | `status` (`sent`, `failed`) |
| `share` | An article is shared (GA4's own event) | `method` (`whatsapp`, `x`, `facebook`, `copy_link`), `content_type`, `item_id` (the article path) |

To break reports down by a parameter, register it once in GA4 under **Admin → Custom definitions → Create custom dimension** (event scope): `stream_type`, `source`, `status`, `error_code`, `signed_in`.

#### Campaign links

The **Campaign links** panel on `/analytics` builds links with `utm_source`, `utm_medium`, `utm_campaign` and `utm_content` for posts on Instagram, TikTok and elsewhere, all lowercase so GA counts each campaign once. Visits from them show in GA4 under **Reports → Acquisition → Traffic acquisition** (session campaign). Copied links are listed in that browser and can be exported to CSV.

### Radio listening

Our own listening stats, kept on our server and separate from GA4. `src/scripts/oz-radio-tracker.ts` reports what the station player does to `/api/track`, which checks every event and appends it to `data/events/YYYY-MM.jsonl` (git-ignored, like `data/listeners.jsonl`). The **Radio listening** panel on `/analytics` (analytics role) summarises them for the chosen dates, and exports sessions, daily totals or raw events as CSV.

- A **listening session** runs from the moment sound starts until it stops: a pause, the mini player's stop button, changing stream, an error the player couldn't recover from, the listener form taking over, or the page closing. While sound plays the browser checks in every minute, so a session from a closed tab still has its length (to within a minute).
- Recorded: play presses, starts (and the wait between pressing play and hearing sound), listening time, buffering and reconnects, errors, what ended the session, and device type, OS and browser read from the User-Agent. Not recorded: names, IP addresses, the User-Agent itself, cookies.
- **Returning listeners** need a lasting random ID (`oz-listener-id` in local storage), which is only kept and sent for visitors who accepted the cookie banner; declining deletes it. Everyone else is counted anonymously.
- The livestream is a YouTube embed, which doesn't report playback, so a livestream session runs from opening it until it's closed.
- Event types and allowed values live in `src/lib/radio-events.ts`; the summaries in `src/lib/radio-stats.ts`.

### Live chat

Chat analytics go into the same event store as the radio listening (`data/events/`) and show in the **Live chat** panel on `/analytics`, with daily and raw-event CSV exports.

- **From the server** (`src/lib/chat-analytics.ts`, called by `/api/chat` and `/api/chat-mod`): every message posted, every message refused and why (not signed in, banned, muted, too fast, link, blocked words, repeat…), reports, and moderation (deletes, mutes, bans, slow mode, automatic mutes and hides).
- **From browsers** (`src/lib/chat-events.ts`, through `/api/track`): chat views (signed in or not), sign-in attempts and how they ended (including first-time accounts), messages that never reached the server, connections and disconnections (idle, network, leaving the page), and the time from the chat showing to the first message.
- **People and views are kept apart.** A *chatter* is an account that posted, stored only as a keyed hash of its account id (`cid`). A *view* is one page load that showed the chat; one person can make many. Messages per visit use the page load's id, which the chat sends with each message.
- The hash key is `ANALYTICS_SALT` in `.env` (optional; the service-account key is used when it's unset). Changing it makes every chatter look new.
- Chat messages themselves are deleted after a day, so these statistics start from when this went live.

### Site performance

`src/components/SiteMonitor.astro` (on the public pages) loads `src/scripts/oz-site-monitor.ts`, which measures the Core Web Vitals with Google's `web-vitals` library (LCP, INP, CLS, plus FCP and TTFB) and the full page load time, and reports JavaScript errors. They are sent through `/api/track` into `data/events/` and shown in the **Site performance** panel on `/analytics`, with measurement and error CSV exports.

- Pages are reported by kind (`Home`, `OZ Bandung`, `News article`…; see `pageGroup` in `src/lib/site-events.ts`), never by address. Add new pages there.
- Figures are 75th percentiles, rated with Google's thresholds, as in Search Console and PageSpeed Insights. "Good page experience" is the share of page views with good LCP and CLS, and good INP when there was an interaction.
- Vitals are sent when the page is hidden or closed, since CLS and INP are only final then. Moving between OZ Bandung and OZ News without a reload is one page view, of the page the visitor arrived on.
- Error messages are cut to 150 characters, with addresses replaced by `[url]`; at most five different errors are sent per page load.

### Privacy policy

`src/pages/privacy-policy.astro` describes what the site collects. Update it, and its `updated` date, whenever that changes: a new form field, a new tracker, a new embed.

## Brand palette

| Colour | Hex |
| :--- | :--- |
| Yellow | `#f2bd57` |
| Black | `#000000` |
| White | `#FFFFF3` |

## Notes

- On the `payload` branch, content lives in Payload; the notes below describe the Decap setup on `main`.
- Editorial content lives under `src/content/` and is grouped by collections such as `programs`, `announcers`, `activities`, and `news`.
- Images uploaded through Decap are stored in `public/uploads/` and served from `/uploads`.
- Each program (`src/content/programs/*.md`) has an **Airing schedule** (`schedule`: list of `days` + `time`) and **Hosts** (`hosts`: announcer ids, i.e. announcer file names without `.md`, picked from the Announcers collection in the CMS). The description is the markdown body. The program popup shows the full image uncropped, the schedule, the description and the hosts' photos. Programs no longer have a `summary` field.
- The site is built with Astro for server-rendered output, using the Node adapter when self-hosted and the Vercel adapter on Vercel.
