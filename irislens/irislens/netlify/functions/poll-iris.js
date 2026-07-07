// GET ?id=<prediction_id> -> { status, output }
// status: "starting" | "processing" | "succeeded" | "failed" | "canceled"
// When succeeded, output is the generated image URL (or array of URLs).

exports.handler = async (event) => {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return json(500, { error: "Server not configured: REPLICATE_API_TOKEN missing" });
  }
  const id = event.queryStringParameters && event.queryStringParameters.id;
  if (!id) return json(400, { error: "id query param required" });

  try {
    const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      return json(res.status, { error: data?.detail || "Replicate error" });
    }
    let output = data.output;
    if (Array.isArray(output)) output = output[0];
    return json(200, { status: data.status, output, error: data.error });
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
