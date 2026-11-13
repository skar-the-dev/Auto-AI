import { json, requireAdmin, ensureTikTokTables, refreshTikTokConnection } from "../../_shared/tiktok.js";

export async function onRequestGet({ request, env }) {
  try {
    if (!requireAdmin(request, env)) return json({ success: false, error: "Admin access key is missing or incorrect." }, 401);
    if (!env.DB) return json({ success: false, error: "Database binding DB is missing." }, 500);
    if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) return json({ success: false, error: "TikTok OAuth secrets are not configured in Cloudflare." }, 503);
    await ensureTikTokTables(env.DB);
    const result = await env.DB.prepare(`SELECT c.account_id, c.open_id, c.display_name, c.avatar_url, c.access_token_encrypted,
      c.refresh_token_encrypted, c.access_expires_at, c.refresh_expires_at, c.scopes, c.connected_at, a.name AS account_name
      FROM tiktok_connections c LEFT JOIN accounts a ON a.id=c.account_id ORDER BY c.connected_at DESC`).all();
    const connections = [];
    for (const original of result.results || []) {
      const row = await refreshTikTokConnection(env.DB, env, original);
      connections.push({ account_id: row.account_id, open_id: row.open_id, display_name: row.display_name,
        avatar_url: row.avatar_url, scopes: row.scopes, connected_at: row.connected_at, account_name: row.account_name });
    }
    return json({ success: true, connections });
  } catch (error) {
    return json({ success: false, error: error.message || "Could not load TikTok connections." }, 500);
  }
}
