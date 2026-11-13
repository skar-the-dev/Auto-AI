import { json, requireAdmin, tiktokRedirectUri, ensureTikTokTables } from "../../_shared/tiktok.js";

export async function onRequestPost({ request, env }) {
  try {
    if (!requireAdmin(request, env)) return json({ success: false, error: "Admin access key is missing or incorrect." }, 401);
    if (!env.DB) return json({ success: false, error: "Database binding DB is missing." }, 500);
    if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
      return json({ success: false, error: "TikTok OAuth settings are not fully configured in Cloudflare." }, 503);
    }
    const body = await request.json();
    const accountId = String(body.account_id || "").trim();
    if (!accountId) return json({ success: false, error: "Choose an Auto AI account first." }, 400);
    const account = await env.DB.prepare("SELECT id FROM accounts WHERE id = ?").bind(accountId).first();
    if (!account) return json({ success: false, error: "Auto AI account not found." }, 404);
    await ensureTikTokTables(env.DB);
    const state = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2,"0")).join("");
    await env.DB.prepare("INSERT INTO tiktok_oauth_states (state, account_id, expires_at) VALUES (?, ?, ?)")
      .bind(state, accountId, Math.floor(Date.now()/1000)+600).run();
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.search = new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY,
      response_type: "code",
      scope: "user.info.basic",
      redirect_uri: tiktokRedirectUri(request, env),
      state
    }).toString();
    return json({ success: true, authorization_url: url.toString() });
  } catch (error) {
    return json({ success: false, error: error.message || "Could not start TikTok authorisation." }, 500);
  }
}
