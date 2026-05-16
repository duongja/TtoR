import { createVercelRuntime } from "../src/deployment.js";

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
    return json(await runtime.repository.getHealthSnapshot(runtime.config));
  } finally {
    await runtime.repository.close();
  }
}
