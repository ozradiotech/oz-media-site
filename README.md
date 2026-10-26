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

- **Online CMS** (`https://oz-proto.vercel.app/admin`) commits to `main`. Run `git pull` before you start coding, and update `deploy` to publish the edits to the test site.
- **Local CMS**: run `npm run dev` and `npm run cms:proxy`, open `http://localhost:4321/admin`. Edits are written to your files; commit them like code.

### Don't

- Put hosting-specific config on one branch. `astro.config.mjs` picks the Vercel or Node adapter automatically, so the same code runs everywhere.
- Commit build output (`dist/`, `.vercel/`).
- Merge `deploy` or `test` back into `main`, except to finish a feature from `test`.

### Self-hosting (later)

Point the server at `deploy` (or a version tag such as `v1.0`) and run:

```sh
git pull && npm ci && npm run build && node dist/server/entry.mjs
```

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

### Moderation

Moderation happens in three places: `scripts/chat-admin.mjs` for roles and bans, the ⋯ menu on each chat message, and the Firebase console (**Realtime Database → Data**) for everything else. Run the script from the project root; it reads `.env`.

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

## Brand palette

| Colour | Hex |
| :--- | :--- |
| Yellow | `#f2bd57` |
| Black | `#000000` |
| White | `#FFFFF3` |

## Notes

- Editorial content lives under `src/content/` and is grouped by collections such as `programs`, `announcers`, `activities`, and `news`.
- Images uploaded through Decap are stored in `public/uploads/` and served from `/uploads`.
- Each program (`src/content/programs/*.md`) has an **Airing schedule** (`schedule`: list of `days` + `time`) and **Hosts** (`hosts`: announcer ids, i.e. announcer file names without `.md`, picked from the Announcers collection in the CMS). The description is the markdown body. The program popup shows the full image uncropped, the schedule, the description and the hosts' photos. Programs no longer have a `summary` field.
- The site is built with Astro for server-rendered output, using the Node adapter when self-hosted and the Vercel adapter on Vercel.
