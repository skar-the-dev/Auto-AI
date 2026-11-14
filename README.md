# Auto AI

A cloud-hosted control centre for planning short-form content across multiple TikTok and YouTube Shorts accounts.

## Current working features
- Cloudflare Pages dashboard and account management.
- Cloudflare D1 storage for accounts, scripts and production queue records.
- Batch Studio topic/script workflow and existing AI-assisted research endpoints.
- YouTube and TikTok OAuth connection code (publishing remains subject to platform approval, credentials and deployment configuration).
- FFmpeg renderer source code in `renderer/app.py`.
- GitHub Actions syntax-validation workflow.

## Video automation status

The end-to-end Series Autopilot is **not ready to publish videos yet**. The current `functions/api/autopilot/publish.js` still expects a separately hosted renderer through `VIDEO_RENDERER_URL` and `VIDEO_RENDERER_KEY`. That deployment route was removed because it could require paid Cloudflare infrastructure.

Do not enter payment details, upgrade Cloudflare, or deploy the old Container renderer.

## Zero-cost target architecture

The intended design is:
1. Cloudflare Pages Functions and D1 manage the dashboard, accounts, scripts and job metadata.
2. Workers AI may generate narration and scene images within the account's available free allowance.
3. Cloudflare R2 Standard may hold temporary audio, scene images and rendered MP4 files within its free allowance, if available on the account.
4. GitHub Actions runners for this public repository run FFmpeg to assemble videos and process queued jobs.
5. A protected callback updates job status; the publishing service uses official YouTube OAuth/API. TikTok publishing remains disabled until developer approval and compliant API access are confirmed.

This design is being implemented. GitHub Actions currently validates code only; it does not yet poll a video queue or render and publish videos. Scheduled GitHub workflows can be delayed and are not a real-time guarantee.

## Free usage limits and reliability

Free services have quotas, model availability limits, storage limits and usage policies. When an allowance is exhausted, Auto AI should pause and report the limit rather than silently incur charges. This is not an unlimited free-rendering promise.

## Defaults
- Maximum batch size: six videos.
- Default interval: 240 minutes (four hours).
- Each account has its own niche, platform selection, interval and pause state.

## Security
- Never commit passwords, API keys, OAuth secrets, access tokens or encryption keys.
- Keep admin and worker credentials in Cloudflare Pages secrets and GitHub Actions secrets, never in browser code.
- YouTube/TikTok publishing requires official OAuth/API authorisation and compliance with each platform's policies and quotas.
