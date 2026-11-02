import { test } from "node:test";
import assert from "node:assert/strict";
import { neonConfig } from "@neondatabase/serverless";
import handler from "../api/workspace.ts";
import { DEFAULT_MODEL_ID } from "../src/models.ts";

test("private cloud API authenticates, validates, saves and rejects stale revisions", async () => {
  const oldDatabase = process.env.DATABASE_URL;
  const oldKey = process.env.WORKSPACE_ACCESS_KEY;
  const oldFetch = neonConfig.fetchFunction;
  const key = "test-only-private-workspace-key-0000000000";
  process.env.DATABASE_URL = "postgresql://test:test@database.example.test/neondb";
  process.env.WORKSPACE_ACCESS_KEY = key;
  let queries = 0;
  let stored = null;
  let revision = 0;
  neonConfig.fetchFunction = async (_url, init) => {
    queries++;
    const { query, params } = JSON.parse(init.body);
    let rows = [];
    let fields = [{ name: "revision", dataTypeID: 23 }];
    if (query.startsWith("SELECT")) {
      fields = [{ name: "snapshot", dataTypeID: 3802 }, ...fields];
      rows = stored ? [[JSON.stringify(stored), String(revision)]] : [];
    } else if (query.startsWith("INSERT")) {
      if (!stored) {
        stored = JSON.parse(params[0]);
        revision = 1;
        rows = [["1"]];
      }
    } else if (query.startsWith("UPDATE") && Number(params[1]) === revision) {
      stored = JSON.parse(params[0]);
      rows = [[String(++revision)]];
    }
    return new Response(JSON.stringify({ fields, rows, rowCount: rows.length, command: "SELECT", rowAsArray: true }), { status: 200 });
  };
  const request = async (method, body, authorization = `Bearer ${key}`) => {
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(value) { this.body = JSON.parse(value); },
    };
    await handler({ method, headers: { authorization }, body }, response);
    assert.equal(response.headers["Cache-Control"], "no-store");
    return response;
  };
  const session = {
    version: 1, files: { "app.txt": { content: "Hello" } }, active: "app.txt",
    transcript: [], memory: { nodes: [], recent: [] }, pinned: "", notes: "Next steps",
    request: "", mode: "edit", model: DEFAULT_MODEL_ID, proposal: null,
  };
  try {
    assert.equal((await request("GET", undefined, "wrong")).statusCode, 401);
    assert.equal(queries, 0);
    assert.equal((await request("DELETE")).statusCode, 405);
    assert.equal((await request("PUT", { session, revision: -1 })).statusCode, 400);
    assert.equal((await request("PUT", { session: { ...session, notes: 10 }, revision: 0 })).statusCode, 400);
    assert.equal(queries, 0);
    assert.deepEqual((await request("GET")).body, { session: null, revision: 0 });
    assert.equal((await request("PUT", { session: { ...session, token: "excluded" }, revision: 0 })).body.revision, 1);
    assert.ok(!Object.hasOwn(stored, "token"));
    assert.equal((await request("PUT", { session, revision: 0 })).statusCode, 409);
    assert.equal((await request("PUT", { session, revision: 1 })).body.revision, 2);
    assert.equal((await request("PUT", { session, revision: 1 })).statusCode, 409);
    assert.equal((await request("GET")).body.session.notes, "Next steps");
    delete process.env.DATABASE_URL;
    assert.equal((await request("GET")).statusCode, 503);
  } finally {
    if (oldDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldDatabase;
    if (oldKey === undefined) delete process.env.WORKSPACE_ACCESS_KEY; else process.env.WORKSPACE_ACCESS_KEY = oldKey;
    neonConfig.fetchFunction = oldFetch;
  }
});
