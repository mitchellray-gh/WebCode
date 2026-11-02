import { clip } from "./agentTools.ts";

export const PREVIEW_CHANNEL = "technicalskills-preview";
export type PreviewFiles = Record<string, string>;
export type PreviewBuild = {
  standalone: string;
  frame: string;
  missing: string[];
  warnings: string[];
};

const PAGE = /\.html?$/i;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
const MAX_BYTES = 2_000_000;

export const previewPages = (paths: string[]) => paths.filter((path) => PAGE.test(path));

// Unsaved HTML (a chat reply or a file with the wrong extension) is previewed under this virtual name.
export const SNIPPET_PAGE = "preview-snippet.html";
const DOCUMENT = /^\s*(?:<!doctype\s+html|<html[\s>])/i;
export const looksLikeHtml = (text: string) => DOCUMENT.test(text);

/** The page in a finished model reply: one fenced html block, or a bare HTML document. Ambiguous replies give null. */
export function htmlFromReply(reply: string): string | null {
  const fences = [...reply.matchAll(/```([^\n]*)\n([\s\S]*?)\n```/g)];
  if (fences.length === 1) {
    const [, language, code] = fences[0];
    return /^html?$/i.test(language.trim()) || looksLikeHtml(code) ? code : null;
  }
  return fences.length === 0 && looksLikeHtml(reply) ? reply : null;
}

export function defaultEntry(paths: string[], active: string) {
  const pages = previewPages(paths);
  if (pages.includes(active)) return active;
  return pages.find((path) => /(^|\/)index\.html?$/i.test(path)) ?? pages[0] ?? "";
}

/** Resolves "../app.js?v=2" against the folder of `page`; null if empty or it leaves the workspace. */
export function resolveRef(page: string, ref: string): string | null {
  const clean = ref.trim().split(/[?#]/)[0];
  if (!clean) return null;
  let decoded = clean;
  try { decoded = decodeURIComponent(clean); } catch { /* keep the raw text */ }
  const parts = decoded.startsWith("/") ? [] : page.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.length) parts.pop();
    else return null;
  }
  return parts.join("/");
}

// Runs inside the sandboxed page: forwards console/errors, replaces storage (blocked without a real origin), and routes local links to the app.
const BRIDGE = `(function(){var C=${JSON.stringify(PREVIEW_CHANNEL)},n=0;
function send(m){if(n++>300)return;m.channel=C;try{parent.postMessage(m,"*")}catch(e){}}
function fmt(a){return Array.prototype.map.call(a,function(x){if(typeof x==="string")return x;try{var j=JSON.stringify(x);return j===undefined?String(x):j}catch(e){return String(x)}}).join(" ").slice(0,500)}
["log","info","warn","error"].forEach(function(k){var o=console[k];console[k]=function(){send({type:"log",level:k,text:fmt(arguments)});o.apply(console,arguments)}});
addEventListener("error",function(e){send({type:"log",level:"error",text:(e.message||"Script error")+(e.lineno?" (line "+e.lineno+")":"")})});
addEventListener("unhandledrejection",function(e){send({type:"log",level:"error",text:"Unhandled rejection: "+fmt([e.reason&&e.reason.message||e.reason])})});
function mem(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}
["localStorage","sessionStorage"].forEach(function(k){try{Object.defineProperty(window,k,{value:mem(),configurable:true})}catch(e){}});
document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a||e.defaultPrevented)return;var h=a.getAttribute("href")||"";if(h.charAt(0)==="#"||a.target||/^(?:[a-z][a-z0-9+.-]*:|\\/\\/)/i.test(h))return;e.preventDefault();send({type:"navigate",href:h})});
})();`;

function attr(markup: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(markup);
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

// A literal closing tag inside inlined code would end the surrounding element early.
const inert = (text: string, tag: "script" | "style") =>
  text.replace(new RegExp(`</(${tag})`, "gi"), "<\\/$1");

function withBridge(html: string) {
  const tag = `<script>${BRIDGE}</script>`;
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (head) => head + tag);
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, (open) => `${open}<head>${tag}</head>`);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  return doctype ? doctype[0] + tag + html.slice(doctype[0].length) : tag + html;
}

/** One short report of how a page ran in the headless check, for the agent's next step. */
export function formatCheck(
  entry: string,
  lines: { level: string; text: string }[],
  build: { missing: string[]; warnings: string[] },
) {
  const errors = lines.filter((line) => line.level === "error").map((line) => line.text);
  const problems: string[] = [];
  if (errors.length) problems.push(`${errors.length} error(s): ${errors.slice(0, 3).join(" | ")}`);
  if (build.missing.length) problems.push(`missing files: ${build.missing.join(", ")}`);
  if (build.warnings.length) problems.push(`warnings: ${build.warnings.join(" ")}`);
  if (!problems.length) {
    const count = lines.length;
    return `${entry} ran cleanly (${count} console line${count === 1 ? "" : "s"}).`;
  }
  return clip(`${entry}: ${problems.join("; ")}`, 650);
}

/** Inlines workspace stylesheets and scripts into one document. Nothing is fetched or executed here. */
export function buildPreview(files: PreviewFiles, entry: string): PreviewBuild {
  if (!Object.hasOwn(files, entry) || !PAGE.test(entry))
    throw new Error("Choose an HTML file to preview.");
  const missing = new Set<string>();
  const warnings = new Set<string>();
  const local = (ref: string) => {
    if (EXTERNAL.test(ref.trim())) return null;
    const path = resolveRef(entry, ref);
    if (path === null || !Object.hasOwn(files, path)) {
      if (ref.trim().split(/[?#]/)[0]) missing.add(path ?? ref.trim());
      return null;
    }
    if (/\.(?:tsx?|jsx)$/i.test(path)) {
      warnings.add(`${path} is TypeScript/JSX. The browser cannot run it; use plain JavaScript for previews.`);
      return null;
    }
    return path;
  };
  let html = files[entry]
    .replace(/<script\b([^>]*)>\s*<\/script\s*>/gi, (whole, attrs: string) => {
      const src = attr(attrs, "src");
      const path = src === null ? null : local(src);
      if (!path) return whole;
      const code = files[path];
      if (/\btype\s*=\s*["']?module/i.test(attrs) &&
          (/^\s*(?:import|export)\b[^;'"]*?from\s*["']\.{0,2}\//m.test(code) || /\bimport\(\s*["']\.{0,2}\//.test(code)))
        warnings.add(`${path} imports other workspace files as modules. Preview supports one script per tag; use classic scripts.`);
      return `<script${attrs.replace(/\ssrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "")}>${inert(code, "script")}</script>`;
    })
    .replace(/<link\b[^>]*>/gi, (tag) => {
      const rel = attr(tag, "rel");
      const href = attr(tag, "href");
      if (!rel || href === null || !/\bstylesheet\b/i.test(rel)) return tag;
      const path = local(href);
      if (!path) return tag;
      const media = attr(tag, "media");
      return `<style${media ? ` media="${media.replaceAll('"', "&quot;")}"` : ""}>${inert(files[path], "style")}</style>`;
    });
  if (html.length > MAX_BYTES) throw new Error("This preview is too large (over 2 MB after inlining files).");
  html = html.trim() ? html : "<!doctype html><title>Empty page</title><p>This HTML file is empty.</p>";
  return { standalone: html, frame: withBridge(html), missing: [...missing], warnings: [...warnings] };
}
