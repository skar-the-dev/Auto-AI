function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\\s\\S]*?<\\/script>/gi, " ")
    .replace(/<style[\\s\\S]*?<\\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\\s+/g, " ").trim();
}

function decodeUrl(value) {
  try {
    const url = new URL(value, "https://duckduckgo.com");
    const redirect = url.searchParams.get("uddg");
    return redirect ? decodeURIComponent(redirect) : url.toString();
  } catch { return ""; }
}

async function searchWeb(query) {
  const endpoint = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AutoAIResearch/1.0)",
      "Accept": "text/html"
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("Web search is temporarily unavailable (" + response.status + ").");
  const html = await response.text();
  const results = [];
  const blocks = html.match(/<div class="result[^>]*>[\\s\\S]*?<\\/div>\\s*<\\/div>/gi) || [];
  for (const block of blocks) {
    const linkMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\\s\\S]*?)<\\/a>/i);
    if (!linkMatch) continue;
    const url = decodeUrl(linkMatch[1]);
    if (!/^https?:\\/\\//i.test(url) || /duckduckgo\\.com/i.test(new URL(url).hostname)) continue;
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\\s\\S]*?)<\\/div>/i);
    const title = stripHtml(linkMatch[2]).slice(0, 220);
    const snippet = stripHtml(snippetMatch?.[1] || "").slice(0, 700);
    if (title && snippet && !results.some(item => item.url === url)) {
      results.push({ title, url, snippet });
    }
    if (results.length >= 7) break;
  }
  return results;
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
      "[" + (index + 1) + "] " + source.title + "\\nURL: " + source.url + "\\nSearch extract: " + source.snippet
    ).join("\\n\\n");

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
- Search extracts are limited evidence, not full source verification. Explain when important details need checking.
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
      sources: sources.map((source, index) => ({ number: index + 1, title: source.title, url: source.url, extract: source.snippet })),
      researched_at: new Date().toISOString(),
      research_method: "Live web search extracts + Cloudflare Workers AI synthesis",
      limitations: "Auto AI has read search-result extracts, not necessarily every full article. Check primary sources for important decisions."
    });
  } catch (error) {
    return json({ success: false, error: error.message || "Research failed. Please try again." }, 500);
  }
}
