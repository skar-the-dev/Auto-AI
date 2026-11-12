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
