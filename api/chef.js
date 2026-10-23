// api/chef.js — the "kitchen" of Chaos Chef.
// This runs on Vercel's servers, so your API key stays secret
// (it is never sent to the browser and never stored on GitHub).
//
// Model: GPT-5 mini (change it with a MODEL environment variable in Vercel if needed).
// Note: GPT-5 mini does not accept a custom temperature. So the slider's value
// is translated into creativity instructions for the chef instead (see below).
// If you ever switch to a model that DOES accept temperature, the code sends
// the real temperature automatically.

// true  = the chef's personality also changes with the slider (needed for GPT-5 mini)
// false = only the real temperature parameter changes (only works on models that accept it)
const PERSONA_BOOST = true;

// Random "inspiration" for higher chaos levels. A real high temperature makes the
// AI pick less likely words; these random picks push it to less likely DISHES too,
// so every high-chaos recipe turns out different.
const CUISINES = ["Korean", "Mexican", "Japanese", "Italian", "Indian", "Moroccan", "Thai", "Peruvian",
  "Viennese", "Greek", "Lebanese", "Vietnamese", "Ethiopian", "Caribbean", "Scandinavian", "Texan BBQ"];
const FORMATS = ["tacos", "dumplings", "pancakes", "a savory pie", "sushi-style rolls", "a soup", "a burger",
  "a curry", "skewers", "waffles", "a flatbread pizza", "fritters", "a layered bake", "a rice bowl", "a toastie", "spring rolls"];
const TWISTS = ["with a sweet-and-salty glaze", "with a crunchy topping made from something unexpected",
  "stacked into a dramatic tower", "with a dipping sauce nobody would expect", "reinvented as a breakfast dish",
  "with a smoky, charred finish", "served on sticks like street food", "with a bright pickled side"];
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

function creativityInstructions(chaos) {
  const level = chaos.toFixed(2);
  let style;
  if (chaos < 0.2) {
    style = "Give a well-known, normal dish that most people already love and that is guaranteed to taste good, the one any cookbook would print, with a plain descriptive name. Use only the user's ingredients and basic staples. No surprises. Calm, formal, precise tone.";
  } else if (chaos < 0.4) {
    style = "Give a classic, reliable home-cooking recipe with a simple name. You may add one or two common pantry items (e.g. a spice or herb). Polite, clear tone.";
  } else if (chaos < 0.6) {
    style = `Be a creative bistro chef: a classic dish, but ${rand(TWISTS)}. You may add up to two pantry items for the twist. Friendly, playful tone.`;
  } else if (chaos < 0.8) {
    const [a, b] = [rand(CUISINES), rand(CUISINES)];
    style = `Be an adventurous street-food chef. Turn the ingredients into ${rand(FORMATS)} that fuses ${a} and ${b === a ? "Mexican" : b} cooking. Give it a fun name. It should be unusual but clearly tasty. You may add up to three pantry items (spices, sauces). Energetic, funny tone.`;
  } else {
    const [a, b] = [rand(CUISINES), rand(CUISINES)];
    style = `Be a wild experimental chef. Turn the ingredients into ${rand(FORMATS)} that fuses ${a} and ${b === a ? "Japanese" : b} cooking, ${rand(TWISTS)}. Give it a dramatic, ridiculous name. Do NOT make an ordinary pasta, stir-fry or salad: the dish itself must be crazy, not just the wording. But it should still have a real chance of tasting good, so balance the flavors (salty, sweet, sour, spicy, crunchy) like a chef would and explain in the CHEF'S NOTE why the crazy combination works. You may add up to three pantry items (spices, sauces). Over-the-top, chaotic, very funny tone.`;
  }
  return `Creativity level: ${level} on a scale from 0 (completely predictable) to 1 (completely unpredictable).\nStyle: ${style}`;
}

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

  return PERSONA_BOOST ? base + "\n" + creativityInstructions(chaos) : base;
}

// OpenAI (used when OPENAI_API_KEY is set in Vercel)
async function askOpenAI(system, messages, chaos) {
  const model = process.env.MODEL || "gpt-5-mini";
  const body = {
    model,
    max_completion_tokens: 3000,
    temperature: chaos * 1.5, // removed automatically if the model doesn't accept it
    messages: [{ role: "system", content: system }, ...messages]
  };
  if (model.startsWith("gpt-5")) body.reasoning_effort = "minimal"; // faster answers

  // Try the request. If the model rejects a setting (e.g. temperature on GPT-5 mini),
  // remove that setting and try again.
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (response.ok) {
      return {
        text: data.choices?.[0]?.message?.content || "The chef went quiet. Try again.",
        realTemperature: "temperature" in body
      };
    }
    const message = data.error?.message || "OpenAI API error";
    const param = data.error?.param || "";
    if (/temperature/i.test(param + message) && "temperature" in body) { delete body.temperature; continue; }
    if (/reasoning_effort/i.test(param + message) && "reasoning_effort" in body) { delete body.reasoning_effort; continue; }
    throw new Error(message);
  }
  throw new Error("OpenAI rejected the request settings.");
}

// Claude (used when ANTHROPIC_API_KEY is set in Vercel)
async function askClaude(system, messages, chaos) {
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
      temperature: chaos, // Claude: 0 to 1
      system,
      messages
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Claude API error");
  return {
    text: data.content.filter(b => b.type === "text").map(b => b.text).join("\n"),
    realTemperature: true
  };
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
    let result;

    if (process.env.OPENAI_API_KEY) {
      result = await askOpenAI(system, messages, chaos);
    } else if (process.env.ANTHROPIC_API_KEY) {
      result = await askClaude(system, messages, chaos);
    } else {
      return res.status(500).json({
        error: "No API key found. Add OPENAI_API_KEY in Vercel → Settings → Environment Variables, then redeploy."
      });
    }

    return res.status(200).json({
      reply: result.text,
      temperature: chaos,
      realTemperature: result.realTemperature
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "The kitchen is on fire. Try again." });
  }
};
