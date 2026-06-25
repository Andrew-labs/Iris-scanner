// POST { imageDataUrl, colorLabel } -> { id }
// Kicks off a Flux Kontext Pro prediction that turns the captured eye crop
// into a hyperreal macro iris in the detected colour. Returns the prediction id;
// the client then polls poll-iris.js until it's done.

const MODEL_VERSION_ENDPOINT =
  "https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions";

function promptFor(colorLabel) {
  const color = (colorLabel || "natural").toLowerCase();
  return (
    `Extreme macro photograph of a single human iris, ${color} colour preserved exactly. ` +
    `Razor-sharp crystalline iris fibres radiating from the pupil, intricate trabecular meshwork, ` +
    `fine crypts and furrows, subtle limbal ring, wet catchlight reflection, shallow depth of field. ` +
    `Hyperreal clinical detail, studio macro lighting, centred, circular composition, black background. ` +
    `Keep the original eye colour faithful. No skin, no eyelashes, no eyebrow, iris only.`
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return json(500, { error: "Server not configured: REPLICATE_API_TOKEN missing" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const { imageDataUrl, colorLabel } = body;
  if (!imageDataUrl || !imageDataUrl.startsWith("data:image")) {
    return json(400, { error: "imageDataUrl (data URL) required" });
  }

  try {
    const res = await fetch(MODEL_VERSION_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          prompt: promptFor(colorLabel),
          input_image: imageDataUrl,
          aspect_ratio: "1:1",
          output_format: "png",
          safety_tolerance: 2,
          prompt_upsampling: false,
        },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return json(res.status, { error: data?.detail || "Replicate error", raw: data });
    }
    return json(200, { id: data.id, status: data.status });
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
