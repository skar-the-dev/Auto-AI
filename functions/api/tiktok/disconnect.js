import { json, requireAdmin, ensureTikTokTables, decryptSecret } from "../../_shared/tiktok.js";

export async function onRequestPost({ request, env }) {
  try {
    if (!requireAdmin(request, env)) return json({ success: false, error: "Admin access key is missing or incorrect." }, 401);
    if (!env.DB) return json({ success: false, error: "Database binding DB is missing." }, 500);
    const body = await request.json();
    const accountId = String(body.account_id || "").trim();
    if (!accountId) return json({ success: false, error: "Account ID is required." }, 400);
    await ensureTikTokTables(env.DB);
    const row = await env.DB.prepare("SELECT access_token_encrypted FROM tiktok_connections WHERE account_id = ?").bind(accountId).first();
    if (row && env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET) {
      try {
        const token = await decryptSecret(row.access_token_encrypted, env);
        await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, token })
        });
      } catch {}
    }
    await env.DB.prepare("DELETE FROM tiktok_connections WHERE account_id = ?").bind(accountId).run();
    return json({ success: true, message: "TikTok account disconnected from Auto AI." });
  } catch (error) {
    return json({ success: false, error: error.message || "Could not disconnect TikTok." }, 500);
  }
}
