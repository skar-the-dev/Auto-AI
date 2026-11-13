import { json, requireAdmin, tiktokRedirectUri, ensureTikTokTables, encryptSecret } from "../../_shared/tiktok.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const appUrl = new URL("/", request.url);
  let returnAccountId = "";
  try {
    if (!env.DB) throw new Error("Database binding DB is missing.");
    if (url.searchParams.has("error")) throw new Error(url.searchParams.get("error_description") || "TikTok authorisation was cancelled or denied.");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) throw new Error("TikTok did not return a valid authorisation code.");
    await ensureTikTokTables(env.DB);
    const pending = await env.DB.prepare("SELECT account_id, expires_at FROM tiktok_oauth_states WHERE state = ?").bind(state).first();
    returnAccountId = pending?.account_id || "";
    await env.DB.prepare("DELETE FROM tiktok_oauth_states WHERE state = ?").bind(state).run();
    if (!pending || Number(pending.expires_at) < Math.floor(Date.now()/1000)) throw new Error("This TikTok connection request expired. Please try again.");
    if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) throw new Error("TikTok OAuth secrets are not configured in Cloudflare.");
    const tokenResponse = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({
        client_key: env.TIKTOK_CLIENT_KEY,
        client_secret: env.TIKTOK_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: tiktokRedirectUri(request, env)
      })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || tokens.error) throw new Error(tokens.error_description || tokens.error || "TikTok token exchange failed.");
    const profileResponse = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {
      headers: { Authorization: "Bearer " + tokens.access_token }
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || profile.error?.code !== "ok") throw new Error(profile.error?.message || "Could not read the authorised TikTok profile.");
    const user = profile.data?.user;
    if (!user?.open_id) throw new Error("TikTok did not return a profile ID.");
    const accessEncrypted = await encryptSecret(tokens.access_token, env);
    const refreshEncrypted = await encryptSecret(tokens.refresh_token, env);
    const now = Math.floor(Date.now()/1000);
    await env.DB.prepare(`INSERT INTO tiktok_connections
      (account_id, open_id, display_name, avatar_url, access_token_encrypted, refresh_token_encrypted, access_expires_at, refresh_expires_at, scopes, connected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(account_id) DO UPDATE SET open_id=excluded.open_id, display_name=excluded.display_name,
      avatar_url=excluded.avatar_url, access_token_encrypted=excluded.access_token_encrypted,
      refresh_token_encrypted=excluded.refresh_token_encrypted, access_expires_at=excluded.access_expires_at,
      refresh_expires_at=excluded.refresh_expires_at, scopes=excluded.scopes, connected_at=CURRENT_TIMESTAMP`)
      .bind(pending.account_id, user.open_id, user.display_name || "TikTok account", user.avatar_url || "",
        accessEncrypted, refreshEncrypted, now+Number(tokens.expires_in||7200),
        now+Number(tokens.refresh_expires_in||15552000), tokens.scope || "").run();
    appUrl.searchParams.set("tiktok", "connected");
    appUrl.searchParams.set("account", pending.account_id);
    return Response.redirect(appUrl.toString(), 302);
  } catch (error) {
    appUrl.searchParams.set("tiktok", "error");
    if (returnAccountId) appUrl.searchParams.set("account", returnAccountId);
    appUrl.searchParams.set("message", String(error.message || "TikTok connection failed.").slice(0,180));
    return Response.redirect(appUrl.toString(), 302);
  }
}
