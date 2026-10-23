// api/chef.js — the "kitchen" of Chaos Chef.
// This runs on Vercel's servers, so your API key stays secret
// (it is never sent to the browser and never stored on GitHub).

// true  = the chef's personality also changes with the slider (more fun)
// false = ONLY the temperature changes (pure demo of the temperature effect)
const PERSONA_BOOST = true;

function buildSystemPrompt(chaos) {
  const base = [
    "You are Chaos Chef, a cooking assistant on a playful website.",
    "The user tells you what is in their fridge, then may ask follow-up questions or changes.",
    "Mainly use the user's ingredients. You may assume basic staples (salt, pepper, oil, water, flour, sugar).",
    "Write plain text only, no markdown symbols like ** or #.",
    "Whenever you give a recipe (a new one or a changed version), use exactly this structure:",
    "DISH: <one food emoji> <dish name>",
    "TIME: <total time, e.g. 25 min>",
    "DIFFICULTY: <easy, medium or hard>",
    "INGREDIENTS:",
    "- <ingredient and amount>",
    "STEPS:",
    "1. <step>",
    "CHEF'S NOTE: <one sentence in your personality>",
    "For other questions, answer briefly in plain text without that structure.",
    "Keep every answer under 250 words. The food must always be edible and safe to cook."
  ].join("\n");

  if (!PERSONA_BOOST) return base;

  if (chaos < 0.34) {
    return base + "\nStyle: classic, reliable home cooking. Calm, formal, precise tone.";
  }
  if (chaos < 0.67) {
    return base + "\nStyle: a creative bistro chef. Classic base with one surprising twist. Friendly, playful tone.";
  }
  return base + "\nStyle: a wild experimental street-food chef who loves unexpected fusion combinations from different cuisines. Energetic, funny, dramatic tone.";
}

// Used if you add ANTHROPIC_API_KEY in Vercel
async function askClaude(system, messages, temperature) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: process.env.MODEL || "claude-haiku-5-5",
      max_tokens: 800,
      temperature, // Claude: 0 to 1
      system,
      messages
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Claude API error");
  return data.content.filter(b => b.type === "text").map(b => b.text).join("\n");
}

// Used if you add OPENAI_API_KEY in Vercel instead
async function askOpenAI(system, messages, temperature) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.MODEL || "gpt-4o-mini",
      max_tokens: 800,
      temperature: temperature * 1.5, // OpenAI allows 0–2; above ~1.5 answers turn into gibberish
      messages: [{ role: "system", content: system }, ...messages]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "OpenAI API error");
  return data.choices[0].message.content;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Please send a POST request." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    // Slider value from the website, kept between 0 and 1
    const chaos = Math.min(1, Math.max(0, Number(body.temperature) || 0));

    // Chat history (last 10 messages, each max 2000 characters)
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .slice(-10)
      .map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || "").slice(0, 2000)
      }));
    while (messages.length && messages[0].role === "assistant") messages.shift();

    if (messages.length === 0) {
      return res.status(400).json({ error: "Tell the chef what's in your fridge first." });
    }

    const system = buildSystemPrompt(chaos);
    let reply;

    if (process.env.ANTHROPIC_API_KEY) {
      reply = await askClaude(system, messages, chaos);
    } else if (process.env.OPENAI_API_KEY) {
      reply = await askOpenAI(system, messages, chaos);
    } else {
      return res.status(500).json({
        error: "No API key found. Add ANTHROPIC_API_KEY or OPENAI_API_KEY in Vercel → Settings → Environment Variables, then redeploy."
      });
    }

    return res.status(200).json({ reply, temperature: chaos });
  } catch (err) {
    return res.status(500).json({ error: err.message || "The kitchen is on fire. Try again." });
  }
};
