// POST { imageDataUrl, colorLabel } -> { id }
// Step 1: Use Claude Vision to accurately detect iris colour from the cropped image.
// Step 2: Use that confirmed colour in the Flux Kontext Pro prompt.

const REPLICATE_ENDPOINT =
  "https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";

// Valid colour labels the classifier can return
const VALID_COLORS = [
  "blue", "blue-gray", "green", "hazel", "amber", "brown", "dark brown", "gray"
];

async function detectIrisColor(imageDataUrl) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null; // fall back to pixel-sampled label

  // Strip the data URL prefix to get raw base64
  const base64 = imageDataUrl.split(",")[1];
  const mediaType = imageDataUrl.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";

  const res = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 20,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: `Look at the iris (coloured part) of this eye image. Identify the iris colour.
Reply with ONLY one of these exact labels, nothing else:
blue, blue-gray, green, hazel, amber, brown, dark brown, gray`,
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  const raw = data?.content?.[0]?.text?.trim().toLowerCase() || "";
  // Validate the response is one of our known labels
  return VALID_COLORS.find((c) => raw.includes(c)) || null;
}

function promptFor(colorLabel) {
  const color = (colorLabel || "natural").toLowerCase();
  return (
    `Extreme macro photograph of a single human iris, ${color} colour, preserved exactly and faithfully. ` +
    `Razor-sharp crystalline iris fibres radiating from the pupil, intricate trabecular meshwork, ` +
    `fine crypts and furrows, subtle limbal ring, wet specular catchlight, shallow depth of field. ` +
    `Hyperreal clinical macro detail, neutral studio lighting, centred circular composition, pure black background. ` +
    `The iris colour must be ${color} — do not change or neutralise it. Iris only, no skin, no eyelashes.`
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return json(500, { error: "REPLICATE_API_TOKEN not set" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  const { imageDataUrl, colorLabel: pixelLabel } = body;
  if (!imageDataUrl?.startsWith("data:image")) return json(400, { error: "imageDataUrl required" });

  // Step 1 — ask Claude Vision what colour the iris actually is.
  // Falls back to the pixel-sampled label if the API key isn't set or the call fails.
  let confirmedColor = pixelLabel || "natural";
  try {
    const visionColor = await detectIrisColor(imageDataUrl);
    if (visionColor) confirmedColor = visionColor;
  } catch (e) {
    console.warn("Vision colour detection failed, using pixel label:", e.message);
  }

  // Step 2 — generate the iris with the confirmed colour.
  try {
    const res = await fetch(REPLICATE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          prompt: promptFor(confirmedColor),
          input_image: imageDataUrl,
          aspect_ratio: "1:1",
          output_format: "png",
          safety_tolerance: 2,
          prompt_upsampling: false,
        },
      }),
    });

    const data = await res.json();
    if (!res.ok) return json(res.status, { error: data?.detail || "Replicate error", raw: data });

    // Return the prediction id AND the confirmed colour so the UI can display it
    return json(200, { id: data.id, status: data.status, confirmedColor });
  } catch (e) {
    return json(500, { error: String(e) });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(obj),
  };
}
