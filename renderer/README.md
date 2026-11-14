# Auto AI Cloud Renderer

This folder contains the separate Cloudflare Worker and Container that renders captioned vertical MP4s with FFmpeg. It is separate from the Cloudflare Pages dashboard because Pages Functions cannot directly host a native FFmpeg process.

## Deployment

Cloudflare Containers require the Workers Paid plan. The included GitHub Actions workflow deploys this Worker when files under renderer/ change.

Add these GitHub repository Actions secrets:

- CLOUDFLARE_API_TOKEN — Cloudflare API token with permission to deploy Workers and Containers for this account.
- CLOUDFLARE_ACCOUNT_ID — Cloudflare account ID.
- RENDERER_API_KEY — a long random secret used to protect the renderer. If supplied as a GitHub Actions secret, the workflow updates it on deploy. If omitted, an already-configured Worker secret is preserved. Use the same value in the Pages project.

After the first successful deploy, note the Worker URL shown by Wrangler. It will look like https://auto-ai-renderer.YOUR-SUBDOMAIN.workers.dev.

In Cloudflare Pages → auto-ai → Settings → Variables and Secrets, add these for Production (and Preview if needed):

- VIDEO_RENDERER_URL — the Worker URL, without /render.
- VIDEO_RENDERER_KEY — the exact same value as GitHub secret RENDERER_API_KEY.

Redeploy the Pages project after adding the two values. The /api/render Pages Function proxies authenticated render requests to this Worker.

## Current renderer scope

- Accepts generated MP3 narration, up to eight scene captions and AI-generated scene artwork.
- Produces a 1080 × 1920 H.264/AAC MP4 with scene-by-scene images, gentle camera motion and timed captions.
- Runs FFmpeg in a Cloudflare Container, not in the user's browser.
- Series Autopilot creates original scene artwork with Cloudflare Workers AI FLUX.1 schnell; these are AI illustrations, not real-world footage or proof of an event.
- It does not download third-party clips or bypass platform restrictions.
- The first version returns the rendered MP4 to the calling API for direct YouTube upload. It does not yet keep a permanent cloud video archive.

## Security

Never commit API keys or OAuth secrets. Rotate the renderer key in GitHub Actions and Cloudflare Pages together if it is exposed.