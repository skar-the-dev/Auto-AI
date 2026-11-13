import { generateScript } from "./ideas.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

const angles = [
  "The surprising basics",
  "What beginners often miss",
  "Three things worth knowing",
  "A common myth explained",
  "The detail that changes everything",
  "A quick beginner's guide"
];

function parsePlannerResult(result) {
  const candidates = [result?.response, result?.result?.response, result?.choices?.[0]?.message?.content, result?.result?.choices?.[0]?.message?.content, result?.text, result?.result, result];
  for (const value of candidates) {
    if (value && typeof value === "object" && !Array.isArray(value) && ("needs_clarification" in value || "understood_topic" in value)) return value;
    if (typeof value === "string") {
      const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const first = cleaned.indexOf("{"), last = cleaned.lastIndexOf("}");
      if (first >= 0 && last > first) {
        try { return JSON.parse(cleaned.slice(first, last + 1)); } catch {}
      }
    }
  }
  throw new Error("The topic understanding response was not valid JSON.");
}


async function discoverNicheTopic(niche, env, recentTopics = []) {
  const avoid = recentTopics.length
    ? "Avoid repeating these recently used topics: " + recentTopics.join(" | ")
    : "No previous topics are available.";
  const result = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
    messages: [
      { role: "system", content: "You are Auto AI's topic discovery researcher. Select one specific, engaging, suitable short-form video topic for the supplied niche. Return valid JSON only." },
      { role: "user", content: [
        "Choose one strong topic for a 25–35 second short-form video.",
        "NICHE: " + niche,
        avoid,
        "Choose a focused subject with a clear angle, not a vague category. It must be suitable for a faceless video and have enough factual material to research. Prefer evergreen topics unless the niche itself clearly requires current news. Do not claim it is trending or breaking news unless you have verified live evidence. Do not make up events, people or statistics.",
        'Return JSON: {"needs_clarification":false,"understood_topic":"A concise specific video topic","topic_reason":"One short sentence explaining why it suits the niche."}'
      ].join("\\n") }
    ],
    max_completion_tokens: 350,
    temperature: 0.35,
    response_format: { type: "json_object" },
    chat_template_kwargs: { enable_thinking: false }
  });
  const parsed = parsePlannerResult(result);
  const topic = String(parsed.understood_topic || "").trim().slice(0, 180);
  if (topic.length < 8) throw new Error("Auto AI could not find a suitable topic in this niche. Please try again.");
  return { topic, reason: String(parsed.topic_reason || "Selected automatically for your niche.").slice(0, 240) };
}
\nasync function understandBatchTopic(topic, env) {
  const prompt = [
    'Read the whole topic and identify its likely meanings. Do not create content or search yet.',
    'TOPIC: ' + topic,
    '',
    'Ask one short clarification when the wording could reasonably mean different things. Options MUST be mutually exclusive, clearly different, and directly answer the ambiguity. Do not offer near-duplicates, different phrasings of the same meaning, or irrelevant metrics. Use plain language, not unexplained jargon.',
    '',
    'Special case: if the topic is about biggest/highest earning games, use these distinct meanings:',
    '1. Games that have made the most money overall from sales, subscriptions and in-game purchases (highest lifetime game revenue).',
    '2. Games with the largest total esports tournament prize pools.',
    '3. Games whose professional players have earned the most from tournament winnings over their careers.',
    'Do not confuse game revenue with esports prize money or player earnings.',
    '',
    'For other topics, tailor 2 to 4 options to the actual ambiguity. If there is one obvious meaning, do not ask; set needs_clarification false and state that interpretation.',
    'Keep the user requested number, subject and constraints. Ask about timeframe or region only if it materially changes the answer and is not already specified.',
    '',
    'Return JSON: {"needs_clarification":true,"clarifying_question":"Do you mean...","options":["...","..."],"understood_topic":"..."} or {"needs_clarification":false,"clarifying_question":"","options":[],"understood_topic":"Precise interpretation."}'
  ].join('\n');
  const result = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
    messages: [
      { role: "system", content: "You are Auto AI's topic clarification assistant. Understand the user's intended subject. Ask one concise clarification only when interpretations would produce substantially different content. Return valid JSON only." },
      { role: "user", content: prompt }
    ],
    max_completion_tokens: 550,
    temperature: 0.05,
    response_format: { type: "json_object" },
    chat_template_kwargs: { enable_thinking: false }
  });
  const parsed = parsePlannerResult(result);
  const options = Array.isArray(parsed.options) ? parsed.options.map(value => String(value).trim()).filter(Boolean).slice(0,4) : [];
  return {
    needs_clarification: parsed.needs_clarification === true && Boolean(parsed.clarifying_question) && options.length >= 2,
    clarifying_question: String(parsed.clarifying_question || "").slice(0,300),
    options,
    understood_topic: String(parsed.understood_topic || topic).slice(0,500)
  };
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ success: false, error: "Database binding DB is missing." }, 500);
    if (!env.AI) return json({ success: false, error: "Workers AI binding AI is missing. Check the binding and redeploy." }, 500);

    const body = await request.json();
    const accountId = String(body.account_id || "").trim();
    let topic = String(body.topic || "").trim().slice(0, 180);
    if (body.mode === "clarify") {
      if (topic.length < 4) return json({ success: false, error: "Enter a little more detail about the topic." }, 400);
      return json({ success: true, ...await understandBatchTopic(topic, env) });
    }
    const clarification = String(body.clarification || "").trim().slice(0, 500);
    const understoodTopic = String(body.understood_topic || topic).trim().slice(0, 500);
    const count = Number(body.count);
    const selectedNiche = String(body.niche || "").trim().slice(0, 160);

    if (!accountId) return json({ success: false, error: "Choose an account." }, 400);
    if (!selectedNiche) return json({ success: false, error: "Choose a content niche." }, 400);
    if (!Number.isInteger(count) || count < 1 || count > 6) {
      return json({ success: false, error: "Batch size must be between 1 and 6." }, 400);
    }

    const account = await env.DB.prepare(
      "SELECT id, name, niche FROM accounts WHERE id = ? AND active = 1"
    ).bind(accountId).first();
    if (!account) return json({ success: false, error: "Active account not found. Resume it and try again." }, 404);

    let discovery = null;
    if (!topic) {
      const recent = await env.DB.prepare(
        "SELECT topic FROM scripts WHERE niche = ? ORDER BY created_at DESC LIMIT 20"
      ).bind(selectedNiche).all().catch(() => ({ results: [] }));
      discovery = await discoverNicheTopic(selectedNiche, env, (recent.results || []).map(row => row.topic).filter(Boolean));
      topic = discovery.topic;
    }
    const finalTopic = (clarification ? topic + " — " + clarification : (understoodTopic || topic)).slice(0, 180);

    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS scripts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        niche TEXT NOT NULL,
        topic TEXT NOT NULL,
        content_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Draft',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // Generate the complete batch before saving, so a model error does not leave a half-finished batch.
    const drafts = [];
    for (let i = 0; i < count; i++) {
      const scriptTopic = finalTopic;
      const allowedStyles = new Set(["curiosity", "facts", "story", "list", "gaming", "reddit_story", "motivation", "cinematic", "mystery"]);
      const requestedStyle = Array.isArray(body.styles) ? String(body.styles[i] || "") : "";
      const style = allowedStyles.has(requestedStyle) ? requestedStyle : (i % 2 === 0 ? "curiosity" : "facts");
      const script = await generateScript(env, selectedNiche, scriptTopic, style);
      script.video_style = style;
      drafts.push({ id: crypto.randomUUID(), topic: scriptTopic, script });
    }

    const created = [];
    for (const draft of drafts) {
      await env.DB.prepare(`
        INSERT INTO scripts (id, title, niche, topic, content_json, status)
        VALUES (?, ?, ?, ?, ?, 'Draft')
      `) .bind(draft.id, draft.script.title, selectedNiche, draft.topic, JSON.stringify(draft.script)).run();
      created.push({ id: draft.id, title: draft.script.title, topic: draft.topic });
    }

    return json({
      success: true,
      account: account.name,
      created,
      count: created.length,
      generated_by: "Cloudflare Workers AI",
      topic: finalTopic,
      topic_discovery: discovery,
      message: created.length + " AI-generated script drafts saved. Review factual claims before publishing."
    }, 201);
  } catch (error) {
    return json({ success: false, error: error.message || "Could not create AI batch." }, 500);
  }
}
