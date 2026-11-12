# Auto AI

A multi-account content planning dashboard for YouTube Shorts and TikTok.

## Current stage
This repository contains the first dashboard prototype. It manages account profiles and schedules locally in the browser. It is not yet a live publishing service.

## Planned architecture
- Cloudflare Pages: dashboard hosting
- Cloudflare Workers: API and lightweight scheduling
- Cloudflare D1: accounts, queues and job state
- Cloudflare R2: media storage within free allowances
- External temporary FFmpeg jobs: video rendering

## Defaults
- Per-account publishing interval: 240 minutes (4 hours)
- Each account has its own niche, enabled platforms, schedule and pause state
- No hard-coded account count; practical limits depend on provider quotas

## Important
- TikTok and YouTube integrations require official OAuth/API authorisation and compliance with platform review, quotas and publishing policies.
- This starter does not generate videos or publish posts yet.
- AI generation, licensed media and storage have provider-specific limits; unlimited free usage is not promised.
- Never commit passwords, API keys, OAuth secrets or access tokens.
