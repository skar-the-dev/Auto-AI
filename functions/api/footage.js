function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers }
  });
}

function safeQuery(value) {
  return String(value || "")
    .replace(/[^a-z0-9\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.PIXABAY_API_KEY) {
      return json({
        success: false,
        error: "Stock footage is not configured yet. Add PIXABAY_API_KEY as a Cloudflare Pages secret, then retry."
      }, 503);
    }

    const url = new URL(request.url);
    const query = safeQuery(url.searchParams.get("q"));
    if (query.length < 2) return json({ success: false, error: "Enter a scene topic to search for footage." }, 400);

    const cacheUrl = new URL("/__pixabay-video-cache", url.origin);
    cacheUrl.searchParams.set("q", query.toLowerCase());
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) {
      const data = await cached.json();
      return json(data, 200, { "X-Stock-Cache": "HIT" });
    }

    const apiUrl = new URL("https://pixabay.com/api/videos/");
    apiUrl.search = new URLSearchParams({
      key: env.PIXABAY_API_KEY,
      q: query,
      safesearch: "true",
      order: "popular",
      per_page: "6"
    }).toString();

    const response = await fetch(apiUrl.toString(), {
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      return json({
        success: false,
        error: response.status === 429
          ? "Pixabay's search limit has been reached. Please wait before searching again."
          : "Pixabay footage search failed (" + response.status + "). " + detail
      }, response.status === 429 ? 429 : 502);
    }

    const result = await response.json();
    const videos = (result.hits || []).map(video => {
      const files = video.videos || {};
      const file = files.medium && files.medium.url ? files.medium
        : files.small && files.small.url ? files.small
        : files.tiny && files.tiny.url ? files.tiny
        : null;
      return file ? {
        id: video.id,
        title: String(video.tags || query).slice(0, 120),
        video_url: file.url,
        width: file.width,
        height: file.height,
        duration: video.duration,
        thumbnail: file.thumbnail || "",
        source_url: video.pageURL,
        creator: video.user || "Pixabay contributor"
      } : null;
    }).filter(Boolean);

    const data = { success: true, query, videos };
    const cacheResponse = new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" }
    });
    await cache.put(cacheKey, cacheResponse);
    return json(data, 200, { "X-Stock-Cache": "MISS" });
  } catch (error) {
    return json({ success: false, error: error.message || "Could not search stock footage." }, 500);
  }
}
