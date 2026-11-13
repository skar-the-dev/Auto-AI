import { json, requireAdmin, ensureYoutubeTables, decryptSecret } from "../../_shared/youtube.js";

async function ensureUploadTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS youtube_uploads (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, channel_id TEXT,
    video_id TEXT, title TEXT NOT NULL, privacy_status TEXT NOT NULL,
    publish_at TEXT, status TEXT NOT NULL, error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, completed_at TEXT
  )`).run();
}

export async function onRequestPost({ request, env }) {
  let uploadId = null;
  try {
    if (!requireAdmin(request, env)) return json({ success: false, error: "Admin access key is missing or incorrect." }, 401);
    if (!env.DB) return json({ success: false, error: "Database binding DB is missing." }, 500);
    if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
      return json({ success: false, error: "YouTube OAuth secrets are not fully configured." }, 503);
    }
    const accountId = (request.headers.get("x-youtube-account-id") || "").trim();
    const title = (request.headers.get("x-youtube-title") || "").trim().slice(0, 100);
    const description = (request.headers.get("x-youtube-description") || "").slice(0, 5000);
    const rawTags = request.headers.get("x-youtube-tags") || "[]";
    const privacyStatus = (request.headers.get("x-youtube-privacy") || "private").toLowerCase();
    const publishAtRaw = request.headers.get("x-youtube-publish-at") || "";
    const categoryId = (request.headers.get("x-youtube-category-id") || "22").trim();
    const contentType = request.headers.get("content-type") || "video/mp4";
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (!accountId || !title) return json({ success: false, error: "YouTube account and video title are required." }, 400);
    if (!request.body) return json({ success: false, error: "The video file is missing." }, 400);
    if (!/^video\/(mp4|webm|quicktime)$/.test(contentType)) return json({ success: false, error: "Upload an MP4, WebM or QuickTime video file." }, 415);
    if (contentLength && contentLength > 100 * 1024 * 1024) return json({ success: false, error: "This upload is over the current 100 MB request limit. A direct-to-storage upload path is needed for larger videos." }, 413);
    if (!["private", "unlisted", "public"].includes(privacyStatus)) return json({ success: false, error: "Choose private, unlisted or public visibility." }, 400);
    let publishAt = null;
    if (publishAtRaw) {
      const parsed = new Date(publishAtRaw);
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) return json({ success: false, error: "Scheduled publish time must be a valid future date and time." }, 400);
      if (privacyStatus !== "private") return json({ success: false, error: "YouTube scheduled publishing requires the video to be uploaded as private." }, 400);
      publishAt = parsed.toISOString();
    }
    let tags;
    try { tags = JSON.parse(rawTags); } catch { tags = []; }
    if (!Array.isArray(tags)) tags = [];
    tags = tags.map(tag => String(tag).trim()).filter(Boolean).slice(0, 30);
    await ensureYoutubeTables(env.DB);
    await ensureUploadTable(env.DB);
    const connection = await env.DB.prepare("SELECT channel_id, refresh_token_encrypted FROM youtube_connections WHERE account_id = ?").bind(accountId).first();
    if (!connection) return json({ success: false, error: "This Auto AI account is not connected to YouTube." }, 404);
    const token = await decryptSecret(connection.refresh_token_encrypted, env);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.YOUTUBE_CLIENT_ID, client_secret: env.YOUTUBE_CLIENT_SECRET, refresh_token: token, grant_type: "refresh_token" })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error_description || tokenData.error || "Could not refresh YouTube authorisation.");
    uploadId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO youtube_uploads (id, account_id, channel_id, title, privacy_status, publish_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(uploadId, accountId, connection.channel_id || null, title, privacyStatus, publishAt, "Uploading").run();
    const metadata = { snippet: { title, description, categoryId, tags }, status: { privacyStatus } };
    if (publishAt) metadata.status.publishAt = publishAt;
    const initResponse = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: { Authorization: "Bearer " + tokenData.access_token, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": contentType, ...(contentLength ? { "X-Upload-Content-Length": String(contentLength) } : {}) },
      body: JSON.stringify(metadata)
    });
    if (!initResponse.ok) { const data = await initResponse.json().catch(() => ({})); throw new Error(data.error?.message || "YouTube could not start the video upload."); }
    const uploadUrl = initResponse.headers.get("Location");
    if (!uploadUrl) throw new Error("YouTube did not provide a resumable upload address.");
    const videoResponse = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType, ...(contentLength ? { "Content-Length": String(contentLength) } : {}) }, body: request.body });
    const videoData = await videoResponse.json().catch(() => ({}));
    if (!videoResponse.ok || !videoData.id) throw new Error(videoData.error?.message || `YouTube upload failed with status ${videoResponse.status}.`);
    await env.DB.prepare("UPDATE youtube_uploads SET video_id = ?, status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(videoData.id, publishAt ? "Scheduled" : "Uploaded", uploadId).run();
    return json({ success: true, upload_id: uploadId, video_id: videoData.id, title, privacy_status: privacyStatus, publish_at: publishAt, url: "https://www.youtube.com/watch?v=" + videoData.id, status: publishAt ? "Scheduled" : "Uploaded" }, 201);
  } catch (error) {
    if (uploadId && env.DB) {
      try { await env.DB.prepare("UPDATE youtube_uploads SET status = ?, error = ? WHERE id = ?").bind("Failed", String(error.message || "Upload failed").slice(0, 500), uploadId).run(); } catch {}
    }
    return json({ success: false, error: error.message || "YouTube upload failed.", upload_id: uploadId }, 500);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    if (!requireAdmin(request, env)) return json({ success: false, error: "Admin access key is missing or incorrect." }, 401);
    if (!env.DB) return json({ success: false, error: "Database binding DB is missing." }, 500);
    await ensureYoutubeTables(env.DB);
    await ensureUploadTable(env.DB);
    const accountId = new URL(request.url).searchParams.get("account_id");
    const result = accountId
      ? await env.DB.prepare("SELECT * FROM youtube_uploads WHERE account_id = ? ORDER BY created_at DESC LIMIT 50").bind(accountId).all()
      : await env.DB.prepare("SELECT * FROM youtube_uploads ORDER BY created_at DESC LIMIT 50").all();
    return json({ success: true, uploads: result.results || [] });
  } catch (error) { return json({ success: false, error: error.message || "Could not load YouTube upload history." }, 500); }
}