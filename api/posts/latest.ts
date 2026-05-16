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

export async function GET(): Promise<Response> {
  const runtime = createVercelRuntime();

  try {
    const latestPost = await runtime.repository.getLatestPost();
    if (!latestPost) {
      return json({ error: "No posts have been ingested yet" }, { status: 404 });
    }

    return json(latestPost);
  } finally {
    await runtime.repository.close();
  }
}
