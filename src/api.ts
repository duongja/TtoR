import { createServer, type Server } from "node:http";

import type { AppConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { Repository } from "./storage.js";

function jsonResponse(statusCode: number, body: unknown): ResponseInit {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(body, null, 2)
  };
}

interface ResponseInit {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function send(response: import("node:http").ServerResponse, init: ResponseInit): void {
  response.writeHead(init.statusCode, init.headers);
  response.end(init.body);
}

export function startApiServer(
  repository: Repository,
  config: AppConfig,
  logger: Logger
): Promise<Server> {
  const server = createServer((request, response) => {
    if (!request.url || !request.method) {
      send(response, jsonResponse(400, { error: "Missing request URL" }));
      return;
    }

    const url = new URL(request.url, `http://${config.apiHost}:${config.apiPort}`);

    if (request.method !== "GET") {
      send(response, jsonResponse(405, { error: "Method not allowed" }));
      return;
    }

    if (url.pathname === "/health") {
      send(response, jsonResponse(200, repository.getHealthSnapshot(config)));
      return;
    }

    if (url.pathname === "/posts/latest") {
      const latestPost = repository.getLatestPost();
      if (!latestPost) {
        send(response, jsonResponse(404, { error: "No posts have been ingested yet" }));
        return;
      }

      send(response, jsonResponse(200, latestPost));
      return;
    }

    if (url.pathname === "/posts") {
      const sinceDetectedAt = url.searchParams.get("since_detected_at");
      const sinceCreatedAt = url.searchParams.get("since_created_at");
      if (!sinceDetectedAt && !sinceCreatedAt) {
        send(response, jsonResponse(400, { error: "since_detected_at or since_created_at query parameter is required" }));
        return;
      }

      if (sinceDetectedAt && sinceCreatedAt) {
        send(response, jsonResponse(400, { error: "Use only one of since_detected_at or since_created_at" }));
        return;
      }

      const since = sinceCreatedAt ?? sinceDetectedAt;
      const parsedDate = since ? Date.parse(since) : Number.NaN;
      if (Number.isNaN(parsedDate)) {
        send(response, jsonResponse(400, { error: "Timestamp query parameter must be an ISO timestamp" }));
        return;
      }

      const normalizedSince = new Date(parsedDate).toISOString();
      const posts = sinceCreatedAt
        ? repository.getPostsSinceCreatedAt(normalizedSince)
        : repository.getPostsSinceDetectedAt(normalizedSince);

      send(response, jsonResponse(200, posts));
      return;
    }

    send(response, jsonResponse(404, { error: "Not found" }));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.apiPort, config.apiHost, () => {
      logger.info("API server listening", {
        host: config.apiHost,
        port: config.apiPort
      });
      server.off("error", reject);
      resolve(server);
    });
  });
}
