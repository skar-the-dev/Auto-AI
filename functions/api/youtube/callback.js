import { json, redirect, callbackUrl, ensureYoutubeTables, encryptSecret } from "../../_shared/youtube.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const appUrl = new URL("/", request.url);
  let returnAccountId = "";
  try {
    if (!env.DB) throw new Error("Database binding DB is missing.");
    if (url.searchParams.has("error")) throw new Error("Google authorisation was cancelled or denied.");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) throw new Error("Google did not return a valid authorisation code.");

    await ensureYoutubeTables(env.DB);
    const pending = await env.DB.prepare("SELECT account_id, expires_at FROM youtube_oauth_states WHERE state = ?")
      .bind(state).first();
    returnAccountId = pending?.account_id || "";
    await env.DB.prepare("DELETE FROM youtube_oauth_states WHERE state = ?").bind(state).run();
    if (!pending || Number(pending.expires_at) < Math.floor(Date.now() / 1000)) {
      throw new Error("This connection request expired. Please try connecting again.");
    }
    if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
      throw new Error("YouTube OAuth secrets are not configured in Cloudflare.");
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.YOUTUBE_CLIENT_ID,
        client_secret: env.YOUTUBE_CLIENT_SECRET,
        redirect_uri: callbackUrl(request, env),
        grant_type: "authorization_code"
      })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(tokens.error_description || tokens.error || "Google token exchange failed.");
    if (!tokens.refresh_token) throw new Error("Google did not return a refresh token. Revoke Auto AI access in your Google Account and try again.");

    const channelResponse = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: { Authorization: "Bearer " + tokens.access_token }
    });
    const channelData = await channelResponse.json();
    if (!channelResponse.ok) throw new Error(channelData.error?.message || "Could not read the authorised YouTube channel.");
    const channel = channelData.items?.[0];
    if (!channel) throw new Error("No YouTube channel was found on the authorised Google account.");

    const encryptedRefreshToken = await encryptSecret(tokens.refresh_token, env);
    await env.DB.prepare(`INSERT INTO youtube_connections
      (account_id, channel_id, channel_title, refresh_token_encrypted, connected_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(account_id) DO UPDATE SET
        channel_id = excluded.channel_id,
        channel_title = excluded.channel_title,
        refresh_token_encrypted = excluded.refresh_token_encrypted,
        connected_at = CURRENT_TIMESTAMP`)
      .bind(pending.account_id, channel.id, channel.snippet?.title || "YouTube channel", encryptedRefreshToken).run();

    appUrl.searchParams.set("youtube", "connected");
    appUrl.searchParams.set("account", pending.account_id);
    return redirect(appUrl.toString());
  } catch (error) {
    appUrl.searchParams.set("youtube", "error");
    if (returnAccountId) appUrl.searchParams.set("account", returnAccountId);
    appUrl.searchParams.set("message", String(error.message || "YouTube connection failed.").slice(0, 180));
    return redirect(appUrl.toString());
  }
}
