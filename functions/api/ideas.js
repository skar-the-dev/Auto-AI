function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const clean = value => String(value || "").trim().slice(0, 160);

function buildScript(niche, topic, style) {
  const hooks = {
    curiosity: `You probably don't know this about ${topic}...`,
    facts: `Here are 3 things about ${topic} that might surprise you.`,
    story: `This ${niche} story starts with one simple question: what happened next?`,
    list: `Stop scrolling. Here are 3 ${topic} points worth knowing.`
  };

  const hook = hooks[style] || hooks.curiosity;
  const safeTopic = topic || `the world of ${niche}`;

  return {
    title: `${safeTopic}: a quick ${niche} short`,
    hook,
    voiceover: [
      hook,
      `First, focus on the detail most people overlook when it comes to ${safeTopic}.`,
      `Next, consider why it matters and what makes it interesting for anyone who follows ${niche}.`,
      `And finally, remember this: the small details are often the ones that make the biggest difference.`,
      `Follow for more ${niche} videos, and tell us what topic we should cover next.`
    ].join("\n\n"),
    scenes: [
      { time: "0–3 sec", visual: "Fast opening shot that clearly relates to the topic", text: hook },
      { time: "3–10 sec", visual: "Relevant licensed footage or original visuals", text: "Point one" },
      { time: "10–20 sec", visual: "Change angle or show a second supporting visual", text: "Why it matters" },
      { time: "20–27 sec", visual: "Close-up or strongest supporting visual", text: "The key takeaway" },
      { time: "27–30 sec", visual: "Simple branded end card", text: "Follow for more" }
    ],
    caption: `${safeTopic} in 30 seconds. Follow for more ${niche} content. #shorts #${niche.toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
    production_notes: [
      "Use original visuals or footage you have permission to use.",
      "Add readable captions and keep important text away from platform interface areas.",
      "Check every factual claim before publishing."
    ],
    disclosure: "This is a template-based first draft, not AI-generated research. Verify facts and replace generic lines with accurate topic-specific details before publishing."
  };
}

export async function onRequestPost({ request }) {
  try {
    const body = await request.json();
    const niche = clean(body.niche);
    const topic = clean(body.topic);
    const style = ["curiosity", "facts", "story", "list"].includes(body.style)
      ? body.style
      : "curiosity";

    if (!niche) return json({ success: false, error: "Enter a content niche." }, 400);
    if (!topic) return json({ success: false, error: "Enter a video topic." }, 400);

    return json({
      success: true,
      script: buildScript(niche, topic, style)
    });
  } catch {
    return json({ success: false, error: "Please send valid JSON." }, 400);
  }
}
