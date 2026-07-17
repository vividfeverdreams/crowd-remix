# DREAM SEQUENCE

DREAM SEQUENCE is a single-DJ MVP for live AI visuals. A DJ logs in, defines a visual DNA for the show, seeds the first loop, and lets the crowd send remix ideas through SMS or a QR-linked web form. The app moderates and ranks those ideas, rewrites the winning one into a focused Sora remix prompt, and crossfades into the next completed loop when it is ready.

## What This MVP Includes

- Next.js App Router frontend for:
  - DJ login
  - live dashboard
  - public crowd submission page
  - fullscreen show page
- Prisma data model with:
  - `User`
  - `DJSession`
  - `PromptSubmission`
  - `ModerationResult`
  - `RankingResult`
  - `VisualAsset`
  - `RenderJob`
  - `PlaybackState`
  - `AuditEvent`
- SMS intake via Twilio webhook
- Public web prompt intake via `/r/[sessionCode]`
- OpenAI text scoring for moderation/ranking/prompt compilation
- OpenAI Sora seed/remix orchestration
- SSE-driven realtime updates for the dashboard and show screen
- Double-buffer video crossfade on the fullscreen playback route
- Supabase Postgres persistence for users, sessions, queue state, and render metadata
- Supabase Storage persistence for downloaded MP4 assets
- Demo-mode fallback if `OPENAI_API_KEY` is missing

## Important Product Constraint

Sora video generation is asynchronous. This app is built so the experience feels responsive in under 10 seconds through fast intake, queueing, and status updates, while the current loop stays on screen until the next completed remix is ready.

## Local Setup

1. Install dependencies.
2. Copy `.env.example` to `.env` and point it at a Supabase Postgres project.
3. Run the Prisma migration against that database.
4. Seed the demo user and starter session.
5. Start the app.

Example commands:

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

If you use `npm` instead of `pnpm`, the equivalent commands are:

```bash
cp .env.example .env
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

## Demo Credentials

The seed script creates:

- Email: `dj@example.com`
- Password: `dreamsequence-demo`

You can override those values with `SEED_DJ_EMAIL` and `SEED_DJ_PASSWORD`.

## Environment Variables

### Required for the full live stack

- `AUTH_SECRET`
- `DATABASE_URL`
- `NEXT_PUBLIC_APP_URL`

### Required for OpenAI-backed moderation and Sora rendering

- `OPENAI_API_KEY`
- `OPENAI_TEXT_MODEL`
- `OPENAI_VIDEO_MODEL`

The app reads OpenAI credentials from environment variables only. The dashboard does not store or edit API keys.

### Required for Twilio SMS intake

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`

### Optional demo fallback

- `DEMO_LOOP_URL`

If `OPENAI_API_KEY` is absent, the app uses a demo video URL so the playback and crossfade flow can still be exercised locally.

## Vercel Deployment

The production app is designed for Vercel's serverless runtime. Configure the variables from `.env.example` in the Vercel Production environment, with these production-specific values:

- Use Supabase's pooled connection string for `DATABASE_URL` and its direct connection string for `DIRECT_URL`.
- Set `NEXT_PUBLIC_APP_URL` to the public production origin, such as `https://dream-sequence.vercel.app`.
- Use a private server-side `SUPABASE_SERVICE_ROLE_KEY`; never expose it with a `NEXT_PUBLIC_` prefix.
- Create the `SUPABASE_STORAGE_BUCKET` bucket before starting a real Sora render.
- Add the three `TWILIO_*` variables only when SMS intake is enabled. The web audience form works without them.

The live snapshot endpoint intentionally ends each serverless response before Vercel's function timeout. Browser `EventSource` clients reconnect automatically, preserving realtime dashboard and show updates without accumulating runtime timeout errors.

## Core Routes

- `/login`
- `/dashboard`
- `/r/[sessionCode]`
- `/show/[sessionId]`

## Core API Endpoints

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/sessions`
- `POST /api/sessions/[sessionId]/start`
- `POST /api/sessions/[sessionId]/control`
- `GET /api/sessions/[sessionId]/stream`
- `POST /api/sessions/[sessionId]/transition`
- `POST /api/sessions/[sessionId]/reconcile`
- `POST /api/r/[sessionCode]`
- `POST /api/twilio/inbound`
- `POST /api/openai/video-webhook`
- `GET /api/assets/[assetId]`

## How The Queue Works

1. Crowd prompt arrives from SMS or web form.
2. The app rate-limits and normalizes it.
3. The text model scores it for safety, cohesion, novelty, and remixability.
4. Approved prompts enter the ranked queue.
5. If no render is active and no next asset is waiting, the best approved prompt is selected.
6. The app starts a seed render or remix render with Sora.
7. Once the render is completed, the output becomes the next queued loop.
8. With audio sync disconnected, the fullscreen show keeps the existing automatic crossfade behavior.
9. With audio sync connected, the ready loop waits for a detected build or section change, or for the operator to click **Take next remix now**.

## Audio-Reactive Show Output

Use the **Audio Reactive Engine** panel directly on the DJ dashboard, then open **Pop Out Show** or **Fullscreen Show** as the clean projection output:

1. Route a mixer, audio interface, or virtual loopback output into an input device visible to the browser.
2. Click **Connect input** and allow microphone/audio-input access for the site.
3. Select the desired input and adjust **VFX intensity**.
4. Leave **Take next remix on musical cue** enabled to crossfade ready Sora remixes on detected builds and strong returns after quiet passages.

The input is analyzed locally with the Web Audio API and is never connected to browser playback, which avoids monitoring feedback. Keep the dashboard open on the same browser and computer as the show window; it sends only reactive levels and transition cues to the visual output. The projection window contains no operator controls or status text.

## Notes About Infrastructure Choices

- Supabase Postgres is the source of truth in both development and production; the app does not rely on a serverless filesystem.
- Rendered videos are uploaded to Supabase Storage and served from the configured public bucket.
- The app supports OpenAI video webhooks, but it also includes a manual reconciliation endpoint so local development does not depend on webhook delivery.

## Testing

Run:

```bash
pnpm test
```

The current tests cover the heuristic assessment fallback and the auth helper primitives.
