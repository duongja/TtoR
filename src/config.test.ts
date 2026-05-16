import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("accepts Postgres DATABASE_URL for serverless deployments", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://user:password@example.com:5432/postgres"
    });

    expect(config.databaseUrl).toBe("postgresql://user:password@example.com:5432/postgres");
    expect(config.databasePath).toMatch(/data\/app\.db$/);
  });
});
