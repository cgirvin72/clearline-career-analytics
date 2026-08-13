export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Method not allowed" } });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: { message: "Server is missing ANTHROPIC_API_KEY. Set it in Vercel project settings." }
    });
  }

  // Abort the upstream call rather than letting the function hang until the
  // platform kills it. A hung request is the hardest failure mode to diagnose.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(req.body),
      signal: controller.signal
    });

    const data = await response.json();

    // Pass the upstream status through. The previous version returned 200 for
    // every response, which masked model-retirement and auth errors as success.
    if (!response.ok) {
      console.error("Anthropic API error", response.status, JSON.stringify(data));
      return res.status(response.status).json({
        error: {
          message: data?.error?.message || `Anthropic API returned ${response.status}.`,
          type: data?.error?.type || "upstream_error",
          status: response.status
        }
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    const aborted = error.name === "AbortError";
    console.error("analyze handler failure", error);
    return res.status(aborted ? 504 : 500).json({
      error: {
        message: aborted
          ? "The analysis request timed out after 55 seconds."
          : error.message,
        type: aborted ? "timeout_error" : "handler_error"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}
