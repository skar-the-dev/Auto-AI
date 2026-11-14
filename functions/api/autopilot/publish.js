import { json, requireAdmin, decryptSecret, ensureYoutubeTables } from "../../_shared/youtube.js";

function toBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("The AI voice service returned an unsupported audio format.");
}

async function streamBytes(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total > 10 * 1024 * 1024) throw new Error("Generated voiceover is larger than 10 MB.");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function base64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!requireAdmin(request, env)) return json({ success: false, error: "Enter your Auto AI admin access key before starting Autopilot." }, 401);
    if (!env.DB || !env.AI) return json({ success: false, error: "Auto AI database or Workers AI binding is missing." }, 503);
    if (!env.VIDEO_RENDERER_URL || !env.VIDEO_RENDERER_KEY) return json({ success: false, error: "The cloud video renderer is not configured yet." }, 503);
    if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) return json({ success: false, error: "YouTube publishing credentials are not fully configured." }, 503);

    const body = await request.json();
    const accountId = String(body.account_id || "").trim();
    const scriptId = String(body.script_id || "").trim();
    const publishAt = body.publish_at ? new Date(body.publish_at) : null;
    if (!accountId || !scriptId) return json({ success: false, error: "Account and script are required." }, 400);
    if (body.publish_at && (!publishAt || Number.isNaN(publishAt.getTime()) || publishAt.getTime() <= Date.now())) {
      return json({ success: false, error: "The scheduled publishing time must be in the future." }, 400);
    }

    const account = await env.DB.prepare("SELECT id, name, niche, active FROM accounts WHERE id = ?").bind(accountId).first();
    if (!account || !account.active) return json({ success: false, error: "The selected account is not active." }, 404);
    await ensureYoutubeTables(env.DB);
    const connection = await env.DB.prepare("SELECT channel_id, refresh_token_encrypted FROM youtube_connections WHERE account_id = ?").bind(accountId).first();
    if (!connection) return json({ success: false, error: "Connect YouTube to this Auto AI account before starting Series Autopilot." }, 409);

    const row = await env.DB.prepare("SELECT id, title, niche, topic, content_json FROM scripts WHERE id = ?").bind(scriptId).first();
    if (!row) return json({ success: false, error: "The generated script could not be found." }, 404);
    const script = JSON.parse(row.content_json);
    if (!script.voiceover || !Array.isArray(script.scenes) || !script.scenes.length) {
      return json({ success: false, error: "This script is missing its narration or scene plan." }, 422);
    }
    if (script.fact_check_status !== "source_supported_draft") {
      return json({ success: false, error: "Auto-publish paused for this video because its factual claims were not fully matched to the available sources. It remains saved in Video Library for research." }, 422);
    }
    const checks = Array.isArray(script.claim_checks) ? script.claim_checks : [];
    if (!checks.length || checks.some(check => check.supported !== true || !Array.isArray(check.source_numbers) || !check.source_numbers.length)) {
      return json({ success: false, error: "Auto-publish paused because one or more factual claims do not have a supporting source reference." }, 422);
    }

    const audioResult = await env.AI.run("@cf/deepgram/aura-2-en", {
      text: String(script.voiceover).slice(0, 4000), speaker: "luna", encoding: "mp3"
    });
    let audioBytes;
    if (audioResult instanceof ReadableStream) audioBytes = await streamBytes(audioResult);
    else if (audioResult?.audio instanceof ReadableStream) audioBytes = await streamBytes(audioResult.audio);
    else if (audioResult instanceof ArrayBuffer || ArrayBuffer.isView(audioResult)) audioBytes = toBytes(audioResult);
    else throw new Error("AI voiceover generation returned an unsupported format.");
    if (!audioBytes.length || audioBytes.length > 10 * 1024 * 1024) throw new Error("Generated voiceover is empty or too large.");

    const renderUrl = new URL("/api/render", request.url);
    const renderResponse = await fetch(renderUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-auto-ai-admin-key": request.headers.get("x-auto-ai-admin-key") || "" },
      body: JSON.stringify({
        title: row.title,
        scenes: script.scenes.slice(0, 5).map(scene => [scene.visual, scene.text].filter(Boolean).join(" — ").slice(0, 260)),
        audio_base64: base64(audioBytes)
      })
    });
    if (!renderResponse.ok) {
      const raw = await renderResponse.text();
      let message = raw;
      try { message = JSON.parse(raw).error || raw; } catch {}
      throw new Error("Video rendering failed: " + message.slice(0, 700));
    }
    const videoBytes = await renderResponse.arrayBuffer();
    if (!videoBytes.byteLength || videoBytes.byteLength > 100 * 1024 * 1024) throw new Error("Rendered video is empty or exceeds the current 100 MB YouTube upload limit.");

    const token = await decryptSecret(connection.refresh_token_encrypted, env);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.YOUTUBE_CLIENT_ID, client_secret: env.YOUTUBE_CLIENT_SECRET,
        refresh_token: token, grant_type: "refresh_token"
      })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error_description || tokenData.error || "Could not refresh YouTube authorisation.");

    const privacy = publishAt ? "private" : "public";
    const metadata = {
      snippet: {
        title: String(row.title).slice(0, 100),
        description: [script.caption || "", "Sources:", ...(script.sources || []).map(source => source.url).filter(Boolean)].join("\n").slice(0, 5000),
        categoryId: "22",
        tags: [row.niche, "shorts", "AutoAI"].map(value => String(value).replace(/[^a-z0-9 ]/gi, "").slice(0, 30))
      },
      status: { privacyStatus: privacy }
    };
    if (publishAt) metadata.status.publishAt = publishAt.toISOString();
    const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + tokenData.access_token,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(videoBytes.byteLength)
      },
      body: JSON.stringify(metadata)
    });
    if (!init.ok) {
      const data = await init.json().catch(() => ({}));
      throw new Error(data.error?.message || "YouTube could not start the upload.");
    }
    const uploadUrl = init.headers.get("Location");
    if (!uploadUrl) throw new Error("YouTube did not return an upload address.");
    const uploaded = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Content-Length": String(videoBytes.byteLength) },
      body: videoBytes
    });
    const uploadedData = await uploaded.json().catch(() => ({}));
    if (!uploaded.ok || !uploadedData.id) throw new Error(uploadedData.error?.message || "YouTube video upload failed.");

    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS youtube_uploads (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, channel_id TEXT,
        video_id TEXT, title TEXT NOT NULL, privacy_status TEXT NOT NULL,
        publish_at TEXT, status TEXT NOT NULL, error TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, completed_at TEXT
      )
    `).run();
    const uploadId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO youtube_uploads (id, account_id, channel_id, video_id, title, privacy_status, publish_at, status, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)")
      .bind(uploadId, accountId, connection.channel_id || null, uploadedData.id, row.title, privacy, publishAt ? publishAt.toISOString() : null, publishAt ? "Scheduled" : "Uploaded").run();

    return json({
      success: true, account: account.name, script_id: scriptId, title: row.title,
      video_id: uploadedData.id, url: "https://www.youtube.com/watch?v=" + uploadedData.id,
      status: publishAt ? "Scheduled" : "Published",
      publish_at: publishAt ? publishAt.toISOString() : null
    }, 201);
  } catch (error) {
    return json({ success: false, error: error.message || "Series Autopilot could not complete this video." }, 500);
  }
}
