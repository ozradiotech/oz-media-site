# YouTube unified chat and livestream viewer counts (experimental)

Branch: `feature/youtube-unified-chat` in this repo and in `oz-cms`. Not merged, not deployed.

While OZ Radio Bandung is live on YouTube, the website live chat and the YouTube live chat become one conversation, and the page shows how many people are watching. When YouTube isn't live, the website chat works exactly as before.

- **Website → YouTube.** Website messages are posted to YouTube **by the authorized OZ Radio YouTube channel**, as `[Website] Bran: Hello everyone!`. They are not posted as, or attributed to, the website user's own YouTube account; no visitor ever connects YouTube. Only the display name and the text are sent: no account id, email or token.
- **YouTube → website.** YouTube messages appear in the website chat under their YouTube author's name and picture, with a small **YT** tag.
- **Viewer counts.** Two separate measures, always labelled apart (see [Viewer counts](#viewer-counts)).

## Architecture

```
               ┌────────────────────── Astro site (Node, one process on the VPS) ──────────────────────┐
 browser ──►   │ /api/chat ──► Firebase RTDB  chat/rooms/bandung/messages   (unchanged checks first)   │
 (chat)        │      └─► queue: chat/private/youtube/outbox + queue                                    │
               │                                                                                         │
               │ YouTube sync worker (src/lib/youtube/sync.ts), started by src/middleware.ts             │
               │   lease ── chat/private/youtube/lease   (one worker at a time, across processes/hosts)  │
               │   broadcast check ── liveBroadcasts.list / videos.list ─► state machine                  │
               │   reader ── liveChatMessages.streamList (fallback: list) ─► messages (s:'yt')           │
               │   outbox ── liveChatMessages.insert (as the OZ channel) ─► ys: sent | failed            │
               │   viewers ── counts chat/private/youtube/viewers ─► chat/rooms/bandung/meta/youtube      │
               │   snapshots ── every 5 min while live ─► CMS (Postgres) livestream-* collections        │
 browser ──►   │ /api/viewers  heartbeats while the embedded player plays                                │
 (player)      │ /api/youtube/connect, /callback, /admin   OAuth and admin (CMS Developer / Digital)    │
               │ /api/analytics/livestream                 history for /analytics                        │
               └─────────────────────────────────────────────────────────────────────────────────────────┘
```

| Piece | Where |
| :--- | :--- |
| YouTube API client, OAuth, error kinds, streamed-JSON parser | `src/lib/youtube/api.ts`, `stream-parser.ts` |
| Token storage and refresh | `src/lib/youtube/credentials.ts`, `crypto.ts` |
| Broadcast detection and states | `src/lib/youtube/broadcast.ts` |
| Website → YouTube queue | `src/lib/youtube/outbox.ts` |
| YouTube → website | `src/lib/youtube/reader.ts`, `normalize.ts`, `push-id.ts` |
| Website viewers | `src/lib/youtube/viewers.ts`, `src/pages/api/viewers.ts`, `src/scripts/oz-live-viewers.ts` |
| History snapshots | `src/lib/youtube/snapshots.ts`; oz-cms `src/collections/Livestream.ts` |
| The worker | `src/lib/youtube/sync.ts`; wiring to Astro, Firebase and the CMS in `runtime.ts` |
| Who may do what | `src/lib/youtube/roles.ts`, `access.ts`; oz-cms `GET /api/users/staff-roles` |

Everything in `src/lib/youtube/` except `runtime.ts` and `access.ts` is plain TypeScript with no Astro imports, so it runs under `node --test`.

### Why this shape

- **No new services.** The site already runs as one long-lived Node process on the VPS, so the worker lives in it. The queue, the lease and the viewer registry are in the Realtime Database the chat already uses; history goes to the CMS's Postgres through its REST API, as the site already reads it.
- **Only one worker.** Local development uses the same Firebase project as production, so two processes could otherwise both talk to YouTube. The lease (`chat/private/youtube/lease`, compare-and-set with the database's ETags, 45 s, renewed every 15 s) means only one does; the others stand by and take over if it stops.
- **The chat never waits on YouTube.** `/api/chat` saves the message first, then queues it; the worker posts it later. Any YouTube or worker failure leaves the website chat working.

## Data model

Messages keep their existing shape (`u, n, p, t, ts, m, r`); three optional fields are new. Older messages and other clients are unaffected.

| Field | Meaning | Brief's name |
| :--- | :--- | :--- |
| key | Firebase push id (website) or a push-id-shaped key built from the YouTube publish time + YouTube id (YouTube) | `id` |
| `s` | absent = website, `'yt'` = YouTube | `source` |
| `u` | Firebase uid (website) or `yt-<channelId>` (YouTube) | `sender.id` |
| `n`, `p` | display name, avatar URL | `sender.name`, `sender.avatar` |
| `t`, `ts` | text, time (ms) | `message`, `timestamp` |
| `c` | YouTube author channel id (YouTube messages) | |
| `ys` | `pending` / `sent` / `failed` (website messages sent while live) | `youtubeStatus` |

The YouTube message id, broadcast id, attempts and errors of a forwarded message are kept privately in `chat/private/youtube/outbox/<messageId>`, not on the public message.

| Path | What | Who can read |
| :--- | :--- | :--- |
| `chat/rooms/bandung/meta/youtube` | `{ state, sync, videoId, youtubeViewers, websiteViewers, … }` | everyone (existing `meta` rule) |
| `chat/private/youtube/auth` | channel id/title, **encrypted** refresh token, status | server only |
| `chat/private/youtube/settings` | `{ toYoutube, fromYoutube }` | server only |
| `chat/private/youtube/state` | the worker's state (broadcast, liveChatId, reader position, quota, counters, last error) | server only |
| `chat/private/youtube/outbox`, `queue`, `sent`, `imported` | the queue and duplicate prevention | server only |
| `chat/private/youtube/viewers` | `{ <random session>: expiresAt }` | server only |
| `chat/private/youtube/oauthStates` | single-use OAuth states | server only |

`database.rules.json` needed no change: `chat/private` is already closed to browsers and `meta` is already public.

## YouTube OAuth

The channel is connected once by a CMS **Developer** in the CMS: **Broadcast → YouTube → Connect YouTube channel** (or on this site's `/analytics` → Livestream, signed in with Google). This is separate from Firebase Google sign-in, which visitors still use to chat.

From the CMS, the button goes to the CMS's `/api/site-admin/youtube-connect`, which signs a 5-minute token for the user (`CMS_SITE_SECRET`) and sends the browser to this site's `GET /api/youtube/connect?token=…`. From there the flow below is the same, and the callback returns the browser to the CMS page.

1. `POST /api/youtube/connect` (Firebase ID token; CMS Developer). The server makes a random `state`, stores it single-use for 10 minutes at `chat/private/youtube/oauthStates/<hash>`, sets it in an httpOnly `SameSite=Lax` cookie scoped to `/api/youtube`, and returns Google's consent URL (authorization code flow, `access_type=offline`, `prompt=consent`).
2. Google sends the browser to `/api/youtube/callback?code&state`. The server requires the `state` to match **both** the cookie and an unexpired stored record (CSRF protection), deletes the record, exchanges the code, checks that the scope was granted, reads the channel (`channels.list mine=true`), checks it against `YOUTUBE_CHANNEL_ID` if set, encrypts the refresh token (AES-256-GCM, `YOUTUBE_TOKEN_ENCRYPTION_KEY`) and stores it. Any earlier grant is revoked.
3. The worker gets access tokens from the refresh token and reuses each until a minute before it expires. A 401 from YouTube refreshes the token and retries once. `invalid_grant` (revoked in the Google account, or expired) marks the connection **revoked** and the panel asks for a reconnect.
4. **Disconnect** deletes the stored token and revokes it at Google.

The client secret and tokens never reach a browser, are never in an API response, and are not logged.

**Scope:** `https://www.googleapis.com/auth/youtube.force-ssl`. It is the narrowest scope that can *post* live chat messages (`liveChatMessages.insert` accepts only `youtube` or `youtube.force-ssl`); it also covers reading the chat and the channel's broadcasts. `youtube.readonly` cannot post.

### Google Cloud setup

1. In the Google Cloud console, pick or create a project (it can be the Firebase project).
2. **APIs & Services → Library → YouTube Data API v3 → Enable.**
3. **Consent screen** (now called **Google Auth Platform**: **APIs & Services → OAuth consent screen**, or https://console.cloud.google.com/auth/overview):
   - **Overview → Get started:** app name "OZ Radio", support email, audience **External**, contact email.
   - **Branding:** add the authorized domain `ozmedianet.com`.
   - **Data Access → Add or remove scopes:** filter for "youtube", tick `.../auth/youtube.force-ssl`, save. (It is only listed once step 2 is done.)
   - **Audience:** while the app is in Testing, add the Google account that owns or manages the OZ channel as a test user. Testing-mode refresh tokens expire after 7 days, so **Publish app** (Production) before relying on it. Google may ask for verification for this sensitive scope; until then the connecting admin clicks through an "unverified app" warning.
4. **Google Auth Platform → Clients → Create client → Web application** (the same as **APIs & Services → Credentials → Create credentials → OAuth client ID**). Authorized redirect URIs:
   - `https://ozmedianet.com/api/youtube/callback`
   - `http://127.0.0.1:4321/api/youtube/callback` (local development, optional)
5. Put the client id and secret in `.env` (below). Connect with the Google account that is the OZ channel's owner or manager; if that account has several channels, pick the OZ channel on Google's screen.
6. **Quota:** the default is 10,000 units/day. If the chat is busy, request more under **APIs & Services → YouTube Data API v3 → Quotas** (see [Quota](#quota)).

## Environment variables

All optional; the feature is off unless `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` and `YOUTUBE_TOKEN_ENCRYPTION_KEY` are set (and the chat's `FIREBASE_SERVICE_ACCOUNT`). See `.env.example`.

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `YOUTUBE_SYNC` | `on` | `off` disables everything without removing the other settings |
| `CMS_SITE_SECRET` | | shared with the CMS, so its website pages (Broadcast → YouTube, Live chat → YouTube chat sync and Moderation, Digital → Analytics) can use this site's admin routes |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | | the OAuth client |
| `YOUTUBE_REDIRECT_URI` | `SITE_URL` + `/api/youtube/callback` | must match the client exactly |
| `YOUTUBE_TOKEN_ENCRYPTION_KEY` | | 32 bytes, hex or base64 (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Changing it means connecting again |
| `YOUTUBE_CHANNEL_ID` | | if set, only this channel can be connected |
| `YOUTUBE_BROADCAST_CHECK_INTERVAL` | 120 s | how often to look for a broadcast while offline |
| `YOUTUBE_VIEWER_COUNT_REFRESH_INTERVAL` | 60 s | how often to check the live broadcast (viewer count and end) |
| `YOUTUBE_CHAT_POLL_MIN_INTERVAL` | 10 s | polling fallback: never more often than this |
| `YOUTUBE_DAILY_QUOTA` | 10000 | the project's daily quota, for the sync's own budget |
| `YOUTUBE_OUTBOUND_PER_MINUTE` | 20 | most website messages posted to YouTube per minute, site-wide |
| `WEBSITE_VIEWER_HEARTBEAT_INTERVAL` | 20 s | how often a playing player reports |
| `WEBSITE_VIEWER_SESSION_TTL` | 60 s | a session that stops reporting drops out after this |
| `LIVESTREAM_SNAPSHOT_INTERVAL` | 300 s | how often a history snapshot is stored while live |

The CMS needs no new variables; run its migration (below).

## Live detection

The worker only talks to YouTube once a channel is connected. Then:

| State | Means | Check | Sync |
| :--- | :--- | :--- | :--- |
| `OFFLINE` | nothing live | `liveBroadcasts.list broadcastStatus=active` every 120 s (1 unit); every third check also `upcoming` | off |
| `UPCOMING` | a broadcast is scheduled (created/ready/testing) | every 60 s | off |
| `LIVE` | a public broadcast is `live`/`liveStarting` | only `videos.list liveStreamingDetails` every 60 s (1 unit): viewer count, `activeLiveChatId`, end time | on (if its chat is on) |
| `ENDING` | it just ended: reader stopped, unsent messages marked failed, history record closed | | off |
| `ENDED` | done; the next check returns to `OFFLINE`/`UPCOMING`/`LIVE` | | off |
| `ERROR` | YouTube couldn't be asked; retried with backoff (15 s doubling, up to the offline interval) | | off |

The broadcast's own `activeLiveChatId` is used. A broadcast in YouTube's private `testing` preview isn't treated as live. Two failed checks in a row while live don't stop the sync; the third does. A permanent livestream is not needed: each new broadcast is found and followed on its own.

The page's player finds the video to play through `/api/youtube-live`. It uses the channel set in the CMS (**Broadcast → Streams → Video stream**: the **Livestream channel ID**, or a **Pinned livestream video ID** that always plays that one video; with the channel cleared it follows the connected channel). When that channel is the connected one, the integration's own state answers first (official API, unlisted streams included). Otherwise it reads YouTube's page, which only sees public streams, and the player checks again every 30 seconds while "not live" shows.

## Message sync

### Website → YouTube

1. `/api/chat` runs every existing check unchanged: Firebase ID token (and App Check), ban, mute, slow mode, 3-second minimum, length, emoji, links, blocked words, duplicates, strikes.
2. It saves the message as before. If the stream is live, forwarding is on and the quota isn't spent, the message carries `ys: 'pending'` and is queued under its own message id (one multi-path write).
3. The worker posts it as the OZ channel: `[Website] <name>: <text>`, cut to YouTube's 200 characters.
4. On success the YouTube message id is stored privately and the message gets `ys: 'sent'`.

Failures: temporary errors and rate limits retry with exponential backoff (2 s, 4 s, … up to 60 s), at most 5 attempts. A message is dropped as stale after 2 minutes rather than posted late. `quotaExceeded` fails the queue and pauses sending until midnight Pacific. A revoked token fails the queue and asks for a reconnect. An ended chat fails the queue and rechecks the broadcast. A message a moderator deletes (or whose author is banned) before it is sent is never sent. Failed messages stay in the website chat; only their sender sees a small "not sent to YouTube" note. There is no infinite retry.

### YouTube → website

The reader uses `liveChatMessages.streamList` (the REST stream at `youtube.googleapis.com/youtube/v3/liveChat/messages/stream`, one connection held open, 5 units per connection). If the stream is refused it falls back to `liveChatMessages.list`, waiting at least YouTube's `pollingIntervalMillis` and never less than `YOUTUBE_CHAT_POLL_MIN_INTERVAL`. Its place (`nextPageToken`) is saved, so a restart carries on instead of re-reading. On first connecting to a broadcast, history older than 2 minutes is skipped.

For each `textMessageEvent`, the author's display name, picture and channel id are kept. The website's rules apply: severe words drop the message, mild ones are masked, links are dropped unless the author is the channel owner or a YouTube moderator, and authors banned or muted on the website are skipped. Super Chats, polls and other event types are not copied.

### Duplicate prevention

- **Our own echo:** a website message posted to YouTube comes back in the YouTube chat. The reader skips any message whose YouTube id the site stored when posting it (kept in memory and at `chat/private/youtube/sent/<hash>`, so this holds across restarts). It also skips any message from the OZ channel that starts with `[Website] `, which catches a post whose answer was lost.
- **Lost answers:** if posting times out, the message may have gone through. It is not posted again at once; for 20 seconds the reader looks for it, and if it appears the entry is marked sent with that YouTube id. Only if it doesn't appear is it retried.
- **Re-reads:** a YouTube message always gets the same key (publish time + hash of its YouTube id), so writing it twice changes nothing. A marker at `chat/private/youtube/imported/<key>` means one a moderator deleted is never brought back.
- **Retries:** the queue is keyed by the website message id and an entry that isn't `pending` is skipped, so a retry or a duplicated queue entry cannot post twice.
- Messages the channel owner types on YouTube itself (no prefix) are copied in like anyone else's.

### Moderation

Website moderators' tools work on YouTube messages in the website chat: delete removes it here (not on YouTube); timeout and ban are stored against `yt-<channelId>`, and the reader then skips that author's messages. Moderation on YouTube itself stays with YouTube's tools.

## Viewer counts

These are **different metrics** and are shown side by side, never merged silently.

- **YouTube concurrent viewers.** YouTube's official count from `videos.list` → `liveStreamingDetails.concurrentViewers`, fetched once a minute by the worker (not by visitors) and shared through `meta/youtube`. It measures YouTube's own broadcast audience, not people looking at the chat. When YouTube leaves it out (the channel hides it, or it isn't known yet), it shows as "—" and is stored as empty, never as 0.
- **Website active viewers.** Our estimate of people whose **embedded player is actually playing** on this site. The page uses the YouTube IFrame Player API (`enablejsapi=1`). Only the `PLAYING` state starts heartbeats to `/api/viewers` (every 20 s), and pause, end or leaving the page stops them. Loading the page or the iframe doesn't count, and sessions that stop reporting expire after 60 s. Sessions are random ids made fresh per playback, with no account, cookie or stored identity. Only one tab per browser reports (Web Locks API), so several tabs count once, and repeated beats from a session count once. A hashed address caps sessions at 3 per machine within the process. Heartbeats only count while YouTube is live.
- **Combined audience (estimate)** = the sum, shown only when both are known and always labelled as an estimate that is not a YouTube figure. A person watching on the site may also be counted by YouTube, and YouTube decides for itself which embedded plays it counts. We never assume the iframe loading counted as a view.

## /analytics

A **LIVESTREAM · YOUTUBE** panel sits after Live Chat, on `/analytics` and in the CMS under **Digital → Analytics** (the same page, embedded and signed in by the CMS; there the connect button and switches are left to the CMS's YouTube page). It loads on its own, so a YouTube or CMS problem leaves the other panels alone. It is visible to accounts with the analytics role and to CMS users whose roles include Analytics (Developer, Digital, or a custom role). It has:

- **Live now:** the three counts with their sources, refreshed every 30 s. These are live measurements, as the panel says.
- **YouTube chat sync** (for whoever's CMS roles include the YouTube or YouTube chat sync page): connected channel, broadcast state and title, video id, live chat id, whether sync is active (streaming or polling), queued messages, sent/failed/imported counters, the quota estimate, whether the worker is running, and the last error. Those who can manage the YouTube page also get the switches and Connect / Check now / Disconnect here; everyone else sees it read-only.
- **History:** a line/bar/table chart of one broadcast with YouTube and website as **separate series** (never stacked; gaps where a count wasn't available), and a table of broadcasts with start, end, peak and average for each measure. Both export to CSV.

### Storage (Postgres, via oz-cms)

Firebase carries the live numbers; Postgres keeps periodic snapshots. Heartbeats are never written to Postgres.

- `livestream-broadcasts`: `broadcastId` (unique), `videoId`, `title`, `startedAt` (indexed), `endedAt`, `peakYoutubeViewers`, `peakWebsiteViewers`, and the running sums and counts behind the averages.
- `livestream-snapshots`: `broadcast` (relationship, indexed), `videoId`, `youtubeConcurrentViewers`, `websiteActiveViewers`, `combinedEstimatedViewers`, `recordedAt` (indexed), `dataAvailability` (`both`/`youtube_only`/`website_only`/`none`), plus a composite index on (`broadcast`, `recordedAt`).

A snapshot is stored every `LIVESTREAM_SNAPSHOT_INTERVAL` (5 min) while live. One with the same numbers as the previous snapshot is skipped unless 15 minutes have passed. Missing counts are stored as empty, not 0, and peaks and averages count only snapshots where the number was known. Records are kept after a broadcast ends, and there is no automatic deletion. A restart carries on the same broadcast record, because the worker finds it by `broadcastId` and reads the last snapshot back from the CMS. Roughly 12 rows per broadcast hour.

The site writes with its existing `website` API key, which can now create and update only these two collections. It also uses a narrow `GET /api/users/staff-roles?email=` endpoint that returns just the staff roles for one email. Deleting is for CMS Developers only.

## Access

| Who | Can |
| :--- | :--- |
| Visitors | chat as before; their player reports while playing |
| `analytics` role (scripts/chat-admin.mjs) | see the Livestream counts and history on `/analytics` |
| CMS **Digital** | the analytics, including the Livestream counts and history |
| CMS **Developer** | everything: connect/disconnect, check now, the quota saver, the chat sync switches, unban |
| CMS **custom roles** (Admin → Roles) | per page: *View* or *Manage* on YouTube (connect, check now, quota saver), YouTube chat sync (the two directions) and Moderation (unban), and *View* on Analytics |

The CMS works out what each person may do from all their roles (oz-cms `src/permissions.ts`) and sends it to the site per page: `{ youtube, chatSync, moderation, analytics }`, each none, view or edit (`src/lib/youtube/roles.ts`). There are two ways to be recognised:
- **In the CMS** (its website pages): the CMS checks the signed-in user and signs a short-lived token (`CMS_SITE_SECRET`, `src/lib/admin-token.ts`) carrying those permissions. The site checks the signature, the expiry and the permissions again.
- **On this site** (`/analytics`): Google sign-in, matched to the CMS user with the same verified email (`src/lib/admin-access.ts`), so a staff member's CMS email must be that Google address.

Chat roles (DEV/OPERATOR/HOST/MOD) only give chat badges and moderation and grant nothing here. Nothing is trusted from the browser.

## Quota

At the default 10,000 units/day:

| Call | Cost | Typical use |
| :--- | :--- | :--- |
| `liveBroadcasts.list` | 1 | about 100–200/day while offline (the free page does the rest, below) |
| `videos.list` | 1 | to confirm a broadcast the page found; then 60/hour while live (20/hour when saving) |
| `liveChatMessages.streamList` | 5 per connection | a few per hour |
| `liveChatMessages.list` (fallback) | 5 per call | up to 360/hour at the 10 s floor = 1,800 units/hour |
| `liveChatMessages.insert` | **20** per post | a post can carry several website messages (bundling, below) |

**Website → YouTube is the expensive part:** about 400 posts a day after detection and reading.

How quota is saved (`src/lib/youtube/saver.ts`, `page-check.ts`, `outbox.ts`):

- **Bundling.** Website messages that are ready together go to YouTube as one post, `[Website] Bran: hi · Sari: halo · Dodi: mantap`, up to YouTube's 200 characters, oldest first, never splitting a message. A message waits up to 2 seconds for others (6 when saving); a message on its own is posted unchanged. The echo of a bundle is recognised like any other, and a bundle that timed out is matched to its echo for every message in it.
- **Free detection.** While nothing is live, the worker reads the connected channel's public page (`youtube.com/channel/<id>/live`), which costs nothing, and spends 1 unit to confirm a broadcast only when the page shows one. Scheduled broadcasts are seen for free too. The public page doesn't show unlisted broadcasts, so the API also looks every 15 minutes (30 when saving), and at once on **Check now** in the CMS. If the page can't be read, the API is asked instead.
- **The quota saver**, switched on the CMS's **Broadcast → YouTube** page:
  - **Automatic quota saver** (on by default): *Saving* from 50 % of the day's quota, *Strict* from 80 %.
  - **Quota saver on now** (off by default): at least *Saving*, whatever the quota.
  - *Saving*: bundles over 6 seconds, checks a live broadcast (viewer count, has it ended) every 3 minutes instead of every minute, and asks the API for new broadcasts every 30 minutes.
  - *Strict*: as *Saving*, and only moderators' website messages go to YouTube. Everyone else's stay on the website, marked "not sent to YouTube" for the sender.
  - The page shows the day's use and the current level. The two switches are stored with the other sync settings at `chat/private/youtube/settings` (`autoSaver`, `saver`).

The worker keeps its own count (by Pacific day, shown in the panel) The worker keeps its own count (by Pacific day, shown in the panel), keeps 500 units in reserve for detection and reading, stops sending before the limit, and treats `quotaExceeded` from YouTube as final until the reset (midnight Pacific: 15:00 WIB, or 14:00 during US daylight saving).

While the quota is used up, nothing can be asked of YouTube, so the site doesn't pretend to know. Posting and reading the YouTube chat stop, and website messages stay on the website, their senders seeing "not sent to YouTube". If a broadcast was live, its public status becomes **unknown**: the player hides the viewer bar instead of showing a frozen YouTube count, "YOUTUBE CHAT LINKED" goes, website viewers aren't counted, and no history snapshots are stored. The player can still find the stream through YouTube's public page. Everything resumes by itself at the next check after the reset. For a busy chat, request a higher quota or turn **Website → YouTube** off and keep YouTube → website on.

## Testing

```sh
npm test            # node --test, no network or credentials: mocked YouTube, in-memory database
npx astro build
```

`tests/youtube/` covers, against mocked YouTube responses:

1. offline: chat saves normally, nothing is queued
2. upcoming: no sync
3. going live: sync on, with the broadcast's chat id
4. a website message goes to YouTube in the `[Website] Name: text` form and gets `ys: 'sent'`
5. a YouTube message lands in the room with its author
6. duplicates: own echo (live and after a restart), the same message twice, a deleted one never returning, and a timed-out send matched to its echo instead of being re-sent
7. the stream ends: sync stops, the queue is failed, the history record is closed
8. the API is down: error state, chat unaffected; a brief failure while live doesn't stop the sync
9. tokens are reused, a 401 refreshes and retries once, and a revoked grant asks for a reconnect
10. quota exhausted: queue failed, sync paused, nothing new queued
11. heartbeats count a playing player
12. pausing or going quiet stops counting
13. the YouTube count is published and updated
14. a hidden YouTube count is stored and shown as unavailable, not 0
15. repeated heartbeats and many sessions from one machine don't inflate the count
16. only CMS Developer can manage, and Digital can only look; other roles and chat roles get nothing

It also covers backoff, the attempt limit, moderator deletion, the per-minute limit, website rules on YouTube messages, history across a restart, the lease, and an exhausted quota while live (status unknown, no stale count). `tests/youtube/saver.test.ts` covers bundling (one post, the wait, the 200-character limit, a timed-out bundle), the saver levels and switches, strict mode keeping moderators' messages only, and free detection (no quota while nothing is live, one call to confirm, scheduled broadcasts, the 15-minute and Check now API checks, and falling back to the API).

### Trying it locally

Local development shares the production Firebase project, so a local worker would write to the live database. Only do this with that in mind, and **don't run a local worker while the VPS one is live**. The lease stops two workers running at once, but whichever starts first wins.

1. Add the YouTube variables to `.env`, with `http://127.0.0.1:4321/api/youtube/callback` as an authorized redirect URI.
2. Start the CMS (`oz-cms`: `docker compose up -d`, `npm run dev`; dev mode creates the new tables) and the site (`astro dev --background --host 127.0.0.1`).
3. Set the same `CMS_SITE_SECRET` in both `.env` files, and in the CMS's `.env` set `SITE_URL=http://127.0.0.1:4321`: the same host as the redirect URI, or the check cookie is set on `localhost` and missing on `127.0.0.1`. Sign in to the CMS as a Developer and open **Broadcast → YouTube → Connect YouTube channel**. Alternatively, sign in on `/analytics` with a Google account whose email belongs to a CMS Developer and use the button there.
4. **Offline mode:** with nothing live, the panel shows `Offline`, the chat has no YouTube indicator, and messages send as usual.
5. **Live mode:** start a broadcast on the OZ channel (an unlisted one is fine). Within the check interval the panel shows `Live`, the chat heading shows **● YOUTUBE CHAT LINKED**, and messages cross over both ways. Tune in to video on `/oz-bandung` and the website count rises within about 15 seconds. End the broadcast and the state goes to `Ended` then `Offline`.

## Deploying (when decided; not done)

1. oz-cms: deploy the branch. The migration `20261112_093106_livestream_analytics` runs on start (`prodMigrations`); it only adds tables.
2. Site: add the variables to the VPS `.env`, deploy, restart. Then connect the channel from `/analytics`.

## Known limitations

- Website messages appear on YouTube **as the OZ channel**, with the website name in the text. YouTube's API cannot post as anyone else.
- YouTube moderation (deleting or banning on YouTube) isn't mirrored to the website, and website moderation isn't mirrored to YouTube. Website moderators can remove YouTube messages and silence YouTube authors here.
- Only text messages are copied from YouTube (no Super Chats, stickers, polls or memberships).
- Quota limits website → YouTube to roughly 400 messages a day by default.
- A send whose answer is lost **and** whose process restarts within the 20-second window can be posted twice (the echo matching is held in memory).
- Website viewer sessions are capped per address *per process*; the registry itself is in Firebase, so counts are right with several processes, but the cap is per process.
- The page's own "YOUTUBE CHAT LINKED" and viewer counts come from Firebase; while the chat has dropped its idle connection, the counts refresh with the player's heartbeats instead (every 20 s while playing).
- The OAuth app must be published (not "Testing") or the refresh token expires after 7 days.
- Deleting a broadcast record in the CMS is blocked while snapshots point at it (delete its snapshots first).

## Turning it off and rolling back

- **Pause:** on `/analytics`, switch off *Website → YouTube* and/or *YouTube → website*, or **Disconnect** the channel. The website chat carries on.
- **Off:** set `YOUTUBE_SYNC=off` (or remove `YOUTUBE_CLIENT_ID`) and restart. The worker doesn't start, `/api/viewers` answers without counting, nothing about YouTube shows on the page, and the chat is exactly as before.
- **Roll back the code:** deploy `payload` again. Messages written while the feature ran keep their extra fields (`s`, `c`, `ys`), which the old code ignores; YouTube messages show as normal messages.
- **Clean up (optional):** delete `chat/private/youtube` and `chat/rooms/bandung/meta/youtube` in the Firebase console, and revoke the app under the Google account's *Third-party access*. The CMS tables can stay (they're unused), or be removed with `payload migrate:down` for the livestream migration.
