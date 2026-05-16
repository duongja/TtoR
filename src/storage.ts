import { createRequire } from "node:module";

import type {
  AppConfig
} from "./config.js";
import { getRepositoryHealthSnapshot, type PostRepository } from "./repository.js";
import type {
  HealthSnapshot,
  NormalizedPost,
  PollRunInput,
  PollRunRecord,
  StoredPost
} from "./types.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

function parseJson<T>(value: string | null): T {
  if (!value) {
    return [] as T;
  }
  return JSON.parse(value) as T;
}

function rowToStoredPost(row: Record<string, unknown>): StoredPost {
  return {
    postId: String(row.post_id),
    authorHandle: String(row.author_handle),
    authorDisplayName: row.author_display_name ? String(row.author_display_name) : null,
    createdAt: row.created_at ? String(row.created_at) : null,
    detectedAt: String(row.detected_at),
    text: String(row.text),
    lang: row.lang ? String(row.lang) : null,
    conversationId: row.conversation_id ? String(row.conversation_id) : null,
    replyToPostId: row.reply_to_post_id ? String(row.reply_to_post_id) : null,
    quotedPostId: row.quoted_post_id ? String(row.quoted_post_id) : null,
    isRepost: Number(row.is_repost) === 1,
    media: parseJson(row.media_json as string | null),
    rawPayload: parseJson(row.raw_payload_json as string | null),
    insertedAt: String(row.inserted_at)
  };
}

function rowToPollRun(row: Record<string, unknown>): PollRunRecord {
  return {
    id: Number(row.id),
    startedAt: String(row.started_at),
    finishedAt: String(row.finished_at),
    status: String(row.status) as PollRunRecord["status"],
    newPostsCount: Number(row.new_posts_count),
    errorCode: row.error_code ? String(row.error_code) as PollRunRecord["errorCode"] : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    latestPostId: row.latest_post_id ? String(row.latest_post_id) : null,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json as string | null)
  };
}

export class Repository implements PostRepository {
  private readonly insertPostStatement;
  private readonly insertPollRunStatement;
  private readonly latestPostStatement;
  private readonly postsSinceStatement;
  private readonly postsSinceCreatedAtStatement;
  private readonly latestPollStatement;
  private readonly latestSuccessfulPollStatement;

  public constructor(private readonly db: DatabaseSyncInstance) {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS posts (
        post_id TEXT PRIMARY KEY,
        author_handle TEXT NOT NULL,
        author_display_name TEXT,
        created_at TEXT,
        detected_at TEXT NOT NULL,
        text TEXT NOT NULL,
        lang TEXT,
        conversation_id TEXT,
        reply_to_post_id TEXT,
        quoted_post_id TEXT,
        is_repost INTEGER NOT NULL DEFAULT 0,
        media_json TEXT NOT NULL,
        raw_payload_json TEXT NOT NULL,
        inserted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_posts_detected_at ON posts(detected_at DESC);
      CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);

      CREATE TABLE IF NOT EXISTS poll_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        status TEXT NOT NULL,
        new_posts_count INTEGER NOT NULL,
        error_code TEXT,
        error_message TEXT,
        latest_post_id TEXT,
        metadata_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_poll_runs_finished_at ON poll_runs(finished_at DESC);
    `);

    this.insertPostStatement = this.db.prepare(`
      INSERT OR IGNORE INTO posts (
        post_id,
        author_handle,
        author_display_name,
        created_at,
        detected_at,
        text,
        lang,
        conversation_id,
        reply_to_post_id,
        quoted_post_id,
        is_repost,
        media_json,
        raw_payload_json
      ) VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      )
    `);

    this.insertPollRunStatement = this.db.prepare(`
      INSERT INTO poll_runs (
        started_at,
        finished_at,
        status,
        new_posts_count,
        error_code,
        error_message,
        latest_post_id,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.latestPostStatement = this.db.prepare(`
      SELECT *
      FROM posts
      ORDER BY COALESCE(created_at, detected_at) DESC, post_id DESC
      LIMIT 1
    `);

    this.postsSinceStatement = this.db.prepare(`
      SELECT *
      FROM posts
      WHERE detected_at > ?
      ORDER BY detected_at ASC, post_id ASC
    `);

    this.postsSinceCreatedAtStatement = this.db.prepare(`
      SELECT *
      FROM posts
      WHERE datetime(COALESCE(created_at, detected_at)) >= datetime(?)
      ORDER BY datetime(COALESCE(created_at, detected_at)) ASC, post_id ASC
    `);

    this.latestPollStatement = this.db.prepare(`
      SELECT *
      FROM poll_runs
      ORDER BY finished_at DESC, id DESC
      LIMIT 1
    `);

    this.latestSuccessfulPollStatement = this.db.prepare(`
      SELECT *
      FROM poll_runs
      WHERE status = 'success'
      ORDER BY finished_at DESC, id DESC
      LIMIT 1
    `);
  }

  public static open(databasePath: string): Repository {
    const db = new DatabaseSync(databasePath);
    return new Repository(db);
  }

  public close(): void {
    this.db.close();
  }

  public recordPollRun(input: PollRunInput): { newPostsCount: number; latestPostId: string | null } {
    const posts = input.posts ?? [];
    let newPostsCount = 0;

    this.db.exec("BEGIN");

    try {
      for (const post of posts) {
        const result = this.insertPostStatement.run(
          post.postId,
          post.authorHandle,
          post.authorDisplayName,
          post.createdAt,
          post.detectedAt,
          post.text,
          post.lang,
          post.conversationId,
          post.replyToPostId,
          post.quotedPostId,
          post.isRepost ? 1 : 0,
          JSON.stringify(post.media),
          JSON.stringify(post.rawPayload)
        );

        newPostsCount += Number(result.changes ?? 0);
      }

      const latestPostId = posts[0]?.postId ?? this.getLatestPost()?.postId ?? null;
      this.insertPollRunStatement.run(
        input.startedAt,
        input.finishedAt,
        input.status,
        newPostsCount,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        latestPostId,
        JSON.stringify(input.metadata ?? {})
      );

      this.db.exec("COMMIT");
      return { newPostsCount, latestPostId };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  public getLatestPost(): StoredPost | null {
    const row = this.latestPostStatement.get() as Record<string, unknown> | undefined;
    return row ? rowToStoredPost(row) : null;
  }

  public getPostsSinceDetectedAt(sinceDetectedAt: string): StoredPost[] {
    const rows = this.postsSinceStatement.all(sinceDetectedAt) as Record<string, unknown>[];
    return rows.map(rowToStoredPost);
  }

  public getPostsSinceCreatedAt(sinceCreatedAt: string): StoredPost[] {
    const rows = this.postsSinceCreatedAtStatement.all(sinceCreatedAt) as Record<string, unknown>[];
    return rows.map(rowToStoredPost);
  }

  public getLatestPoll(): PollRunRecord | null {
    const row = this.latestPollStatement.get() as Record<string, unknown> | undefined;
    return row ? rowToPollRun(row) : null;
  }

  public getLatestSuccessfulPoll(): PollRunRecord | null {
    const row = this.latestSuccessfulPollStatement.get() as Record<string, unknown> | undefined;
    return row ? rowToPollRun(row) : null;
  }

  public async getHealthSnapshot(config: Pick<AppConfig, "targetHandle">, now = new Date()): Promise<HealthSnapshot> {
    return getRepositoryHealthSnapshot(this, config, now);
  }
}
