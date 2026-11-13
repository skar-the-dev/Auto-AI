import { encryptSecret, decryptSecret, json, requireAdmin } from "./youtube.js";

export { encryptSecret, decryptSecret, json, requireAdmin };

export function tiktokRedirectUri(request, env) {
  return env.TIKTOK_REDIRECT_URI || new URL("/api/tiktok/callback", request.url).toString();
}

export async function ensureTikTokTables(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS tiktok_oauth_states (
    state TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS tiktok_connections (
    account_id TEXT PRIMARY KEY,
    open_id TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT NOT NULL,
    access_expires_at INTEGER NOT NULL,
    refresh_expires_at INTEGER NOT NULL,
    scopes TEXT,
    connected_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

export async function refreshTikTokConnection(db, env, row) {
  const now = Math.floor(Date.now() / 1000);
  if (Number(row.access_expires_at) > now + 180) return row;
  const refreshToken = await decryptSecret(row.refresh_token_encrypted, env);
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY,
      client_secret: env.TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error_description || data.error || "TikTok token refresh failed.");
  const accessEncrypted = await encryptSecret(data.access_token, env);
  const refreshEncrypted = await encryptSecret(data.refresh_token, env);
  const accessExpiry = now + Number(data.expires_in || 7200);
  const refreshExpiry = now + Number(data.refresh_expires_in || 15552000);
  await db.prepare(`UPDATE tiktok_connections SET access_token_encrypted = ?,
    refresh_token_encrypted = ?, access_expires_at = ?, refresh_expires_at = ?
    WHERE account_id = ?`).bind(accessEncrypted, refreshEncrypted, accessExpiry, refreshExpiry, row.account_id).run();
  return { ...row, access_token_encrypted: accessEncrypted, refresh_token_encrypted: refreshEncrypted, access_expires_at: accessExpiry, refresh_expires_at: refreshExpiry };
}
