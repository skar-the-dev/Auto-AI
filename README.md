# Auto AI

A cloud-hosted control centre for planning short-form content across multiple TikTok and YouTube Shorts accounts.

## Current working features
- Cloudflare Pages dashboard
- Cloudflare D1 account storage and account CRUD
- Per-account niche, platform selection, active state and publishing interval
- Template-based short-form script outlines
- Cloudflare D1 script library with draft / production / completed status
- Browser speech-synthesis voice preview (preview only; it does not create an audio file)
- Production queue records saved in D1 with a clear "Waiting for renderer" state

## Not yet implemented
- Automated topic research and factual verification
- AI model integration for original scripts
- Server-side text-to-speech audio generation
- Licensed footage sourcing and asset rights checks
- Video rendering and file storage
- Background worker / cron scheduler
- TikTok and YouTube OAuth connections and automatic publishing
- Publishing analytics and performance optimisation

## Planned architecture
- Cloudflare Pages: dashboard and lightweight API
- Cloudflare D1: accounts, scripts, production queue and job state
- Cloudflare R2: rendered media storage, subject to plan limits
- Cloudflare Worker with Cron Triggers or another reliable worker: scheduled processing
- Approved external AI, voice, media and rendering services as available

## Defaults
- Per-account interval: 240 minutes (4 hours)
- Each account has its own niche, platforms, interval and pause state
- No hard-coded account count; practical limits depend on provider quotas

## Important
- A queue item currently records work waiting for a renderer; it does not generate a video.
- TikTok and YouTube integrations require official OAuth/API authorisation and compliance with platform review, quotas and publishing policies.
- Free tiers have usage limits. Unlimited generation, rendering, storage or always-on processing is not promised.
- Never commit passwords, API keys, OAuth secrets or access tokens.

## Series Autopilot implementation

The dashboard now has a one-click Series Autopilot workflow:
- Reuses the selected account, saved niche, optional topic clarification and a maximum batch size of six.
- Generates narration with Workers AI Aura-2 and five original scene illustrations with FLUX.1 schnell.
- The cloud FFmpeg renderer turns the scene illustrations, captions and narration into a vertical MP4.
- Uploads the first video immediately to the connected YouTube channel and schedules the remaining videos four hours apart.
- Blocks automatic public publishing when the generated script's factual claims do not have source support.
- TikTok publishing is intentionally not included until TikTok developer approval is complete.

The current generated visuals are AI-created illustrations with camera motion, not downloaded stock footage or genuine recordings of real events.

## Deployment requirements for Series Autopilot

The Pages dashboard and API deploy from the connected GitHub branch. The separate FFmpeg renderer is a Cloudflare Worker/Container deployed by `.github/workflows/deploy-renderer.yml`.

Required GitHub repository Actions secrets:
- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with Workers Editor / Workers Scripts Edit permission for this account.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID.
- `RENDERER_API_KEY`: a long random secret protecting the renderer.

Required Cloudflare Pages Production secrets/variables:
- `VIDEO_RENDERER_URL`: deployed renderer Worker URL, without `/render`.
- `VIDEO_RENDERER_KEY`: same value as GitHub Actions `RENDERER_API_KEY`.
- `AUTO_AI_ADMIN_KEY`, YouTube OAuth credentials and `TOKEN_ENCRYPTION_KEY` as described below.

Cloudflare Containers require a Workers Paid plan. Workers AI has a daily free allocation, but image generation, narration and script generation remain subject to Cloudflare's model limits and quotas. A six-video batch may be limited by the remaining daily allowance.

## YouTube OAuth integration (in progress)

The feature branch `feature/youtube-oauth-integration` adds the first secure channel-connection flow. It is not active on the production site until reviewed, merged and deployed.

Required Cloudflare Pages environment secrets:
- `YOUTUBE_CLIENT_ID`: OAuth client ID from Google Cloud.
- `YOUTUBE_CLIENT_SECRET`: OAuth client secret from Google Cloud.
- `YOUTUBE_REDIRECT_URI`: `https://auto-ai-c8y.pages.dev/api/youtube/callback`.
- `AUTO_AI_ADMIN_KEY`: private admin access key used by the dashboard to protect connection management.
- `TOKEN_ENCRYPTION_KEY`: base64-encoded 32-byte key used to encrypt stored refresh tokens.

Google OAuth authorised redirect URI must exactly match `YOUTUBE_REDIRECT_URI`. Add the app owner as a Google OAuth test user while the consent screen is in Testing.

The connection flow stores the YouTube refresh token encrypted with AES-GCM and exposes only channel metadata to the dashboard. Video upload/publishing, token refresh jobs, revocation, and scheduled publishing are separate follow-on work and are not implemented by this initial connection flow.
