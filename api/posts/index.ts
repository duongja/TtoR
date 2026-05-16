import { createVercelRuntime } from "../../src/deployment.js";

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {})
    }
  });
}

export async function GET(request: Request): Promise<Response> {
  const runtime = createVercelRuntime();

  try {
    const url = new URL(request.url);
    const sinceDetectedAt = url.searchParams.get("since_detected_at");
    const sinceCreatedAt = url.searchParams.get("since_created_at");

    if (!sinceDetectedAt && !sinceCreatedAt) {
      return json({ error: "since_detected_at or since_created_at query parameter is required" }, { status: 400 });
    }

    if (sinceDetectedAt && sinceCreatedAt) {
      return json({ error: "Use only one of since_detected_at or since_created_at" }, { status: 400 });
    }

    const since = sinceCreatedAt ?? sinceDetectedAt;
    const parsedDate = since ? Date.parse(since) : Number.NaN;
    if (Number.isNaN(parsedDate)) {
      return json({ error: "Timestamp query parameter must be an ISO timestamp" }, { status: 400 });
    }

    const normalizedSince = new Date(parsedDate).toISOString();
    const posts = sinceCreatedAt
      ? await runtime.repository.getPostsSinceCreatedAt(normalizedSince)
      : await runtime.repository.getPostsSinceDetectedAt(normalizedSince);

    return json(posts);
  } finally {
    await runtime.repository.close();
  }
}
