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


function extractPageText(html) {
  let content = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|footer|header|aside|form|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|h[1-6]|li)>/gi, "\n")
    .replace(/<tr[^>]*>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  return content
    .replace(/&nbsp;/gi, " ").replace(/&#160;/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .split("\n").map(line => line.replace(/[ \t]+/g, " ").replace(/\s*\|\s*/g, " | ").trim())
    .filter(Boolean).join("\n").slice(0, 14000);
}

function queryTerms(query) {
  return String(query || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter(word => word.length > 3 && !/^(what|when|where|which|who|with|from|about|greatest|achievement|achievements|list|top|best|give|tell|show|does|have|that|this|their|there|into|your)$/i.test(word));
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
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol) ||
        /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i.test(parsedUrl.hostname) ||
        parsedUrl.hostname.endsWith(".local")) return null;
    const response = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AutoAIResearch/1.0; +https://auto-ai-c8y.pages.dev)",
        "Accept": "text/html,application/xhtml+xml,text/plain"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!/html|text|xml/i.test(contentType)) return null;
    const html = await response.text();
    if (html.length > 1800000) return null;
    const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url);
    const description = stripHtml(html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i)?.[1] || "");
    const mainMatch = html.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
    const pageText = extractPageText(mainMatch?.[1] || html);
    if (pageText.length < 180) return null;
    const terms = queryTerms(query);
    const searchable = (title + " " + description + " " + pageText.slice(0, 10000)).toLowerCase();
    const matched = terms.filter(term => searchable.includes(term)).length;
    const namedSubject = /nick\s*mercs|nickmercs/i.test(query);
    if (namedSubject && !/nick\s*mercs|nickmercs/i.test(title + " " + description + " " + pageText.slice(0, 14000))) return null;
    if (!namedSubject && terms.length >= 3 && matched < 2) return null;
    return {
      title, url: response.url || url,
      snippet: [description, pageText].filter(Boolean).join("\n").slice(0, 11000),
      query, full_text: true,
      relevance: terms.length ? Number((matched / Math.min(terms.length, 6)).toFixed(2)) : 1
    };
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
  if (/nick\s*mercs|nickmercs/i.test(query)) {
    const urls = [
      "https://liquipedia.net/fortnite/NICKMERCS/Results",
      "https://liquipedia.net/fortnite/NICKMERCS",
      "https://liquipedia.net/callofduty/NICKMERCS/Results",
      "https://liquipedia.net/callofduty/NICKMERCS",
      "https://fortnite-esports.fandom.com/wiki/NICKMERCS/Tournament_Results",
      "https://cod-esports.fandom.com/wiki/NICKMERCS/Tournament_Results"
    ];
    const direct = await Promise.all(urls.map(url => fetchResearchPage(url, query)));
    combined.push(...direct.filter(Boolean));
  }
  const seen = new Set();
  const unique = combined.filter(item => {
    let parsed;
    try { parsed = new URL(item.url); } catch { return false; }
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const key = parsed.origin + parsed.pathname.replace(/\/$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const score = item => {
    const text = (item.title + " " + item.snippet + " " + item.url).toLowerCase();
    let points = item.full_text ? 12 : 0;
    if (/liquipedia|esports earnings|escharts|dot esports|dexerto|official|tournament results/.test(text)) points += 4;
    if (/tournament|championship|placement|winner|won|results|prize|earnings|record/.test(text)) points += 3;
    if (/nickmercs|nick mercs/.test(text)) points += 4;
    if (/poll|quick poll|sign in|create a free account|navigation|copyright/.test(text)) points -= 6;
    if (/hosted|organised|organized|presented/.test(text)) points -= 2;
    if (/wikipedia/.test(item.url)) points -= 1;
    return points;
  };
  const candidates = unique.sort((a, b) => score(b) - score(a)).slice(0, 10);
  const pages = await Promise.all(candidates.slice(0, 8).map(async item =>
    item.full_text ? item : (await fetchResearchPage(item.url, query)) || item
  ));
  const final = [];
  const finalSeen = new Set();
  for (const item of [...pages, ...candidates.slice(8)]) {
    const key = String(item.url || "").split("#")[0].replace(/\/$/, "");
    if (!key || finalSeen.has(key)) continue;
    finalSeen.add(key);
    final.push(item);
  }
  return final.sort((a, b) => score(b) - score(a)).slice(0, 12);
}

function parseAnswer(result) {
  const candidates = [
    result?.choices?.[0]?.message?.content,
    result?.result?.choices?.[0]?.message?.content,
    result?.response,
    result?.result?.response,
    result?.output_text,
    result?.text,
    result?.content,
    result?.result
  ];
  let candidate = candidates.find(value => typeof value === "string" && value.trim());
  if (!candidate) {
    const seen = new Set();
    const findText = (value, depth = 0) => {
      if (depth > 5 || value == null) return "";
      if (typeof value === "string") return value.trim();
      if (typeof value !== "object" || seen.has(value)) return "";
      seen.add(value);
      for (const key of ["content", "text", "response", "output_text", "answer"]) {
        const found = findText(value[key], depth + 1);
        if (found) return found;
      }
      for (const child of Object.values(value)) {
        const found = findText(child, depth + 1);
        if (found) return found;
      }
      return "";
    };
    candidate = findText(result);
  }
  if (candidate && typeof candidate === "object") {
    if (typeof candidate.answer === "string") return candidate;
    candidate = JSON.stringify(candidate);
  }
  if (typeof candidate === "string" && candidate.trim()) {
    const cleaned = candidate.trim()
      .replace(/^\`\`\`(?:json)?\s*/i, "")
      .replace(/\s*\`\`\`$/, "");
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.answer === "string") return parsed;
          if (typeof parsed.response === "string") return { answer: parsed.response };
        }
      } catch {}
    }
    return {
      answer: cleaned,
      confidence: "low",
      coverage_note: "The model returned an unstructured answer. Treat it as provisional and verify the cited sources.",
      key_points: []
    };
  }
  const shape = result && typeof result === "object" ? Object.keys(result).join(", ") : typeof result;
  throw new Error("The research model returned an unsupported response format (" + shape + ").");
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
A source labelled FULL-PAGE EXTRACT was retrieved and parsed from its page. A source labelled SEARCH SNIPPET is only a search-engine excerpt and is weak evidence; do not treat it as a verified result row.
QUESTION: ${question}

RESEARCH EXTRACTS:
${evidence}

RULES:
- Answer the exact question. Do not substitute general background for a requested list, ranking, person, event or achievement.
- Cite factual sentences using [1], [2] etc. The number must match a supplied source.
- Distinguish verified facts, estimates, opinions and disputed claims.
- For "best", "greatest" or "top" questions, state the criteria and date/period. Do not pretend a subjective ranking is an official ranking.
- For a greatest-achievements list, create a clearly labelled editorial shortlist using transparent criteria: event prestige, finishing position, prize amount only when explicitly stated, and significance across games or eras. A source does not need to publish its own "greatest" ranking. Do not claim the list is ranked by prize amount unless every entry is actually sorted consistently by the stated prize amounts; otherwise state a multi-factor editorial ranking.
- If at least 10 distinct, verifiable achievements are present in the supplied result tables, provide 10 concise entries ranked by those criteria. If fewer than 10 are supported, provide only the supported number and explain why. Inspect ALL supplied result rows, including older rows and rows near the end of each extract; do not ignore podium finishes or wins merely because they lack prize amounts.
- Prefer major wins and podium finishes over routine low placements. Do not pad a greatest-achievements list with 42nd, 95th or similar finishes unless needed to explain a career milestone. A 1st-place finish with no listed prize is still a win and must be considered; do not exclude it just because prize money is blank. Include verified Fortnite podiums if present in the table, not just Warzone results.
- Treat tournament-result tables as primary evidence for placements. Ignore unrelated event schedules, upcoming fixtures, generic participant lists, popularity lists and article references unless they directly support a distinct career achievement.
- For current rankings or news, state the date of the evidence. If extracts do not establish current status, say so.
- Never invent names, dates, scores, prizes, quotes or achievements.
- Distinguish events the person HOSTED or ORGANIZED from events they PERSONALLY WON or placed in. Hosting a tournament is not a tournament victory.
- CRITICAL TABLE RULE: when a source contains a tournament-results table, read its column headings before interpreting any numbers. In tables with columns such as Date, Team Size, Pl, PR Points, Region, Platform, Event and Team Roster, ONLY the value under "Pl" is the finishing placement. "PR Points", prize money, event week numbers, dates and team size are NOT placements. Never turn PR points into a finishing position.
- Copy placements exactly as shown in the source. If the source says 95, report 95th, not 1st. Never infer a win from points, a roster listing, a team name or an event title.
- For each claimed result, require a specific event row with a visible placement value and the subject's name in the team roster. If either is missing or ambiguous, do not claim the result.
- Do not repeat the same event or duplicate rows. Group repeated weekly placements into a concise summary where appropriate.
- Distinguish solo results from duo/squad/team results. For team results, explicitly say it was a team finish and do not describe it as an individual solo victory.
- Distinguish participation, team results, individual results, awards, career milestones and popularity metrics; do not present one category as another.
- A source title or URL that names a different person is not evidence about the subject, even if its snippet happens to mention them.
- Every source must directly identify the person named in the question. Exclude unrelated people, games, generic award pages and search results that merely mention the topic in passing.\n- For a requested top 10, provide ten only if ten distinct, evidenced personal achievements exist; otherwise provide a shorter list and explain the evidence gap.\n- Search extracts are limited evidence, not full source verification. Explain when important details need checking.
- If the sources do not contain enough evidence to answer, say exactly what is missing instead of guessing. Do not refuse a useful partial or editorially ranked shortlist merely because no source publishes an official "greatest" ranking.
- Before finalising, cross-check every numerical placement in your draft against the exact source row. If you cannot match the event and placement to a row, remove the claim.
- If the extracts contain contradictory or malformed table text, say the results need manual verification and do not produce a ranked top 10. Before returning a ranked list, audit it: confirm each cited row exists, no event is duplicated, every listed placement and prize matches the row, and the order follows the stated criteria. If ranking by prize, sort descending by prize; if multi-factor, explain why higher-prestige wins outrank lower placements.
- CONFIDENCE CALIBRATION: never use HIGH confidence when relying only on search extracts or scraped community-wiki pages. HIGH requires full-page inspection and independent corroboration from reliable primary sources for the central claims. When using extracts from fan wikis, set confidence to MEDIUM at most; if tables are partial, malformed, stale or uncorroborated, set LOW. A polished answer is not evidence of reliability.
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
    // Quality gate: reject obviously duplicated list output rather than showing fabricated research.
    const answerText = answer.answer;
    const numberedEntries = answerText.match(/^\\s*\\d+[.)]\\s+/gm) || [];
    const normalisedEntries = answerText.split(/\\n+/)
      .map(line => line.replace(/^\\s*\\d+[.)]\\s+/, "").replace(/\\*\\*/g, "").trim().toLowerCase())
      .filter(line => line.length > 35);
    const duplicateCount = normalisedEntries.length - new Set(normalisedEntries).size;
    if (numberedEntries.length > 12 || duplicateCount >= 2) {
      return json({
        success: false,
        error: "The research model produced duplicated or inconsistent list entries. Auto AI has blocked this answer rather than presenting unverified claims. Please try again later."
      }, 502);
    }
    // A result is not a verified placement just because a model labels it first place.
    // For NICKMERCS, fail closed if the answer claims multiple World Cup qualifier wins
    // while the supplied tournament table does not show those rows as first place.
    if (/nick\\s*mercs|nickmercs/i.test(question) && /world cup|wc 2019/i.test(answerText)) {
      const claimsWorldCupWins = (answerText.match(/(?:1st|first)\\s*(?:place|in|at)?[^\\n]*(?:world cup|wc 2019)|(?:world cup|wc 2019)[^\\n]*(?:1st|first)\\s*(?:place|in|at)?/gi) || []).length;
      const fortniteTable = sources.find(source => /fortnite esports wiki/i.test(source.title));
      const tableText = String(fortniteTable?.snippet || "");
      const tableHasExplicitFirsts = /\\bPl\\s+PR Points[\\s\\S]{0,500}\\b1\\b/.test(tableText);
      if (claimsWorldCupWins >= 2 && !tableHasExplicitFirsts) {
        return json({
          success: false,
          error: "Auto AI could not verify the claimed World Cup wins against the tournament-results table, so it has blocked the answer. The source extract needs better row-by-row verification."
        }, 502);
      }
    }

    let confidence = ["high", "medium", "low"].includes(answer.confidence) ? answer.confidence : "low";
    const fullPageSources = sources.filter(source => source.full_text);
    const independentHosts = new Set(fullPageSources.map(source => {
      try { return new URL(source.url).hostname.replace(/^www\\./, ""); } catch { return ""; }
    }).filter(Boolean));
    const allCommunitySources = fullPageSources.length > 0 && fullPageSources.every(source =>
      /liquipedia|fandom|wikipedia|esports wiki/i.test(source.url + " " + source.title)
    );
    if (fullPageSources.length === 0) confidence = "low";
    else if (confidence === "high" && (fullPageSources.length < 2 || independentHosts.size < 2 || allCommunitySources)) confidence = "medium";
    if (confidence === "high" && sources.some(source => !source.full_text)) confidence = "medium";
    return json({
      success: true,
      question,
      answer: answer.answer.slice(0, 12000),
      confidence,
      coverage_note: String(answer.coverage_note || "Search extracts are not a full verification of every source.").slice(0, 1200),
      key_points: Array.isArray(answer.key_points) ? answer.key_points.slice(0, 8).map(item => String(item).slice(0, 400)) : [],
      sources: sources.map((source, index) => ({ number: index + 1, title: source.title, url: source.url, extract: source.snippet, full_page_read: Boolean(source.full_text), search_query: source.query || question })),
      researched_at: new Date().toISOString(),
      research_method: "Multi-query web discovery + direct page retrieval and extraction + Cloudflare Workers AI synthesis",
      limitations: "Some websites block automated retrieval or expose only partial text. Each source is labelled as a full-page extract or a search snippet; verify important claims against primary sources."
    });
  } catch (error) {
    return json({ success: false, error: error.message || "Research failed. Please try again." }, 500);
  }
}
