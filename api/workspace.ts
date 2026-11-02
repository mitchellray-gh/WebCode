import { createHash, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { IncomingMessage, ServerResponse } from "node:http";
import { MAX_SESSION_BYTES, readSession } from "../src/session.ts";

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.end(JSON.stringify(body));
  };
  const key = process.env.WORKSPACE_ACCESS_KEY;
  const database = process.env.DATABASE_URL;
  if (!key || key.length < 32 || !database)
    return send(503, { error: "Cloud saves are not configured. Set DATABASE_URL and a WORKSPACE_ACCESS_KEY of at least 32 characters on Vercel." });
  const supplied = req.headers.authorization || "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(supplied), digest(`Bearer ${key}`)))
    return send(401, { error: "Invalid workspace access key." });
  if (req.method !== "GET" && req.method !== "PUT") {
    res.setHeader("Allow", "GET, PUT");
    return send(405, { error: "Method not allowed." });
  }
  let session;
  let revision = 0;
  if (req.method === "PUT") {
    try {
      const body: unknown = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!body || typeof body !== "object" || !("session" in body) || !("revision" in body))
        throw new Error("A session and revision are required.");
      if (typeof body.revision !== "number" || !Number.isSafeInteger(body.revision) || body.revision < 0)
        throw new Error("Invalid workspace revision.");
      revision = body.revision;
      if (Buffer.byteLength(JSON.stringify(body.session)) > MAX_SESSION_BYTES)
        return send(413, { error: "Cloud save exceeds 3 MB. Download a ZIP." });
      session = readSession(body.session);
    } catch (error) {
      return send(400, { error: error instanceof Error ? error.message : "Invalid workspace." });
    }
  }
  try {
    const sql = neon(database);
    if (req.method === "GET") {
      const rows = await sql`SELECT snapshot, revision FROM workspace_saves WHERE id = 'private'`;
      return send(200, rows.length ? { session: rows[0].snapshot, revision: rows[0].revision } : { session: null, revision: 0 });
    }
    const rows = revision === 0
      ? await sql`INSERT INTO workspace_saves (id, snapshot, revision) VALUES ('private', ${JSON.stringify(session)}::jsonb, 1) ON CONFLICT (id) DO NOTHING RETURNING revision`
      : await sql`UPDATE workspace_saves SET snapshot = ${JSON.stringify(session)}::jsonb, revision = revision + 1, updated_at = now() WHERE id = 'private' AND revision = ${revision} RETURNING revision`;
    if (!rows.length)
      return send(409, { error: "Cloud workspace changed on another device. Disconnect and reconnect to load it before saving again. Export local edits first." });
    return send(200, { revision: rows[0].revision });
  } catch (error) {
    console.error("Workspace database operation failed", error instanceof Error ? error.name : "UnknownError");
    return send(503, { error: "Cloud database unavailable. Check the Neon connection and workspace_saves table; local recovery is independent." });
  }
}
