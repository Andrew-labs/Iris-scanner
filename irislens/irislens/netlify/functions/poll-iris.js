// GET ?id=<prediction_id> -> { status, output, error, retryable }
// status: "starting" | "processing" | "succeeded" | "failed" | "canceled"

const TRANSIENT_CODES = ["E9243", "E6716", "E8765", "E1000"];

exports.handler = async (event) => {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return json(500, { error: "REPLICATE_API_TOKEN not set" });

  const id = event.queryStringParameters && event.queryStringParameters.id;
  if (!id) return json(400, { error: "id query param required" });

  try {
    const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) return json(res.status, { error: data?.detail || "Replicate error" });

    let output = data.output;
    if (Array.isArray(output)) output = output[0];

    // Flag transient failures so the client can auto-retry silently
    let retryable = false;
    if (data.status === "failed" && data.error) {
      const errText = String(data.error);
      retryable = TRANSIENT_CODES.some((code) => errText.includes(code));
    }

    return json(200, { status: data.status, output, error: data.error, retryable });
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
