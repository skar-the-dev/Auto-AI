import { json, ensureYoutubeTables, decryptSecret } from "../_shared/youtube.js";

function clean(value) {
  return String(value || "").replace(/[<>]/g, " ").replace(/\\s+/g, " ").trim().slice(0, 100);
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) return json({ success: false, error: "YouTube connection database is unavailable." }, 503);
    if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
      return json({ success: false, error: "The existing YouTube OAuth credentials are not fully configured." }, 503);
    }

    const url = new URL(request.url);
    const query = clean(url.searchParams.get("q"));
    if (query.length < 2) return json({ success: false, error: "Add a person, team, game or event to search." }, 400);

    await ensureYoutubeTables(env.DB);
    const connection = await env.DB.prepare(
      "SELECT account_id, refresh_token_encrypted FROM youtube_connections ORDER BY connected_at DESC LIMIT 1"
    ).first();

    if (!connection) {
      return json({ success: false, error: "Connect a YouTube channel in YouTube Setup before searching for footage." }, 409);
    }

    const refreshToken = await decryptSecret(connection.refresh_token_encrypted, env);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.YOUTUBE_CLIENT_ID,
        client_secret: env.YOUTUBE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      })
    });
    const tokens = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokens.access_token) {
      const detail = tokens.error_description || tokens.error || "Google could not refresh the saved YouTube connection.";
      return json({ success: false, error: detail }, 502);
    }

    const apiUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    apiUrl.search = new URLSearchParams({
      part: "snippet",
      type: "video",
      q: query,
      maxResults: "5",
      safeSearch: "strict",
      videoEmbeddable: "true",
      videoSyndicated: "true",
      videoLicense: "creativeCommon",
      order: "relevance"
    }).toString();

    const response = await fetch(apiUrl.toString(), {
      headers: { Authorization: "Bearer " + tokens.access_token }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error && data.error.message ? data.error.message : "YouTube search failed.";
      return json({ success: false, error: message }, response.status === 403 ? 502 : response.status);
    }

    const videos = (data.items || []).map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      channel: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      thumbnail: item.snippet.thumbnails && (item.snippet.thumbnails.high || item.snippet.thumbnails.medium || item.snippet.thumbnails.default)
        ? (item.snippet.thumbnails.high || item.snippet.thumbnails.medium || item.snippet.thumbnails.default).url
        : "",
      watchUrl: "https://www.youtube.com/watch?v=" + encodeURIComponent(item.id.videoId),
      embedUrl: "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(item.id.videoId)
    }));
    return json({ success: true, query, licenseFilter: "creativeCommon", videos });
  } catch (error) {
    return json({ success: false, error: error.message || "Could not search YouTube footage." }, 500);
  }
}
