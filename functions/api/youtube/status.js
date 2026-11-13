import { json, requireAdmin, ensureYoutubeTables } from "../../_shared/youtube.js";

export async function onRequestGet({ request, env }) {
  try {
    if (!requireAdmin(request, env)) return json({ success: false, error: "Admin access key is missing or incorrect." }, 401);
    if (!env.DB) return json({ success: false, error: "Database binding DB is missing." }, 500);
    await ensureYoutubeTables(env.DB);
    const result = await env.DB.prepare(`SELECT c.account_id, c.channel_id, c.channel_title, c.connected_at, a.name AS account_name
      FROM youtube_connections c LEFT JOIN accounts a ON a.id = c.account_id
      ORDER BY c.connected_at DESC`).all();
    return json({ success: true, connections: result.results || [] });
  } catch (error) {
    return json({ success: false, error: error.message || "Could not load YouTube connections." }, 500);
  }
}
