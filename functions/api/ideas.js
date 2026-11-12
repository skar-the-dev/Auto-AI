function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
const clean = value => String(value || "").trim().slice(0, 160);

export function buildScript(niche, topic, style) {
  const hooks = {
    curiosity: `You probably don't know this about ${topic}...`,
    facts: `Here are 3 things about ${topic} that might surprise you.`,
    story: `This ${niche} story starts with one simple question: what happened next?`,
    list: `Stop scrolling. Here are 3 ${topic} points worth knowing.`
  };
  const hook = hooks[style] || hooks.curiosity;
  const safeTopic = topic || `the world of ${niche}`;
  return {
    title: `${safeTopic}: a quick ${niche} short`, hook,
    voiceover: [hook, `First, focus on the detail most people overlook when it comes to ${safeTopic}.`, `Next, consider why it matters and what makes it interesting for anyone who follows ${niche}.`, `And finally, remember this: the small details are often the ones that make the biggest difference.`, `Follow for more ${niche} videos, and tell us what topic we should cover next.`].join("\n\n"),
    scenes: [
      { time: "0–3 sec", visual: "Fast opening shot that clearly relates to the topic", text: hook },
      { time: "3–10 sec", visual: "Relevant licensed footage or original visuals", text: "Point one" },
      { time: "10–20 sec", visual: "Change angle or show a second supporting visual", text: "Why it matters" },
      { time: "20–27 sec", visual: "Close-up or strongest supporting visual", text: "The key takeaway" },
      { time: "27–30 sec", visual: "Simple branded end card", text: "Follow for more" }
    ],
    caption: `${safeTopic} in 30 seconds. Follow for more ${niche} content. #shorts #${niche.toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
    production_notes: ["Use original visuals or footage you have permission to use.", "Add readable captions and keep important text away from platform interface areas.", "Check every factual claim before publishing."],
    disclosure: "Template-based draft only. Verify factual claims and replace generic lines before publishing."
  };
}

function parseModelJson(result) {
  const candidates = [
    result?.choices?.[0]?.message?.content,
    result?.result?.choices?.[0]?.message?.content,
    result?.response, result?.result?.response,
    result?.output_text, result?.output, result?.result?.output,
    result?.content, result?.message?.content, result
  ];
  const normalise = value => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(part => typeof part === "string" ? part : (part?.text || "")).join("\n");
    if (value && typeof value === "object") {
      if (typeof value.text === "string") return value.text;
      if (typeof value.content === "string") return value.content;
      if (typeof value.response === "string") return value.response;
    }
    return "";
  };
  let raw = "";
  for (const candidate of candidates) {
    raw = normalise(candidate);
    if (raw.trim()) break;
  }
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The AI response did not contain readable JSON. Please try again.");
  try { return JSON.parse(text.slice(start, end + 1)); }
  catch { throw new Error("The AI returned invalid JSON. Please try again."); }
}

export async function generateScript(env, niche, topic, style = "curiosity") {
  if (!env?.AI || typeof env.AI.run !== "function") {
    throw new Error("Workers AI is not available yet. Check the AI binding and redeploy the Pages project.");
  }
  const prompt = `Create an original 25–35 second vertical short-form video script.
Niche: ${niche}
Topic: ${topic}
Style: ${style}
Return ONLY valid JSON with keys title, hook, voiceover, scenes, caption, production_notes.
scenes must be an array of five objects with keys time, visual, text, covering 0-3, 3-10, 10-20, 20-27 and 27-30 seconds.
Be specific and engaging, avoid generic filler, do not invent statistics, names, quotes or precise factual claims. Phrase uncertain facts cautiously and flag them for checking. Keep on-screen captions brief. Do not claim research or source verification has been performed.`;
  const result = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
    messages: [
      { role: "system", content: "You write concise, engaging short-form video scripts. Return only a valid JSON object, with no markdown fences or commentary." },
      { role: "user", content: prompt }
    ],
    max_completion_tokens: 1800,
    temperature: 0.7,
    response_format: { type: "json_object" },
    chat_template_kwargs: { enable_thinking: false }
  });
  const generated = parseModelJson(result);
  if (!generated.title || !generated.hook || !generated.voiceover || !Array.isArray(generated.scenes)) {
    throw new Error("The AI response was incomplete. Please try again.");
  }
  const scenes = generated.scenes.slice(0, 8).map((scene, index) => ({
    time: clean(scene.time || `Scene ${index + 1}`),
    visual: clean(scene.visual), text: clean(scene.text)
  }));
  if (!scenes.length) throw new Error("The AI did not return any scenes.");
  return {
    title: clean(generated.title) || `${topic}: ${niche} short`,
    hook: clean(generated.hook),
    voiceover: String(generated.voiceover).trim().slice(0, 5000),
    scenes,
    caption: String(generated.caption || "").trim().slice(0, 1000),
    production_notes: Array.isArray(generated.production_notes) ? generated.production_notes.slice(0, 6).map(clean) : ["Check all factual claims before publishing."],
    disclosure: "AI-generated first draft. It has not been independently fact-checked; verify claims, names and figures before publishing."
  };
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const niche = clean(body.niche), topic = clean(body.topic);
    const style = ["curiosity", "facts", "story", "list"].includes(body.style) ? body.style : "curiosity";
    if (!niche) return json({ success: false, error: "Enter a content niche." }, 400);
    if (!topic) return json({ success: false, error: "Enter a video topic." }, 400);
    const script = await generateScript(env, niche, topic, style);
    return json({ success: true, script, generated_by: "Cloudflare Workers AI" });
  } catch (error) {
    return json({ success: false, error: error.message || "Could not generate the AI script." }, 500);
  }
}
