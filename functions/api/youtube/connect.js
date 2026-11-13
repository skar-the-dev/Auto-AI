import { json, requireAdmin, callbackUrl, ensureYoutubeTables } from "../../_shared/youtube.js";

export async function onRequestPost({ request, env }) {
  try {
    if (!requireAdmin(request, env)) return json({ success: false, error: "Admin access key is missing or incorrect." }, 401);
    if (!env.DB) return json({ success: false, error: "Database binding DB is missing." }, 500);
    if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
      return json({ success: false, error: "YouTube OAuth secrets are not fully configured in Cloudflare." }, 503);
    }

    const body = await request.json();
    const accountId = String(body.account_id || "").trim();
    if (!accountId) return json({ success: false, error: "Choose an Auto AI account first." }, 400);
    const account = await env.DB.prepare("SELECT id FROM accounts WHERE id = ?").bind(accountId).first();
    if (!account) return json({ success: false, error: "Auto AI account not found." }, 404);

    await ensureYoutubeTables(env.DB);
    const state = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const expiresAt = Math.floor(Date.now() / 1000) + 600;
    await env.DB.prepare("INSERT INTO youtube_oauth_states (state, account_id, expires_at) VALUES (?, ?, ?)")
      .bind(state, accountId, expiresAt).run();

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: env.YOUTUBE_CLIENT_ID,
      redirect_uri: callbackUrl(request, env),
      response_type: "code",
      scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state
    }).toString();
    return json({ success: true, authorization_url: url.toString() });
  } catch (error) {
    return json({ success: false, error: error.message || "Could not start YouTube authorisation." }, 500);
  }
}
