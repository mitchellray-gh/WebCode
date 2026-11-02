# technicalskills

A lightweight browser coding workspace using React, CodeMirror, GitHub REST API, and WebLLM. No hosted AI inference. Optional private Neon saves use a Vercel API function; inference stays in your browser. Manual review-first edits by default, with an opt-in goal-driven local coding loop.

## Run

Requires Node.js 24+ for TypeScript tests, and current Chrome or Edge with WebGPU and hardware acceleration for inference. Mobile GPU compatibility is not guaranteed.

```sh
npm install
npm test
npm run build
npm run dev -- --host 127.0.0.1
```

Open the localhost URL printed by Vite. WebGPU requires localhost or HTTPS. The mobile layout is supported; mobile GPU compatibility is not guaranteed.

## Model

Llama 3.2 1B Instruct (`Llama-3.2-1B-Instruct-q4f32_1-MLC`) is the default on desktop; mobile browsers default to SmolLM2 360M (`SmolLM2-360M-Instruct-q4f32_1-MLC`) to reduce GPU memory use. Both load in a dedicated Web Worker only after clicking **Load model**. The first download is roughly 1 GB for the desktop default and cached by WebLLM. The shipped catalog estimates about 1.1 GB of GPU memory for Llama 3.2 1B and 580 MB for SmolLM2 360M; actual requirements vary. The f32 variants avoid requiring shader-f16 support. Adapter availability is checked first, but download, allocation and device errors can still occur.

Weights download from ModelScope (`modelscope.cn`); Hugging Face is never contacted. The WebAssembly runtime comes from `raw.githubusercontent.com`. Code and requests go to the local inference worker, not a hosted AI endpoint. Fonts load from Google Fonts, with local fallbacks. Respect the Llama license and acceptable-use policy when redistributing. The WebLLM runtime is several MB and is loaded on demand, separate from model weights.

Explain, Edit, and goal-loop stages share explicit code-generation capabilities: models can write apps and replacement source; execution, testing, downloads, and publishing are separate app/user actions. Explain also supplies code when asked to build something. Earlier assistant refusals are not treated as project constraints and are dropped from compacted history. This reduces misleading capability refusals but cannot guarantee response quality from small models. If an old conversation keeps reinforcing a refusal, use **New conversation** (export first); this clears chat and summaries, not workspace files.

Recognizable capability refusals are excluded from recent inference history without deleting the transcript. A completed capability refusal (including prose wrapped in code fences), or an Edit/draft response missing its code fence, triggers at most one clean-context retry with the current task and protected system context. Retry prompts obey the same byte budget. Repeated invalid results fail visibly instead of becoming editable source or new model memory; no unlimited retries or fabricated fallback code are used.

Goal planning and review use WebLLM's schema-constrained JSON output, not prompt instructions alone. Plans constrain actions to inspect/edit/done; reviews constrain verdicts to pass/revise. Draft/revision stages still generate source code. Malformed JSON gets one JSON-specific clean-context retry and then a readable error; source code is never interpreted as an approved plan or review.

## Geometric Compaction

`src/context.ts` is in the actual inference request path:

- Compact only when the assembled prompt exceeds the input budget, at the moment of the request ("on the fly"). Answers return without post-generation compaction; recent exchanges stay verbatim while they fit.
- Compaction is **local and inference-free**: a deterministic extractive digest, not a model summary. It takes milliseconds, makes no model calls, needs no loaded model, and cannot hallucinate or refuse. It keeps each turn's request (up to 200 bytes) and the start of the answer (up to 120 bytes) verbatim, replaces code bodies with `[code N lines]` (the current file is always supplied in full), and drops recognizable capability refusals. When a block exceeds its budget, short entries stay whole and newer entries get proportionally more space; the oldest entries are dropped before any entry falls below ~24 bytes. This is lossy extraction, not semantic abstraction: it won't infer decisions the text doesn't state. Pin or put critical constraints in Project notes.
- Digest older exchanges in batches of up to 1,400 UTF-8 bytes, retaining the newest exchange verbatim unless it also must be compacted to fit. Recheck the prompt after each batch and stop once it fits.
- Merge adjacent equal-level blocks like a binary counter: 1, 2, 4, 8, 16 batches per block. The number of blocks grows logarithmically; each block records its actual turn range.
- Halve summary budgets at each level: 512, 256, 128, then a 96-byte floor. Older history becomes increasingly lossy.
- Before inference, compact further if needed, including the last exchange and oldest blocks. Oversized individual exchanges are chunked to at most 1,400 UTF-8 bytes, sharing the output byte budget across chunks where possible to avoid another summarization pass. Reduction has a bounded loop, progress checks and a retry limit.
- Preserve the latest request, active code selection (or whole active file), and pinned requirements verbatim. Reject oversized protected context instead of silently truncating it.
- Reserve 768 output tokens and 512 tokens of template/headroom from a 4,096-token context configuration. The remaining 2,816-byte input limit uses conservative UTF-8 byte accounting plus per-message overhead, **not an exact tokenizer count**. This intentionally allows less code than the nominal window. Select a smaller code region when necessary.
- Keep the full transcript separately for the lifetime of the page, with JSON export. The transcript UI throttles streaming updates and mobile renders only the latest six exchanges; older exchanges remain in the export. Compaction failure is atomic: original turns stay available for retry. Inspect summaries or manually compact in the Memory panel.
- The Memory panel reports local compaction steps (never model calls), their time in milliseconds, and before/after byte counts for the last operation. Request preparation measures the assembled prompt; manual compaction measures history text. These are not GPU-memory or semantic-quality measurements. The Compact button works without a loaded model.
- Editable **Project notes** in the assistant preserve your goals, decisions, and next tasks verbatim alongside pinned requirements. Notes count toward the protected prompt budget, are never automatically rewritten, and are included in recovery/cloud saves and conversation exports.

Compaction extends session continuity, not the physical context window or reasoning ability. It may forget important details, particularly after repeated merging. Pin critical constraints and re-read actual source; small models can still produce poor edits. Source and notes are marked as untrusted, but prompt-injection immunity is not claimed. The model cannot execute commands, publish, or access credentials.

## GitHub and Editing

### Create without GitHub

No repository or GitHub token is required. Start in the scratch workspace, use **New file** in Explorer (or `/new src/app.ts [description]`), and type directly in the editor. For AI-written content, load a model, choose **Edit**, then review and apply the proposed code.

In the assistant prompt, **Enter** sends and **Shift+Enter** inserts a new line. Ctrl+Enter and Command+Enter also send. Sending remains disabled until the request is valid; Enter does not submit while composing text with an input method.

Choose **Download workspace ZIP** in Explorer (the **Files** tab on mobile) to save all open and newly created files to your phone or computer, with their folder paths and current edits preserved. Unapplied proposals, conversation history, and credentials are not included. With a repository connected, unopened remote files are not included. Extract the ZIP before uploading the files to GitHub later; uploading the ZIP alone does not populate a repository's source files.

Choose **Import workspace ZIP** to reopen a downloaded project. Import replaces the workspace only after validation and confirmation, disconnects GitHub, and clears the previous conversation/notes. Only UTF-8 text files are supported; binary files, invalid paths, and file/folder collisions fail atomically. Limits: 3 MB compressed input, 1,000 files, 500 KB per file, and 2 MB expanded text. ZIP creation/import runs locally.

The browser controls where downloads are saved. Keep ZIP backups even with autosave.

### Recovery and private Neon saves

The app automatically saves a local recovery copy in IndexedDB every second when changes are pending, including partial responses. On reopen it restores files, active file, conversation, summaries, pinned requirements, project notes, prompt draft, model selection, and pending proposal. Interrupted requests are marked as interrupted, not silently resumed. Recovered files reopen as a **local workspace**, not an authenticated GitHub checkout. Only open/new files are saved, not unopened remote repository files. Models must be loaded again.

Local save status and storage failures are displayed in **Files**, alongside **Saving and recovery**. If an existing recovery copy cannot be read, autosaving remains disabled until you explicitly enable it, so unreadable data is not automatically overwritten. Recovery and cloud snapshots are limited to 3 MB; oversized saves fail visibly rather than silently dropping data. Browser eviction, private-browsing restrictions, an immediate crash before the next write, or clearing site data can still lose local changes. Local recovery is one slot per browser profile/origin; avoid editing in multiple tabs. Do not rely on unload events as a backup.

To enable private Neon saves on Vercel:

1. In your Neon project's SQL Editor, run [`neon-schema.sql`](./neon-schema.sql).
2. Set **server-only** Vercel environment variables `DATABASE_URL` (your Neon connection string) and `WORKSPACE_ACCESS_KEY` (at least 32 cryptographically random characters). Do **not** prefix them with `VITE_`, commit them, or paste them into chat. For example, generate a key locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Set variables on the intended deployment environment and redeploy.
3. Open **Files → Saving and recovery → Neon cloud saves**, enter that private access key, and choose **Connect / load cloud**. The first connection saves the local workspace if the cloud slot is empty; otherwise loading requires confirmation before replacing local work.
4. While connected, cloud autosave checks every 3 seconds while the workspace is idle. On another device, reconnect with the same key to load the save. Each update checks a revision, so an outdated device cannot silently overwrite a newer save. Conflicts/network errors stop cloud autosave and display an error; export local edits, then reconnect to resolve. There is one shared private cloud workspace, not a multi-user account system.

The access key grants read/write access to the entire cloud workspace: keep it private, use HTTPS, and rotate it in Vercel if exposed. It stays only in page memory and is forgotten on disconnect/reload. GitHub credentials and database credentials are never included in snapshots. Source, notes, or chat that you yourself paste secrets into will still be saved; avoid doing so. Saving sends workspace contents to **your configured Neon database**. Inference still runs locally.

The `/api/workspace` handler is a Vercel Node function; `npm run dev` alone serves only the front end, so cloud saves require the Vercel deployment or Vercel's local development environment. Local recovery, ZIP import/export, notes, and statistics work with ordinary Vite. Neon schema/credentials and live deployment connectivity must be verified separately.

### Model failure recovery

Worker errors, worker message errors, and inference/runtime exceptions mark the model offline and preserve the workspace. A pending generation with no progress for 120 seconds fails explicitly rather than leaving Send permanently blocked. Choose **Load model** again (or a smaller model). Stopping generation terminates the worker to release resources, so cancellation also requires a reload. A completely killed Chrome tab cannot report an error; reopening uses the local recovery copy.

### Goal-driven local coding loop

Load a browser model, then enable **Goal-driven coding loop** in the assistant. Set a specific goal and choose **Start / resume**. Resolve or discard any pending manual proposal first. This is explicit permission to auto-apply **local** edits to all open files and create new files:

1. **Plan / inspect:** choose one focused file/step, inspecting open files as needed.
2. **Draft:** generate a complete replacement for one file.
3. **Review / revise:** a separate model request reviews correctness, regressions, goal compliance, obvious unsafe behavior, and unnecessary complexity. Review prompts include the goal, steering, protected requirements/notes/skills, and original/proposed code, but omit conversational history to reduce anchoring and avoid needless history-compaction work. Findings trigger a corrected draft and another review, up to two revisions per change.
4. **Apply:** only an explicit review pass allows the app to apply that candidate, with a stale-content/path-collision check. Then it plans the next step. A completion claim receives a separate model review before stopping, but is labeled **model-reported, not tested**.

Use **Steer the next cycle → Send steering** while running to change direction. The latest steering replaces earlier steering and takes precedence over historical notes. An in-flight draft based on older steering is discarded before application. **Pause after cycle** finishes the current review/application cycle without unloading the model. **Stop now** cancels immediately and leaves unreviewed drafts unapplied; interrupting inference requires reloading the model.

There is no fixed iteration count. The loop yields between cycles and continues while the page is open, until you pause/stop, it reports completion, or an error/no-progress condition occurs. It stops on malformed/truncated output, budget overflow, failed reviews, repeated inspections, recent code-state cycles, model failures, or approaching the 3 MB save limit. Keep backups. Phone heat, battery use, OS tab eviction, and browser throttling still apply; **it cannot run forever after the tab closes or crashes**.

Every model stage is visible in the conversation as a brief plan, proposed code, or review result, not private internal reasoning. Goal/steering, conversation, and applied edits are saved through local recovery and connected Neon autosave. The toggle/run authorization is never saved; reload restores work but never restarts execution. Manual editing, chat submission, repository changes, and publishing are locked during the loop. Cloud autosave can continue while it runs.

Only already-open files and newly created files are editable. Unopened remote files are not fetched automatically. The normal protected prompt budget still applies to every stage, including original plus proposed code during review: large files or goals stop explicitly instead of silently omitting code. Small focused files work best with the browser models and 768-token output limit.

**Review is not cleansing or certification:** the same small model can miss its own bugs or be misled by source text. No generated code is executed, no compiler/tests/linter run inside the workspace, and nothing is automatically committed, published, or deployed. If working on this app's own source, edits affect the workspace copy, not the live running app; review, test externally, and publish explicitly.

### Connect and publish

1. Open a public repository with `owner/repo` (no token needed), or enter a fine-grained GitHub token for private repos and publishing. The dialog links to GitHub's token page pre-filled with a name, 30-day expiry and Contents write; there is no "Sign in with GitHub" button because GitHub's OAuth endpoints block browser requests (CORS) and need a server-side secret. Tokens are held only in page memory, never localStorage, the transcript, or model context. Use minimum permissions: Contents read for browsing; Contents write for publishing. Workflow files may require additional GitHub permissions. If the repository is empty (no commits), the app offers to create a short `README.md` as its first commit, after confirmation and only with a Contents write token.
2. Select a UTF-8 file and edit locally, or select a small section and use Explain / Edit. AI proposals must contain a complete fenced code block and finish normally. Review the diff, then apply locally. An intervening edit prevents a stale proposal from overwriting the file.
3. Review local changes, then explicitly publish **all changed files** to a new branch, either with the Publish branch button or by typing `/publish [branch] [message]` (or "publish my changes to GitHub") in the assistant. The model never publishes; the app does, after a confirmation that lists the branch and files. Publishing never updates an existing branch. It checks the source head, creates blobs/tree/commit, and creates the branch ref last. The compare link opens GitHub's pull-request flow. Source branches may advance after the head check; the new branch still starts from the loaded snapshot and never overwrites remote work.

File edits and conversation state have local recovery and optional private cloud saves; GitHub credentials remain session-only. Keep ZIP/conversation exports as independent backups. A reload warning is provided, but browser warnings are not a backup. Never paste credentials into source or chat; those become model context and saved workspace content by your action. A browser extension or XSS on the same origin could access in-memory credentials; this is not a hardened credential vault.

## Limits

- Text files only. You can create new files (New file button, `/new path [what it should contain]`, or plain requests like "write a new readme containing a smiley" or "create a file called src/util.ts that ..."; folders are created implicitly, "a new readme" picks a fresh name such as `README-2.md` rather than overwriting) and publish them, but not delete, rename or move files, edit binaries, or follow symlinks. Files load lazily, limited to 500 KB. GitHub-truncated trees are rejected. New paths are validated: relative only, no `..`, no `.git`, no collisions with existing files or folders.
- No shell, build/test runner, local filesystem access, or automatic commits. The opt-in goal loop edits locally only; it cannot execute code or independently access GitHub/network tools.
- GitHub limits and permissions, network availability, GPU memory, and WebGPU driver support still apply.
- Unit tests use deterministic compaction and mocked GitHub responses. They check compaction structure, budgets and failure handling, not semantic summary quality. Real inference requires downloading weights on compatible hardware.
