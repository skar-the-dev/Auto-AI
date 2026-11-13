import { json, requireAdmin, ensureYoutubeTables } from "../../_shared/youtube.js";

export async function onRequestPost({ request, env }) {
  try {
    if (!requireAdmin(request, env)) return json({ success: false, error: "Admin access key is missing or incorrect." }, 401);
    if (!env.DB) return json({ success: false, error: "Database binding DB is missing." }, 500);
    const body = await request.json();
    const accountId = String(body.account_id || "").trim();
    if (!accountId) return json({ success: false, error: "Account ID is required." }, 400);
    await ensureYoutubeTables(env.DB);
    await env.DB.prepare("DELETE FROM youtube_connections WHERE account_id = ?").bind(accountId).run();
    return json({ success: true, message: "YouTube channel disconnected from Auto AI." });
  } catch (error) {
    return json({ success: false, error: error.message || "Could not disconnect YouTube." }, 500);
  }
}
