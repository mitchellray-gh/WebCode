export type RepoFile = {
  path: string;
  sha: string;
  mode: string;
  size?: number;
};
export type Repository = {
  owner: string;
  name: string;
  branch: string;
  head: string;
  tree: string;
  files: RepoFile[];
};
type Fetcher = typeof fetch;
export type Issue = { number: number; title: string; body: string; comments: string[]; url: string };
export type PullRequest = {
  number: number; title: string; body: string; base: string; head: string;
  files: { path: string; status: string; patch: string }[];
  omitted: number;
};

export function parseRepository(value: string) {
  let slug = value.trim().replace(/\/$/, "");
  if (slug.startsWith("https://github.com/"))
    slug = slug.slice("https://github.com/".length);
  slug = slug.replace(/\.git$/, "");
  const parts = slug.split("/");
  if (
    parts.length !== 2 ||
    !/^[\w-]+$/.test(parts[0]) ||
    !/^[\w.-]+$/.test(parts[1]) ||
    [".", ".."].includes(parts[1])
  ) {
    throw new Error("Enter owner/repository or a GitHub repository URL.");
  }
  return { owner: parts[0], name: parts[1] };
}

export function validBranch(branch: string) {
  return (
    branch.length > 0 &&
    branch.length <= 160 &&
    branch !== "HEAD" &&
    !Array.from(branch).some(
      (character) =>
        character.charCodeAt(0) < 33 ||
        character.charCodeAt(0) === 127 ||
        "~^:?*[\\".includes(character),
    ) &&
    !/\s/.test(branch) &&
    !branch.includes("..") &&
    !branch.includes("@{") &&
    branch
      .split("/")
      .every(
        (part) =>
          part.length > 0 &&
          !part.startsWith(".") &&
          !part.endsWith(".") &&
          !part.endsWith(".lock"),
      )
  );
}

// Returns an error message, or "" when a new file path is safe to create.
export function validateNewPath(path: string, existing: string[]) {
  if (!path || path.length > 200)
    return "Enter a file path up to 200 characters.";
  if (
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    path.includes(":") ||
    Array.from(path).some((character) => character.charCodeAt(0) < 32)
  )
    return "Use a relative path like src/app.ts (no leading or trailing slash, backslash or colon).";
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.toLowerCase() === ".git" ||
        segment !== segment.trim(),
    )
  )
    return "That path has an empty, relative (. or ..), .git or space-padded part.";
  if (existing.includes(path)) return `${path} already exists.`;
  if (existing.some((other) => other.startsWith(`${path}/`)))
    return `${path} is already a folder.`;
  if (
    segments
      .slice(0, -1)
      .some((_, index) =>
        existing.includes(segments.slice(0, index + 1).join("/")),
      )
  )
    return "A parent of that path is an existing file.";
  return "";
}

// GitHub pre-fills the fine-grained token form from these query parameters.
export const TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new?name=technicalskills&description=Browser+editor%3A+read+and+write+repository+contents%2C+open+pull+requests&expires_in=30&contents=write&pull_requests=write&issues=read";

export class EmptyRepositoryError extends Error {
  constructor() {
    super(
      "GitHub 409: This repository is empty (no commits yet). Add a first commit, such as a README, on GitHub and open it again.",
    );
    this.name = "EmptyRepositoryError";
  }
}

export class GitHub {
  private token: string;
  private fetcher: Fetcher;

  constructor(
    token = "",
    fetcher: Fetcher = globalThis.fetch.bind(globalThis),
  ) {
    this.token = token.trim();
    this.fetcher = fetcher;
  }

  private async request(path: string, method = "GET", body?: unknown) {
    const response = await this.fetcher(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    if (!response.ok) {
      if (response.status === 409) {
        const detail = await response
          .json()
          .then((body: { message?: unknown }) => String(body.message ?? ""))
          .catch(() => "");
        throw /empty/i.test(detail)
          ? new EmptyRepositoryError()
          : new Error(
              `GitHub 409: Conflict${detail ? ` (${detail.slice(0, 160)})` : ""}. Reopen the repository to refresh, then try again.`,
            );
      }
      throw new Error(
        `GitHub ${response.status}: ${response.status === 401 ? "Check your token." : response.status === 403 ? "Permission denied or API rate limit reached." : response.status === 404 ? "Repository, branch or file not found; private repositories need a token." : response.status === 422 ? "Invalid request or branch already exists. Choose a new branch name." : "Request failed. Please retry."}`,
      );
    }
    return response.json();
  }

  private base(repo: Pick<Repository, "owner" | "name">) {
    return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  }

  // The Git Data API rejects empty repos; the Contents API can create the first commit.
  async initialize(value: string) {
    if (!this.token)
      throw new Error(
        "A GitHub token with repository Contents write permission is required to create a README.",
      );
    const repo = parseRepository(value);
    const readme = `# ${repo.name}\n\nStarted with technicalskills.\n`;
    await this.request(`${this.base(repo)}/contents/README.md`, "PUT", {
      message: "Add README",
      content: btoa(readme),
    });
  }

  async open(value: string, requestedBranch = ""): Promise<Repository> {
    const repo = parseRepository(value);
    const base = this.base(repo);
    const metadata = await this.request(base);
    const branch = requestedBranch.trim() || metadata.default_branch;
    if (!validBranch(branch)) throw new Error("Invalid branch name.");
    const reference = await this.request(
      `${base}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    const commit = await this.request(
      `${base}/git/commits/${reference.object.sha}`,
    );
    const tree = await this.request(
      `${base}/git/trees/${commit.tree.sha}?recursive=1`,
    );
    if (tree.truncated)
      throw new Error(
        "Repository tree is too large for this lightweight client. Open a smaller repository.",
      );
    const files: RepoFile[] = tree.tree.filter(
      (entry: { type: string; mode: string }) =>
        entry.type === "blob" && ["100644", "100755"].includes(entry.mode),
    );
    return {
      ...repo,
      branch,
      head: reference.object.sha,
      tree: commit.tree.sha,
      files,
    };
  }

  async listIssues(repo: Pick<Repository, "owner" | "name">): Promise<{ number: number; title: string }[]> {
    const items: unknown = await this.request(`${this.base(repo)}/issues?state=open&per_page=15`);
    if (!Array.isArray(items)) throw new Error("GitHub returned an unexpected issue list.");
    return items
      .filter((item: { pull_request?: unknown }) => !item.pull_request)
      .map((item: { number?: unknown; title?: unknown }) => ({ number: Number(item.number), title: String(item.title ?? "").slice(0, 120) }))
      .filter((item) => Number.isInteger(item.number));
  }

  async readIssue(repo: Pick<Repository, "owner" | "name">, number: number): Promise<Issue> {
    if (!Number.isInteger(number) || number < 1 || number > 9_999_999) throw new Error("Enter a valid issue number.");
    const base = `${this.base(repo)}/issues/${number}`;
    const issue: { title?: unknown; body?: unknown; pull_request?: unknown; html_url?: unknown } = await this.request(base);
    if (issue.pull_request) throw new Error(`#${number} is a pull request, not an issue. Use /review ${number}.`);
    const comments: unknown = await this.request(`${base}/comments?per_page=5`);
    return {
      number,
      title: String(issue.title ?? "").slice(0, 200),
      body: String(issue.body ?? "").slice(0, 4000),
      comments: Array.isArray(comments) ? comments.map((comment: { body?: unknown }) => String(comment.body ?? "").slice(0, 600)) : [],
      url: String(issue.html_url ?? ""),
    };
  }

  async readPullRequest(repo: Pick<Repository, "owner" | "name">, number: number): Promise<PullRequest> {
    if (!Number.isInteger(number) || number < 1 || number > 9_999_999) throw new Error("Enter a valid pull request number.");
    const base = `${this.base(repo)}/pulls/${number}`;
    const pr: { title?: unknown; body?: unknown; base?: { ref?: unknown }; head?: { ref?: unknown } } = await this.request(base);
    const list: unknown = await this.request(`${base}/files?per_page=30`);
    if (!Array.isArray(list)) throw new Error("GitHub returned an unexpected file list.");
    const files = list
      .filter((file: { filename?: unknown; patch?: unknown }) => typeof file.filename === "string" && typeof file.patch === "string")
      .map((file: { filename: string; status?: unknown; patch: string }) => ({
        path: file.filename, status: String(file.status ?? "modified"), patch: file.patch.slice(0, 20000),
      }));
    return {
      number,
      title: String(pr.title ?? "").slice(0, 200),
      body: String(pr.body ?? "").slice(0, 1500),
      base: String(pr.base?.ref ?? ""),
      head: String(pr.head?.ref ?? ""),
      files,
      omitted: list.length - files.length,
    };
  }

  /** Posts a plain comment on a pull request. Always a deliberate user action. */
  async commentOnPullRequest(repo: Pick<Repository, "owner" | "name">, number: number, body: string): Promise<string> {
    if (!this.token) throw new Error("A GitHub token with Pull requests write permission is required to comment.");
    if (!Number.isInteger(number) || number < 1 || number > 9_999_999) throw new Error("Enter a valid pull request number.");
    if (!body.trim()) throw new Error("There is no review text to post.");
    const created: { html_url?: unknown } = await this.request(`${this.base(repo)}/issues/${number}/comments`, "POST", {
      body: body.slice(0, 20000),
    });
    return typeof created.html_url === "string" ? created.html_url : "";
  }

  /** Opens a pull request from an already-published branch. Needs a token with Pull requests write permission. */
  async openPullRequest(
    repo: Pick<Repository, "owner" | "name">,
    request: { head: string; base: string; title: string; body?: string },
  ): Promise<{ number: number; url: string }> {
    if (!this.token) throw new Error("A GitHub token with Pull requests write permission is required.");
    if (!validBranch(request.head) || !validBranch(request.base) || request.head === request.base)
      throw new Error("Choose a valid published branch that differs from the base branch.");
    if (!request.title.trim() || request.title.length > 200) throw new Error("Enter a pull request title of 1-200 characters.");
    const created: { number?: unknown; html_url?: unknown } = await this.request(`${this.base(repo)}/pulls`, "POST", {
      title: request.title.trim(),
      head: request.head,
      base: request.base,
      body: (request.body ?? "").slice(0, 4000),
    });
    if (typeof created.number !== "number" || typeof created.html_url !== "string")
      throw new Error("GitHub returned an unexpected pull request response.");
    return { number: created.number, url: created.html_url };
  }

  // GitHub code search always requires authentication; it finds files by content without downloading the repository.
  async searchCode(repo: Pick<Repository, "owner" | "name">, query: string): Promise<string[]> {
    if (!this.token) throw new Error("GitHub code search needs a token.");
    const words = query.replace(/[^\w\s.-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
    if (!words) return [];
    const result: unknown = await this.request(
      `/search/code?q=${encodeURIComponent(`${words} repo:${repo.owner}/${repo.name}`)}&per_page=5`,
    );
    const items = (result as { items?: unknown }).items;
    if (!Array.isArray(items)) throw new Error("GitHub returned an unexpected search response.");
    return items.map((item: { path?: unknown }) => item.path).filter((path): path is string => typeof path === "string");
  }

  async read(repo: Repository, file: RepoFile) {
    if (file.size && file.size > 512000)
      throw new Error("File exceeds the 500 KB editor limit.");
    const blob = await this.request(`${this.base(repo)}/git/blobs/${file.sha}`);
    if (blob.encoding !== "base64" || blob.size > 512000)
      throw new Error("File is too large or uses an unsupported encoding.");
    const decoded = Uint8Array.from(
      atob(blob.content.replace(/\s/g, "")),
      (character) => character.charCodeAt(0),
    );
    if (decoded.includes(0)) throw new Error("Binary files cannot be edited.");
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(decoded);
    } catch {
      throw new Error("This file is not valid UTF-8 text.");
    }
  }

  async publish(
    repo: Repository,
    branch: string,
    message: string,
    changes: { path: string; content: string }[],
    destination: "new-branch" | "main" = "new-branch",
  ) {
    if (!this.token)
      throw new Error(
        "A GitHub token with repository Contents write permission is required.",
      );
    if (destination === "main" && (repo.branch !== "main" || branch !== "main"))
      throw new Error(
        "Open the main branch before publishing directly to main.",
      );
    if (
      destination === "new-branch" &&
      (!validBranch(branch) || branch === repo.branch)
    )
      throw new Error(
        "Choose a valid new branch, different from the source branch.",
      );
    if (!message.trim() || message.length > 200)
      throw new Error("Enter a commit message of 1-200 characters.");
    if (!changes.length) throw new Error("No file changes to publish.");
    if (new Set(changes.map((change) => change.path)).size !== changes.length)
      throw new Error("Duplicate changed file.");
    const base = this.base(repo);
    const head = await this.request(
      `${base}/git/ref/heads/${encodeURIComponent(repo.branch)}`,
    );
    if (head.object.sha !== repo.head)
      throw new Error(
        "Source branch changed on GitHub. Download your edits, then reopen the repository before publishing.",
      );
    const tree = [];
    const existingPaths = repo.files.map((file) => file.path);
    for (const change of changes) {
      const original = repo.files.find((file) => file.path === change.path);
      if (!original) {
        const problem = validateNewPath(change.path, existingPaths);
        if (problem) throw new Error(`Cannot add ${change.path}: ${problem}`);
      }
      const blob = await this.request(`${base}/git/blobs`, "POST", {
        content: change.content,
        encoding: "utf-8",
      });
      tree.push({
        path: change.path,
        mode: original?.mode ?? "100644",
        type: "blob",
        sha: blob.sha,
      });
    }
    const nextTree = await this.request(`${base}/git/trees`, "POST", {
      base_tree: repo.tree,
      tree,
    });
    const commit = await this.request(`${base}/git/commits`, "POST", {
      message: message.trim(),
      tree: nextTree.sha,
      parents: [repo.head],
    });
    if (destination === "main") {
      await this.request(`${base}/git/refs/heads/main`, "PATCH", {
        sha: commit.sha,
        force: false,
      });
      return `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/commit/${commit.sha}`;
    }
    await this.request(`${base}/git/refs`, "POST", {
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    });
    return `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/compare/${encodeURIComponent(repo.branch)}...${encodeURIComponent(branch)}?expand=1`;
  }
}
