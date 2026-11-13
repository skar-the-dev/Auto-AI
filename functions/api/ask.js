function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

function decodeUrl(value) {
  try {
    const url = new URL(value, "https://duckduckgo.com");
    const redirect = url.searchParams.get("uddg");
    return redirect ? decodeURIComponent(redirect) : url.toString();
  } catch { return ""; }
}

async function searchDuckDuckGo(query) {
  const urls = [
    "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query),
    "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query)
  ];
  for (const endpoint of urls) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AutoAIResearch/1.0)",
          "Accept": "text/html,application/xhtml+xml"
        },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) continue;
      const html = await response.text();
      const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
      const results = [];
      for (const anchor of anchors) {
        if (!/class=["'][^"']*result__a/i.test(anchor)) continue;
        const href = anchor.match(/href=["']([^"']+)["']/i)?.[1];
        const url = decodeUrl(href || "");
        if (!/^https?:\/\//i.test(url)) continue;
        const host = new URL(url).hostname;
        if (/duckduckgo\.com|google\.com|bing\.com/i.test(host)) continue;
        const title = stripHtml(anchor).slice(0, 220);
        const after = html.slice(html.indexOf(anchor) + anchor.length, html.indexOf(anchor) + anchor.length + 1800);
        const snippetMatch = after.match(/class=["'][^"']*(?:result__snippet|result-snippet|snippet)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
        const snippet = stripHtml(snippetMatch?.[1] || "").slice(0, 700);
        if (title && !results.some(item => item.url === url)) {
          results.push({ title, url, snippet: snippet || "Search result found; open the source to verify its contents." });
        }
        if (results.length >= 7) break;
      }
      if (results.length) return results;
    } catch {}
  }
  return [];
}
 
async function searchBingRss(query) {
  try {
    const endpoint = "https://www.bing.com/search?format=rss&q=" + encodeURIComponent(query);
    const response = await fetch(endpoint, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoAIResearch/1.0)", "Accept": "application/rss+xml,application/xml,text/xml" },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return [];
    const xml = await response.text();
    const items = xml.split("<item>").slice(1).map(part => "<item>" + part.split("</item>")[0] + "</item>");
    return items.slice(0, 8).map(item => {
      const get = tag => stripHtml(item.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i"))?.[1] || "");
      const title = get("title");
      const link = get("link");
      const snippet = get("description");
      let validUrl = false;
      try { validUrl = ["http:", "https:"].includes(new URL(link).protocol); } catch {}
      return { title, url: link, snippet: snippet.slice(0, 1000), query };
    }).filter(item => item.title && item.url && item.url.startsWith("http"));
  } catch { return []; }
}

async function searchWikipedia(query) {
  const endpoint = new URL("https://en.wikipedia.org/w/api.php");
  endpoint.search = new URLSearchParams({
    action: "query", list: "search", srsearch: query,
    srlimit: "5", format: "json", origin: "*"
  }).toString();
  const response = await fetch(endpoint, {
    headers: { "User-Agent": "AutoAIResearch/1.0 (https://auto-ai-c8y.pages.dev)" },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) return [];
  const data = await response.json();
  const hits = data?.query?.search || [];
  return hits.slice(0, 5).map(hit => ({
    title: stripHtml(hit.title),
    url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(hit.title.replace(/ /g, "_")),
    snippet: stripHtml(hit.snippet).slice(0, 700)
  })).filter(item => item.title && item.snippet);
}

function buildSearchQueries(question) {
  const queries = [question];
  const achievementIntent = /greatest|achievement|career|milestone|accomplish|top\s*\d+/i.test(question);
  if (/nick\s*mercs|nickmercs/i.test(question) && achievementIntent) {
    queries.push(
      '"NICKMERCS" career achievements tournament results',
      '"NICKMERCS" Fortnite tournament placements Liquipedia',
      '"NICKMERCS" Warzone tournament results wins',
      '"NICKMERCS" Gears of War championship'
    );
  }
  return [...new Set(queries)].slice(0, 5);
}

async function fetchResearchPage(url, query) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoAIResearch/1.0)", "Accept": "text/html" },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return null;
    const html = await response.text();
    const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url);
    const description = stripHtml(html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i)?.[1] || "");
    const body = stripHtml(html.replace(/<nav[\s\S]*?<\/nav>/gi, " ").replace(/<footer[\s\S]*?<\/footer>/gi, " "));
    if (!body || !/nick\s*mercs|nickmercs/i.test(title + " " + description + " " + body.slice(0, 16000))) return null;
    return { title, url, snippet: (description + " " + body).slice(0, 6500), query, full_text: true };
  } catch { return null; }
}

async function searchWeb(query) {
  const queries = buildSearchQueries(query);
  const batches = await Promise.all(queries.map(async searchQuery => {
    const [webResults, bingResults, wikiResults] = await Promise.all([
      searchDuckDuckGo(searchQuery).catch(() => []),
      searchBingRss(searchQuery).catch(() => []),
      searchWikipedia(searchQuery).catch(() => [])
    ]);
    return [...webResults, ...bingResults, ...wikiResults].map(item => ({ ...item, query: searchQuery }));
  }));
  const combined = batches.flat();
  if (query.toLowerCase().includes("nickmercs") || query.toLowerCase().includes("nick mercs")) {
    const urls = [
      "https://liquipedia.net/fortnite/NICKMERCS",
      "https://liquipedia.net/fortnite/NICKMERCS/Results",
      "https://liquipedia.net/callofduty/NICKMERCS",
      "https://liquipedia.net/apexlegends/NICKMERCS"
    ];
    const direct = await Promise.all(urls.map(url => fetchResearchPage(url, "NICKMERCS career tournament achievements")));
    combined.push(...direct.filter(Boolean));
  }
  const subject = query.toLowerCase().includes("nickmercs") || query.toLowerCase().includes("nick mercs") ? "nickmercs" : null;
  const seen = new Set();
  const relevant = combined.filter(item => {
    const title = String(item.title || "");
    const snippet = String(item.snippet || "");
    if (subject && !(title + " " + snippet).toLowerCase().replaceAll(" ", "").includes("nickmercs")) return false;
    const rawKey = String(item.url || "").split("#")[0];
    const key = rawKey.endsWith("/") ? rawKey.slice(0, -1) : rawKey;
    if (!(key.startsWith("https://") || key.startsWith("http://")) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const score = item => {
    const text = (item.title + " " + item.snippet + " " + item.url).toLowerCase();
    let points = 0;
    if (/liquipedia|esports earnings|escharts|twitchtracker|tracker network|dot esports|dexerto/.test(text)) points += 5;
    if (/tournament|championship|placement|winner|won|results|prize|earnings|record/.test(text)) points += 4;
    if (/nickmercs|nick mercs/.test(text)) points += 4;
    if (/hosted|organised|organized|presented/.test(text)) points -= 2;
    if (text.includes("modern warfare ii") || text.includes("video game)")) points -= 3;
    if (/wikipedia/.test(item.url)) points -= 1;
    return points;
  };
  return relevant.sort((a, b) => score(b) - score(a)).slice(0, 12);
}

function parseAnswer(result) {
  const candidate = result?.choices?.[0]?.message?.content ||
    result?.result?.choices?.[0]?.message?.content ||
    result?.response || result?.result?.response || result?.output_text;
  if (typeof candidate === "string") {
    const start = candidate.indexOf("{"), end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(candidate.slice(start, end + 1)); } catch {}
    }
  }
  if (candidate && typeof candidate === "object") return candidate;
  throw new Error("Auto AI could not format the research answer. Please try again.");
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.AI || typeof env.AI.run !== "function") {
      return json({ success: false, error: "The AI binding is not available. Check the Cloudflare AI binding." }, 500);
    }
    const body = await request.json();
    const question = String(body.question || "").trim().slice(0, 500);
    if (question.length < 4) return json({ success: false, error: "Enter a question with a little more detail." }, 400);

    let sources = [];
    let searchWarning = "";
    try { sources = await searchWeb(question); }
    catch (error) { searchWarning = error.message || "Web search failed."; }

    if (!sources.length) {
      return json({
        success: false,
        error: searchWarning || "No usable web results were found. Try adding a person's full name, game, date or subject."
      }, 502);
    }

    const evidence = sources.map((source, index) =>
      "[" + (index + 1) + "] " + source.title + "\nURL: " + source.url + "\nSearch query: " + (source.query || question) + "\nSearch extract: " + source.snippet
    ).join("\n\n");

    const prompt = `Answer the user's question using ONLY the research extracts supplied below.
QUESTION: ${question}

RESEARCH EXTRACTS:
${evidence}

RULES:
- Answer the exact question. Do not substitute general background for a requested list, ranking, person, event or achievement.
- Cite factual sentences using [1], [2] etc. The number must match a supplied source.
- Distinguish verified facts, estimates, opinions and disputed claims.
- For "best", "greatest" or "top" questions, state the criteria and date/period. Do not pretend a subjective ranking is an official ranking.
- For current rankings or news, state the date of the evidence. If extracts do not establish current status, say so.
- Never invent names, dates, scores, prizes, quotes or achievements.
- Distinguish events the person HOSTED or ORGANIZED from events they PERSONALLY WON or placed in. Hosting a tournament is not a tournament victory.
- Distinguish participation, team results, individual results, awards, career milestones and popularity metrics; do not present one category as another.
- A source title or URL that names a different person is not evidence about the subject, even if its snippet happens to mention them.
- Every source must directly identify the person named in the question. Exclude unrelated people, games, generic award pages and search results that merely mention the topic in passing.\n- For a requested top 10, provide ten only if ten distinct, evidenced personal achievements exist; otherwise provide a shorter list and explain the evidence gap.\n- Search extracts are limited evidence, not full source verification. Explain when important details need checking.
- If the sources do not contain enough evidence to answer, say exactly what is missing instead of guessing.
- Return JSON only: {"answer":"clear answer in markdown with citations","confidence":"high|medium|low","coverage_note":"short honest limitation or why evidence is sufficient","key_points":["..."]}.`;
    const result = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
      messages: [
        { role: "system", content: "You are Auto AI Research. Be precise, sceptical and source-led. Answer the exact question, never fabricate evidence, and cite every factual claim." },
        { role: "user", content: prompt }
      ],
      max_completion_tokens: 2600,
      temperature: 0.1,
      response_format: { type: "json_object" },
      chat_template_kwargs: { enable_thinking: false }
    });
    const answer = parseAnswer(result);
    if (!answer.answer || typeof answer.answer !== "string") {
      throw new Error("The research model returned an incomplete answer.");
    }
    const confidence = ["high", "medium", "low"].includes(answer.confidence) ? answer.confidence : "low";
    return json({
      success: true,
      question,
      answer: answer.answer.slice(0, 12000),
      confidence,
      coverage_note: String(answer.coverage_note || "Search extracts are not a full verification of every source.").slice(0, 1200),
      key_points: Array.isArray(answer.key_points) ? answer.key_points.slice(0, 8).map(item => String(item).slice(0, 400)) : [],
      sources: sources.map((source, index) => ({ number: index + 1, title: source.title, url: source.url, extract: source.snippet, search_query: source.query || question })),
      researched_at: new Date().toISOString(),
      research_method: "Live web search extracts + Cloudflare Workers AI synthesis",
      limitations: "Auto AI has read search-result extracts, not necessarily every full article. Check primary sources for important decisions."
    });
  } catch (error) {
    return json({ success: false, error: error.message || "Research failed. Please try again." }, 500);
  }
}
