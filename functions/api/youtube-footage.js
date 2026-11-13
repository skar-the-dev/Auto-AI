function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function clean(value) {
  return String(value || "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.YOUTUBE_API_KEY) {
      return json({
        success: false,
        error: "Real gaming footage search needs a YouTube Data API key. Add YOUTUBE_API_KEY as a Cloudflare Pages secret."
      }, 503);
    }
    const url = new URL(request.url);
    const query = clean(url.searchParams.get("q"));
    if (query.length < 2) return json({ success: false, error: "Add a person, team, game or event to search." }, 400);

    const apiUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    apiUrl.search = new URLSearchParams({
      key: env.YOUTUBE_API_KEY,
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

    const response = await fetch(apiUrl.toString());
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
