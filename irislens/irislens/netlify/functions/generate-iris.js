// POST { imageDataUrl, colorLabel, irisCropUrl, pixelEvidence } -> { id, confirmedColor }
//
// Colour detection strategy:
//   - Send Claude Vision a TIGHT iris-only crop (pupil to limbus, upscaled), not the whole eye.
//   - Also send the browser's sclera-corrected pixel measurements as hard evidence.
//   - Prompt explicitly teaches the model how phone cameras distort iris colour.
//   - 3 samples at temperature 0, majority vote.
// Generation:
//   - Flux Kontext Pro, with auto-retry on transient Replicate startup errors (E9243 etc).

const REPLICATE_ENDPOINT =
  "https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";

const VALID_COLORS = [
  "blue", "blue-gray", "green", "hazel", "amber", "brown", "dark brown", "gray"
];

function buildVisionPrompt(ev) {
  const evidenceBlock = ev ? `
MEASURED PIXEL EVIDENCE (computed in-browser, already white-balance corrected using the sclera as a neutral reference):
- Dominant hue: ${ev.dominantHue}deg
- Mean saturation: ${ev.meanSaturation}
- Mean lightness: ${ev.meanLightness}
- Mean RGB of the iris ring: [${ev.meanRGB?.join(", ")}]
- Blue minus Red channel: ${ev.blueOverRed}  (positive = cool/blue pigment, negative = warm/brown pigment)
- White-balance gains applied: [${ev.whiteBalanceGains?.join(", ")}]
- Sclera reference samples: ${ev.scleraSamples}
- Hue distribution across 12 bins of 30deg (percent of saturated pixels): [${ev.hueProfilePercent?.join(", ")}]
  (bin 0 = 0-30deg red/orange, bin 3 = 90-120deg green, bin 6 = 180-210deg cyan, bin 7 = 210-240deg blue)
- Raw frame luminance (0-255): ${ev.frameLuminance}  ${ev.frameLuminance < 90 ? "(DIM capture - colour is washed out, blue scattering is suppressed. Lean toward blue over gray.)" : ev.frameLuminance > 190 ? "(BRIGHT capture - highlights may be clipped. Ignore washed-out regions.)" : "(good exposure)"}
- Fraction of clipped/blown-out pixels: ${ev.clippedFraction}

HOW TO USE THE HUE NUMBER:
- 0-40deg or >330deg -> warm pigment (brown / dark brown / amber)
- 40-62deg -> amber
- 55-95deg -> hazel
- 95-168deg -> green
- 168-205deg -> blue-gray or blue
- 205-265deg -> blue
The measured hue is usually reliable. Trust it unless the image clearly contradicts it.
"Blue minus Red" is the single strongest signal: clearly positive means blue, clearly negative means brown.
` : "";

  return `You are looking at a tight macro crop of a single human iris, from pupil edge to limbal ring. There is no skin, eyelash, or sclera in this frame.
${evidenceBlock}
CRITICAL CONTEXT about how this image was captured:
- Phone front cameras apply aggressive auto white balance that NEUTRALISES cool colours. Blue eyes routinely render as grey.
- Warm indoor and venue lighting pushes everything toward yellow/orange, making blue eyes look grey and grey eyes look brown.
- The image is JPEG-compressed and upscaled, so subtle colour has been degraded.
- Bright white specular reflections are the camera flash or ambient light, NOT the iris colour. Ignore them completely.
- Shadow at the top of the iris (from the upper eyelid) is NOT brown pigment. Ignore it.

HOW TO JUDGE:
1. Look at the iris FIBRES radiating outward from the pupil. Their colour is far more reliable than the overall average.
2. Judge the UNDERLYING PIGMENT, not the apparent colour under this lighting.
3. Blue eyes have no blue pigment at all - they appear blue through light scattering in a low-melanin stroma. This scattering is easily washed out by warm light. If the stroma looks pale, translucent, or "empty" of brown pigment, it is a BLUE eye, not a grey one.
4. Brown eyes contain unmistakable dense melanin: a solid, warm, opaque brown throughout the stroma. If you cannot see actual brown pigment, it is not a brown eye.
5. True GREY eyes are genuinely rare. Only answer "gray" when there is no blue scattering, no green, and no brown pigment whatsoever.
6. When torn between "blue" and "gray": choose BLUE. When torn between "blue" and "blue-gray": use the measured hue - above 205deg means blue.
7. When torn between "blue-gray" and "brown": look at the Blue-minus-Red value. Positive means it is not brown.

Weigh the measured pixel evidence heavily. It has already been corrected for the camera's white balance error, which your visual impression has not.

Reply with ONLY one of these exact labels, lowercase, nothing else:
blue, blue-gray, green, hazel, amber, brown, dark brown, gray`;
}

async function detectIrisColorOnce(imageDataUrl, pixelEvidence, apiKey) {
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
      model: "claude-sonnet-4-6",
      max_tokens: 16,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: buildVisionPrompt(pixelEvidence) },
        ],
      }],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  const raw = data?.content?.[0]?.text?.trim().toLowerCase() || "";
  // Longest label first so "dark brown" beats "brown" and "blue-gray" beats "blue"
  const sorted = [...VALID_COLORS].sort((a, b) => b.length - a.length);
  return sorted.find((c) => raw.includes(c)) || null;
}

// Hard override: if the corrected pixel measurement is unambiguous, don't let Vision
// talk itself into a warm colour. This catches the exact "blue eye reads brown" failure.
function pixelVeto(ev, visionColor) {
  if (!ev || typeof ev.blueOverRed !== "number") return visionColor;
  const warm = ["brown", "dark brown", "amber", "hazel"];
  const hue = ev.dominantHue;

  // 1. Strongly cool pixels can never be a warm eye.
  if (ev.blueOverRed > 12 && warm.includes(visionColor)) {
    if (hue >= 205 && hue < 265) return "blue";
    if (hue >= 168 && hue < 205) return "blue-gray";
    return "blue";
  }

  // 2. "gray" is over-predicted on blue eyes because warm light kills the blue scatter.
  //    If the corrected pixels are clearly cool, a grey verdict is wrong.
  if (visionColor === "gray") {
    if (ev.blueOverRed > 14 && hue >= 205 && hue < 265) return "blue";
    if (ev.blueOverRed > 8) return "blue-gray";
  }

  // 3. Same for blue-gray: if the hue is firmly in blue territory and the pixels are
  //    strongly cool, it is a blue eye, not a blue-grey one.
  if (visionColor === "blue-gray" && ev.blueOverRed > 20 && hue >= 210 && hue < 265) {
    return "blue";
  }

  // 4. Strongly warm pixels can never be a blue eye.
  if (ev.blueOverRed < -14 && (visionColor === "blue" || visionColor === "blue-gray" || visionColor === "gray")) {
    return ev.meanLightness < 0.28 ? "dark brown" : "brown";
  }

  return visionColor;
}

async function detectIrisColor(imageDataUrl, pixelEvidence) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const results = await Promise.all([
    detectIrisColorOnce(imageDataUrl, pixelEvidence, apiKey).catch(() => null),
    detectIrisColorOnce(imageDataUrl, pixelEvidence, apiKey).catch(() => null),
    detectIrisColorOnce(imageDataUrl, pixelEvidence, apiKey).catch(() => null),
  ]);

  const votes = results.filter(Boolean);
  if (votes.length === 0) return null;

  const tally = {};
  for (const v of votes) tally[v] = (tally[v] || 0) + 1;
  let best = votes[0], bestCount = 0;
  for (const [colour, count] of Object.entries(tally)) {
    if (count > bestCount) { bestCount = count; best = colour; }
  }

  const final = pixelVeto(pixelEvidence, best);
  console.log(`[vision] votes=[${votes.join(",")}] majority=${best} final=${final} blueOverRed=${pixelEvidence?.blueOverRed} hue=${pixelEvidence?.dominantHue}`);
  return final;
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

const TRANSIENT_CODES = ["E9243", "E6716", "E8765", "E1000"];
const MAX_ATTEMPTS = 3;

async function startPrediction(token, confirmedColor, imageDataUrl) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(REPLICATE_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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
      if (res.ok && data.id) {
        if (attempt > 1) console.log(`[replicate] succeeded on attempt ${attempt}`);
        return { ok: true, data };
      }
      const errText = JSON.stringify(data);
      const isTransient = TRANSIENT_CODES.some((code) => errText.includes(code));
      lastError = { status: res.status, data };
      if (isTransient && attempt < MAX_ATTEMPTS) {
        const backoff = 800 * attempt;
        console.warn(`[replicate] transient error attempt ${attempt}, retry in ${backoff}ms`);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      return { ok: false, status: res.status, data };
    } catch (e) {
      lastError = { status: 500, data: { error: String(e) } };
      if (attempt < MAX_ATTEMPTS) { await new Promise((r) => setTimeout(r, 800 * attempt)); continue; }
    }
  }
  return { ok: false, status: lastError?.status || 500, data: lastError?.data || { error: "Unknown" } };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return json(500, { error: "REPLICATE_API_TOKEN not set" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  const { imageDataUrl, colorLabel: pixelLabel, irisCropUrl, pixelEvidence } = body;
  if (!imageDataUrl?.startsWith("data:image")) return json(400, { error: "imageDataUrl required" });

  // Step 1 — colour detection. Prefer the tight iris crop if the client sent one.
  const visionImage = (irisCropUrl && irisCropUrl.startsWith("data:image")) ? irisCropUrl : imageDataUrl;
  let confirmedColor = pixelLabel || "natural";
  try {
    const visionColor = await detectIrisColor(visionImage, pixelEvidence);
    if (visionColor) confirmedColor = visionColor;
  } catch (e) {
    console.warn("Vision colour detection failed, using pixel label:", e.message);
  }

  // Step 2 — generate. Uses the full eye crop as the image-to-image source.
  const result = await startPrediction(token, confirmedColor, imageDataUrl);
  if (!result.ok) {
    const detail = result.data?.detail || result.data?.error || "Replicate error";
    return json(result.status, { error: detail, raw: result.data });
  }
  return json(200, { id: result.data.id, status: result.data.status, confirmedColor });
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(obj),
  };
}
