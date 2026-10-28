# technicalskills

A lightweight browser coding workspace using React, CodeMirror, GitHub REST API, and WebLLM. No AI server, API key, or hosted inference. A review-first assistant, not an autonomous coding agent.

## Run

Requires Node.js 24+ for TypeScript tests, and current desktop Chrome or Edge with WebGPU and hardware acceleration for inference.

```sh
npm install
npm test
npm run build
npm run dev -- --host 127.0.0.1
```

Open the localhost URL printed by Vite. WebGPU requires localhost or HTTPS. The mobile layout is supported; mobile GPU compatibility is not guaranteed.

## Model

Llama 3.2 1B Instruct (`Llama-3.2-1B-Instruct-q4f32_1-MLC`), loaded in a dedicated Web Worker only after clicking **Load model**. The first download is roughly 1 GB and cached by WebLLM. The shipped catalog estimates about 1.1 GB of GPU memory; actual requirements vary. The f32 variant avoids requiring shader-f16 support. Adapter availability is checked first, but download, allocation and device errors can still occur.

Weights download from ModelScope (`modelscope.cn`); Hugging Face is never contacted. The WebAssembly runtime comes from `raw.githubusercontent.com`. Code and requests go to the local inference worker, not a hosted AI endpoint. Fonts load from Google Fonts, with local fallbacks. Respect the Llama license and acceptable-use policy when redistributing. The WebLLM runtime is several MB and is loaded on demand, separate from model weights.

## Geometric Compaction

`src/context.ts` is in the actual inference request path:

- Immediately after each completed answer, compact all but the most recent exchange using the local model.
- Merge adjacent equal-level blocks like a binary counter: 1, 2, 4, 8, 16 exchanges per block. The number of blocks grows logarithmically.
- Halve summary budgets at each level: 512, 256, 128, then a 96-byte floor. Older history becomes increasingly lossy.
- Before inference, compact further if needed, including the last exchange and oldest blocks. Summary sources are chunked to at most 1,400 UTF-8 bytes. Reduction has a bounded loop, progress checks and a retry limit.
- Preserve the latest request, active code selection (or whole active file), and pinned requirements verbatim. Reject oversized protected context instead of silently truncating it.
- Reserve 768 output tokens and 512 tokens of template/headroom from a 4,096-token context configuration. The remaining 2,816-byte input limit uses conservative UTF-8 byte accounting plus per-message overhead, **not an exact tokenizer count**. This intentionally allows less code than the nominal window. Select a smaller code region when necessary.
- Keep the full transcript separately for the lifetime of the page, with JSON export. Compaction failure is atomic: original turns stay available for retry. Inspect summaries or manually compact in the Memory panel.

Compaction extends session continuity, not the physical context window or reasoning ability. It adds inference latency and may forget important details, particularly after repeated merging. Pin critical constraints and re-read actual source; a 1B model can still produce poor edits or poor summaries. Source and notes are marked as untrusted, but prompt-injection immunity is not claimed. The model cannot execute commands, publish, or access credentials.

## GitHub and Editing

1. Open a public repository with `owner/repo` (no token needed), or enter a fine-grained GitHub token for private repos and publishing. The dialog links to GitHub's token page pre-filled with a name, 30-day expiry and Contents write; there is no "Sign in with GitHub" button because GitHub's OAuth endpoints block browser requests (CORS) and need a server-side secret. Tokens are held only in page memory, never localStorage, the transcript, or model context. Use minimum permissions: Contents read for browsing; Contents write for publishing. Workflow files may require additional GitHub permissions. If the repository is empty (no commits), the app offers to create a short `README.md` as its first commit, after confirmation and only with a Contents write token.
2. Select a UTF-8 file and edit locally, or select a small section and use Explain / Edit. AI proposals must contain a complete fenced code block and finish normally. Review the diff, then apply locally. An intervening edit prevents a stale proposal from overwriting the file.
3. Review local changes, then explicitly publish **all changed files** to a new branch, either with the Publish branch button or by typing `/publish [branch] [message]` (or "publish my changes to GitHub") in the assistant. The model never publishes; the app does, after a confirmation that lists the branch and files. Publishing never updates an existing branch. It checks the source head, creates blobs/tree/commit, and creates the branch ref last. The compare link opens GitHub's pull-request flow. Source branches may advance after the head check; the new branch still starts from the loaded snapshot and never overwrites remote work.

File edits, transcript, and credentials are session-only. Download edited files and export the conversation before closing. A reload warning is provided, but browser warnings are not a backup. Never paste credentials into source or chat; those become model context by your action. A browser extension or XSS on the same origin could access in-memory credentials; this is not a hardened credential vault.

## Limits

- Existing text files only; no file creation/deletion, binary editing, or symlink traversal. Files load lazily, limited to 500 KB. GitHub-truncated trees are rejected.
- No shell, build/test runner, local filesystem access, autonomous agent loop, or automatic commits.
- GitHub limits and permissions, network availability, GPU memory, and WebGPU driver support still apply.
- Unit tests use deterministic summary stubs and mocked GitHub responses. They check compaction structure, budgets and failure handling, not semantic summary quality. Real inference requires downloading weights on compatible hardware.
