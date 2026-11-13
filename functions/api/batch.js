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

async function understandBatchTopic(topic, env) {
  const result = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
    messages: [
      { role: "system", content: "You are Auto AI's topic clarification assistant. Understand the complete topic, resolve ambiguity only when it changes the content direction, and return valid JSON only." },
      { role: "user", content: `Before creating scripts, decide whether this topic has multiple materially different meanings.
TOPIC: ${topic}

If it is ambiguous, ask ONE short "Do you mean..." question and provide 2 to 4 distinct options. If it is clear, do not ask anything; restate the intended topic precisely.
Examples:
- "biggest earning games" is ambiguous: total game revenue, esports prize pools, or professional player earnings.
- "facts about the solar system" is clear.
- "best footballers" may need a timeframe or criteria; ask only if essential.
Do not search or write scripts.

Return JSON:
{"needs_clarification":true,"clarifying_question":"Do you mean...","options":["...","..."],"understood_topic":"..."}
or
{"needs_clarification":false,"clarifying_question":"","options":[],"understood_topic":"Precise interpretation of the topic."}
Keep the user's original subject and intent. Never invent extra constraints.` }
    ],
    max_completion_tokens: 550,
    temperature: 0.1,
    response_format: { type: "json_object" },
    chat_template_kwargs: { enable_thinking: false }
  });
  const parsed = parsePlannerResult(result);
  const options = Array.isArray(parsed.options) ? parsed.options.map(String).map(value => value.trim()).filter(Boolean).slice(0,4) : [];
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
    const topic = String(body.topic || "").trim().slice(0, 180);
    if (body.mode === "clarify") {
      if (topic.length < 4) return json({ success: false, error: "Enter a little more detail about the topic." }, 400);
      return json({ success: true, ...await understandBatchTopic(topic, env) });
    }
    const clarification = String(body.clarification || "").trim().slice(0, 500);
    const understoodTopic = String(body.understood_topic || topic).trim().slice(0, 500);
    const finalTopic = (clarification ? topic + " — " + clarification : understoodTopic).slice(0, 180);
    const count = Number(body.count);

    if (!accountId) return json({ success: false, error: "Choose an account." }, 400);
    if (!finalTopic) return json({ success: false, error: "Enter a batch topic." }, 400);
    if (!Number.isInteger(count) || count < 1 || count > 6) {
      return json({ success: false, error: "Batch size must be between 1 and 6." }, 400);
    }

    const account = await env.DB.prepare(
      "SELECT id, name, niche FROM accounts WHERE id = ? AND active = 1"
    ).bind(accountId).first();
    if (!account) return json({ success: false, error: "Active account not found. Resume it and try again." }, 404);

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
      const scriptTopic = count === 1 ? finalTopic : `${finalTopic} — ${angles[i]}`;
      const allowedStyles = new Set(["curiosity", "facts", "story", "list", "gaming", "reddit_story", "motivation", "cinematic", "mystery"]);
      const requestedStyle = Array.isArray(body.styles) ? String(body.styles[i] || "") : "";
      const style = allowedStyles.has(requestedStyle) ? requestedStyle : (i % 2 === 0 ? "curiosity" : "facts");
      const script = await generateScript(env, account.niche, scriptTopic, style);
      script.video_style = style;
      drafts.push({ id: crypto.randomUUID(), topic: scriptTopic, script });
    }

    const created = [];
    for (const draft of drafts) {
      await env.DB.prepare(`
        INSERT INTO scripts (id, title, niche, topic, content_json, status)
        VALUES (?, ?, ?, ?, ?, 'Draft')
      `).bind(draft.id, draft.script.title, account.niche, draft.topic, JSON.stringify(draft.script)).run();
      created.push({ id: draft.id, title: draft.script.title, topic: draft.topic });
    }

    return json({
      success: true,
      account: account.name,
      created,
      count: created.length,
      generated_by: "Cloudflare Workers AI",
      message: created.length + " AI-generated script drafts saved. Review factual claims before publishing."
    }, 201);
  } catch (error) {
    return json({ success: false, error: error.message || "Could not create AI batch." }, 500);
  }
}
