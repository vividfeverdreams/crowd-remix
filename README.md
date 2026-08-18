# DREAM SEQUENCE

DREAM SEQUENCE is a single-DJ MVP for live AI visuals. A DJ logs in, defines a visual DNA for the show, chooses a video model, seeds the first loop, and lets the crowd send remix ideas through SMS or a QR-linked web form. The app moderates and ranks those ideas, rewrites the winning one into a focused video-edit prompt, and crossfades into the next completed loop when it is ready.

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
- AI-assisted session setup that expands a plain-English concept into an editable visual-DNA draft
- Selectable Gemini Omni Flash, Seedance 2.0, Seedance 2.5, and Hailuo 3.0 seed generation and video-remix editing through Runway
- Optional audience reference photos with multimodal safety screening and image-guided remixes
- SSE-driven realtime updates for the dashboard and show screen
- Double-buffer video crossfade on the fullscreen playback route
- Supabase Postgres persistence for users, sessions, queue state, and render metadata
- Supabase Storage persistence for downloaded MP4 assets
- Legacy direct-Gemini fallback plus demo mode when neither provider key is configured

## Important Product Constraint

Live video generation and editing use Runway's asynchronous task API. The creation page constrains clip length to each selected model's supported whole-second range: Gemini Omni Flash 3–10 seconds, Seedance 2.0 4–15 seconds, Seedance 2.5 4–30 seconds, and Hailuo 3.0 5–15 seconds. The current loop keeps playing while a task runs; after Runway publishes an output URL, the app immediately downloads and stores the completed MP4 for durable playback.

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

### Required for OpenAI-backed moderation and session setup

- `OPENAI_API_KEY`
- `OPENAI_TEXT_MODEL`

### Required for selectable Runway video generation and remixing

- `RUNWAYML_API_SECRET`

The model is selected per session on the creation page. `GEMINI_API_KEY` and `GEMINI_VIDEO_MODEL` remain available only as a legacy Gemini Omni fallback; Seedance and Hailuo require Runway. The app reads OpenAI, Runway, and Google credentials from server-side environment variables only. The dashboard does not store or edit API keys.

The AI-assisted session setup uses this same OpenAI text-model configuration. If draft generation is unavailable, the setup screen still lets the DJ enter every field manually.

### Required for Twilio SMS intake

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`

### Optional demo fallback

- `DEMO_LOOP_URL`

If neither `RUNWAYML_API_SECRET` nor `GEMINI_API_KEY` is present, the app uses a demo video URL so the playback and crossfade flow can still be exercised locally. If `OPENAI_API_KEY` is absent, the app falls back to its built-in moderation and ranking behavior.

## Vercel Deployment

The production app is designed for Vercel's serverless runtime. Configure the variables from `.env.example` in the Vercel Production environment, with these production-specific values:

- Use Supabase's pooled connection string for `DATABASE_URL` and its direct connection string for `DIRECT_URL`.
- Set `NEXT_PUBLIC_APP_URL` to the public production origin, such as `https://dream-sequence.vercel.app`.
- Use a private server-side `SUPABASE_SERVICE_ROLE_KEY`; never expose it with a `NEXT_PUBLIC_` prefix.
- Create the `SUPABASE_STORAGE_BUCKET` bucket before starting a real video render.
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
- `GET /api/assets/[assetId]`

## How The Queue Works

1. Crowd prompt arrives from SMS or web form.
2. The app rate-limits and normalizes it.
3. The text model scores it for safety, cohesion, novelty, and remixability.
4. Approved prompts enter the ranked queue.
5. If no render is active and no next asset is waiting, the best approved prompt is selected.
6. The app starts a Runway task with the session's selected video model or edits the current video for a remix, including an approved audience reference photo when one was attached.
7. Once the render is completed, the output becomes the next queued loop.
8. With audio sync disconnected, the fullscreen show keeps the existing automatic crossfade behavior.
9. With audio sync connected, the ready loop waits for a detected build or section change, or for the operator to click **Take next remix now**.

## Audio-Reactive Show Output

Use the **Audio Reactive Engine** panel directly on the DJ dashboard, then open **Pop Out Show** or **Fullscreen Show** as the clean projection output:

1. Route a mixer, audio interface, or virtual loopback output into an input device visible to the browser.
2. Click **Connect input** and allow microphone/audio-input access for the site.
3. Select the desired input, choose one of the 10 audio-reactive transformations from the dropdown, and adjust **VFX intensity**. The selected treatment transforms the video footage itself rather than drawing a graphic overlay.
4. Turn on **Auto-cycle all 10 effects** to move to the next effect every 12 seconds while the input is connected.
5. Leave **Take next remix on musical cue** enabled to crossfade ready remixes on detected builds and strong returns after quiet passages.

The input is analyzed locally with the Web Audio API and is never connected to browser playback, which avoids monitoring feedback. Keep the dashboard open on the same browser and computer as the show window; it sends only reactive levels and transition cues to the visual output. The projection window contains no operator controls or status text.

## Notes About Infrastructure Choices

- Supabase Postgres is the source of truth in both development and production; the app does not rely on a serverless filesystem.
- Rendered videos are uploaded to Supabase Storage and served from the configured public bucket.
- Runway video tasks are polled until they succeed or fail. Successful output URLs are ephemeral, so reconciliation downloads each MP4 into Supabase Storage before exposing it to playback.
- Audience photos are limited to supported image formats, verified by file signature, screened with multimodal moderation before storage, and counted alongside video moderation toward the three-strike device lockout for that live session.
- Each completed remix is persisted and its public MP4 URL becomes the source for the next Runway video-to-video task.

## Testing

Run:

```bash
pnpm test
```

The test suite covers the Runway and legacy Gemini request contracts, queue behavior, fallback assessment, auth helpers, playback transitions, and audio-reactive controls.
