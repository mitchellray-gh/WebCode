import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EmptyRepositoryError,
  GitHub,
  parseRepository,
  validBranch,
} from "../src/github.ts";

test("repository and branch boundaries reject arbitrary hosts and unsafe refs", () => {
  assert.deepEqual(parseRepository("https://github.com/example/project.git"), {
    owner: "example",
    name: "project",
  });
  for (const value of [
    "https://evil.test/repo",
    "owner/repo/tree/main",
    "../..",
    "",
  ])
    assert.throws(() => parseRepository(value));
  assert.ok(validBranch("work/fix-issue"));
  for (const branch of [
    "main..x",
    ".hidden",
    "work/.hidden",
    "a.lock",
    "HEAD",
    "bad name",
    "work/",
    "a@{b",
  ])
    assert.equal(validBranch(branch), false);
});

const repo = {
  owner: "owner",
  name: "repo",
  branch: "main",
  head: "head",
  tree: "tree",
  files: [{ path: "main.ts", sha: "old", mode: "100644" }],
};
test("publishing creates one atomic new branch only after blobs, tree and commit", async () => {
  const calls = [];
  const client = new GitHub("test-only-token", async (url, options) => {
    calls.push({ url, options });
    assert.ok(url.startsWith("https://api.github.com/repos/owner/repo/"));
    assert.equal(options.headers.Authorization, "Bearer test-only-token");
    return new Response(
      JSON.stringify(
        options.method === "GET" ? { object: { sha: "head" } } : { sha: "new" },
      ),
      { status: 200 },
    );
  });
  const url = await client.publish(repo, "work/fix", "Fix", [
    { path: "main.ts", content: "new code" },
  ]);
  assert.match(url, /compare\/main\.\.\.work%2Ffix/);
  assert.deepEqual(
    calls.map((call) => call.options.method),
    ["GET", "POST", "POST", "POST", "POST"],
  );
  assert.equal(
    JSON.parse(calls.at(-1).options.body).ref,
    "refs/heads/work/fix",
  );
  assert.ok(calls.every((call) => call.options.method !== "PATCH"));
});

test("changed source head prevents any writes and missing token fails before API access", async () => {
  const calls = [];
  const client = new GitHub("test-only-token", async (_, options) => {
    calls.push(options.method);
    return new Response(JSON.stringify({ object: { sha: "changed-head" } }), {
      status: 200,
    });
  });
  await assert.rejects(
    client.publish(repo, "work/fix", "Fix", [
      { path: "main.ts", content: "new" },
    ]),
    /Source branch changed/,
  );
  assert.deepEqual(calls, ["GET"]);
  await assert.rejects(
    new GitHub().publish(repo, "work/fix", "Fix", []),
    /token/,
  );
});

test("binary file contents are rejected rather than corrupted", async () => {
  const client = new GitHub(
    "",
    async () =>
      new Response(
        JSON.stringify({ size: 2, encoding: "base64", content: "AAA=" }),
      ),
  );
  await assert.rejects(client.read(repo, repo.files[0]), /Binary/);
});

test("default browser transport keeps the required global receiver", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async function () {
      assert.equal(this, globalThis);
      return new Response(
        JSON.stringify({ size: 3, encoding: "base64", content: "b2sK" }),
      );
    };
    assert.equal(await new GitHub().read(repo, repo.files[0]), "ok\n");
  } finally {
    globalThis.fetch = original;
  }
});

test("409 on an empty repository explains the cause instead of asking to retry", async () => {
  const client = new GitHub("", async (url) =>
    url.endsWith("/repos/owner/empty")
      ? new Response(JSON.stringify({ default_branch: "main" }))
      : new Response(JSON.stringify({ message: "Git Repository is empty." }), {
          status: 409,
        }),
  );
  await assert.rejects(client.open("owner/empty"), /empty \(no commits yet\)/);
});

test("other 409 conflicts surface GitHub's message and never suggest a blind retry", async () => {
  const client = new GitHub(
    "",
    async () =>
      new Response(
        JSON.stringify({ message: "Update is not a fast forward" }),
        {
          status: 409,
        },
      ),
  );
  await assert.rejects(client.open("owner/repo"), (error) => {
    assert.match(error.message, /Conflict \(Update is not a fast forward\)/);
    assert.doesNotMatch(error.message, /Please retry/);
    return true;
  });
  const noBody = new GitHub("", async () => new Response("", { status: 409 }));
  await assert.rejects(noBody.open("owner/repo"), /GitHub 409: Conflict\./);
});

test("empty repositories raise a typed error the app can act on", async () => {
  const client = new GitHub("", async (url) =>
    url.endsWith("/repos/owner/empty")
      ? new Response(JSON.stringify({ default_branch: "main" }))
      : new Response(JSON.stringify({ message: "Git Repository is empty." }), {
          status: 409,
        }),
  );
  await assert.rejects(client.open("owner/empty"), EmptyRepositoryError);
});

test("initialize creates a README first commit through the Contents API", async () => {
  const calls = [];
  const client = new GitHub("test-only-token", async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ content: {} }), { status: 201 });
  });
  await client.initialize("owner/empty");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api.github.com/repos/owner/empty/contents/README.md",
  );
  assert.equal(calls[0].options.method, "PUT");
  assert.equal(
    calls[0].options.headers.Authorization,
    "Bearer test-only-token",
  );
  const body = JSON.parse(calls[0].options.body);
  assert.equal(
    atob(body.content),
    "# empty\n\nStarted with technicalskills.\n",
  );
  assert.equal(body.branch, undefined);
});

test("initialize refuses without a token before any network call", async () => {
  let calls = 0;
  const client = new GitHub("", async () => {
    calls++;
    return new Response("{}");
  });
  await assert.rejects(client.initialize("owner/empty"), /token/);
  assert.equal(calls, 0);
});
