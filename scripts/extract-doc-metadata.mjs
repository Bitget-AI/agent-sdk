#!/usr/bin/env node
/**
 * extract-doc-metadata.mjs
 *
 * Phase 0 of the self-describing-SDK effort. Parses the authoritative Bitget
 * UTA v3 markdown docs (apidocusaurus/docs/uta) into structured per-endpoint
 * metadata (method+path join key, request-param table → type/enum/required/
 * description, response params, business rules) and AUDITS that metadata
 * against the current openapi.yaml so we can see exactly where the spec is
 * wrong or under-described before any write-back.
 *
 * This module is import-safe: every parser is a pure function (unit-tested on
 * inline doc strings in tests/scripts/doc-metadata.test.ts). The CLI at the
 * bottom only runs when executed directly:
 *
 *   node scripts/extract-doc-metadata.mjs parse [METHOD /api/v3/...]   # dump JSON
 *   node scripts/extract-doc-metadata.mjs audit [domain]               # diff vs openapi.yaml
 *
 * YAML loading is delegated to /usr/bin/python3 (same trick as
 * generate-catalog.mjs) — the audit only.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SPEC_PATH = resolve(ROOT, "openapi.yaml");
const DOCS_DIR = resolve(ROOT, "../apidocusaurus/docs/uta");
const PYTHON = "/usr/bin/python3";

// Doc dirs that are NOT REST endpoints — excluded from the corpus.
const NON_ENDPOINT_DIRS = new Set(["error-code", "websocket"]);

// ---------------------------------------------------------------------------
// Pure parsers (no fs / no spawn) — these are what the unit tests exercise.
// ---------------------------------------------------------------------------

/** Split a markdown-table data row into trimmed cells (drops the outer pipes). */
export function splitRow(line) {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

const SEPARATOR_CELL = /^:?-{2,}:?$/;

/** A markdown separator row like `|:---|:---|`. */
function isSeparatorRow(cells) {
  return cells.every((c) => c === "" || SEPARATOR_CELL.test(c.replace(/\s/g, "")));
}

/**
 * Extract candidate enum values from a param's Comments cell.
 *
 * Heuristic (conservative — "permissive beats wrong"): docs render closed
 * enums as `<br/>`-separated segments where each VALUE is a leading
 * backtick-token followed by descriptive text ("`SPOT` Spot trading") or as a
 * slash-joined group ("`buy`/`sell`"). We therefore only treat a segment as
 * enum-bearing when it STARTS with a backtick token AND either carries trailing
 * description or contains multiple tokens. This rejects:
 *   - examples            "e.g.,`BTCUSDT`"            (segment starts with "e.g.")
 *   - cross-references    "...when `tpslMode=partial`" (token has '=', not leading)
 *   - units / prose       "the unit is `base coin`"    (token not leading; has space)
 *   - grouping sub-labels "`Spot/Margin`" / "`COIN-Futures`" (token alone in segment)
 */
export function extractEnums(comment) {
  if (!comment) return [];
  const out = [];
  const seen = new Set();
  for (const rawSeg of comment.split(/<br\s*\/?>/i)) {
    const seg = rawSeg.trim();
    if (!seg.startsWith("`")) continue;
    const tokens = [...seg.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (tokens.length === 0) continue;
    // Text after the first token's closing backtick — a lone "`X`" label has none.
    const firstClose = seg.indexOf("`", 1);
    const afterFirst = firstClose === -1 ? "" : seg.slice(firstClose + 1).trim();
    const hasDescription = afterFirst.length > 0;
    if (!hasDescription && tokens.length === 1) continue; // grouping sub-label → skip
    for (const t of tokens) {
      if (t.includes("/") || t.includes("=") || /\s/.test(t)) continue;
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out;
}

/** Collapse a Comments cell into a single human-readable description string. */
export function cleanDescription(comment) {
  if (!comment) return "";
  return comment
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?u>/gi, "")
    .replace(/\*\*/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Yes/是 → true; everything else (No/blank/conditional) → false. */
export function parseRequired(cell) {
  const v = (cell || "").trim().toLowerCase();
  return v === "yes" || v === "是" || v === "true";
}

/**
 * Parse every parameter row out of a doc section. Unions all tables found in
 * the section (so <Tabs>/<TabItem> docs with one table per category merge into
 * a single param list). Header and separator rows are skipped.
 */
export function parseParamTable(sectionText) {
  const params = [];
  const byName = new Map();
  for (const raw of (sectionText || "").split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = splitRow(line);
    if (cells.length < 3) continue;
    if (isSeparatorRow(cells)) continue;
    const name = cells[0];
    if (!name) continue;
    if (/^parameters?$/i.test(name)) continue; // header row
    // Nested array-element / child-field rows ("> index [0]", "&gt; subField")
    // annotate the PRECEDING param's shape — they are not top-level params.
    if (/^(&gt;|>)/.test(name)) continue;
    const comments = cells.slice(3).join(" | ").trim();
    const entry = {
      name,
      type: cells[1] || "",
      required: parseRequired(cells[2]),
      requiredRaw: (cells[2] || "").trim(),
      description: cleanDescription(comments),
      enum: extractEnums(comments),
      comments,
    };
    // A Tabs doc can repeat a param across category tabs — merge, unioning enums.
    const existing = byName.get(name);
    if (existing) {
      for (const v of entry.enum) if (!existing.enum.includes(v)) existing.enum.push(v);
      existing.required = existing.required || entry.required;
      if (!existing.description) existing.description = entry.description;
    } else {
      byName.set(name, entry);
      params.push(entry);
    }
  }
  return params;
}

/** Pull the section body between a `### Heading` and the next `###` heading. */
export function sectionBody(text, headingPattern) {
  const re = new RegExp(`^###\\s+${headingPattern}[^\\n]*$`, "im");
  const m = re.exec(text);
  if (!m) return "";
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const next = /^###\s+/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** Parse the `### HTTP Request` block → { method, path, rateLimit, permission }. */
export function parseHttpRequest(text) {
  const body = sectionBody(text, "HTTP Request");
  if (!body) return null;
  const ep = /^-\s*(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/v3\/\S+)/im.exec(body);
  if (!ep) return null;
  const rate = /^-\s*(?:Rate limit|Speed limit)[^\n]*/im.exec(body);
  const perm = /^-\s*Permission[^\n]*/im.exec(body);
  return {
    method: ep[1].toUpperCase(),
    path: ep[2].trim(),
    rateLimit: rate ? rate[0].replace(/^-\s*/, "").trim() : "",
    permission: perm ? perm[0].replace(/^-\s*/, "").trim() : "",
  };
}

/** Parse a full doc markdown string into structured metadata (or null). */
export function parseDoc(text, file = "") {
  const http = parseHttpRequest(text);
  if (!http) return null;
  const titleMatch = /^#\s+(.+)$/m.exec(text);
  return {
    file,
    title: titleMatch ? titleMatch[1].trim() : "",
    method: http.method,
    path: http.path,
    key: `${http.method} ${http.path}`,
    rateLimit: http.rateLimit,
    permission: http.permission,
    params: parseParamTable(sectionBody(text, "Request\\s+Parameters")),
    responseParams: parseParamTable(sectionBody(text, "Response\\s+Parameters")),
  };
}

// ---------------------------------------------------------------------------
// Corpus walking + audit (fs / spawn) — not exercised by the hermetic tests.
// ---------------------------------------------------------------------------

function walkMarkdown(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(DOCS_DIR, full);
    if (NON_ENDPOINT_DIRS.has(rel.split("/")[0])) continue;
    const st = statSync(full);
    if (st.isDirectory()) walkMarkdown(full, acc);
    else if (name.endsWith(".md")) acc.push(full);
  }
  return acc;
}

export function parseAllDocs() {
  const docs = [];
  const skipped = [];
  for (const file of walkMarkdown(DOCS_DIR)) {
    const parsed = parseDoc(readFileSync(file, "utf8"), relative(DOCS_DIR, file));
    if (parsed) docs.push(parsed);
    else skipped.push(relative(DOCS_DIR, file));
  }
  const byKey = new Map();
  const byPath = new Map();
  for (const d of docs) {
    byKey.set(d.key, d);
    if (!byPath.has(d.path)) byPath.set(d.path, []);
    byPath.get(d.path).push(d);
  }
  return { docs, skipped, byKey, byPath };
}

function loadSpec() {
  const code = "import json,sys,yaml;json.dump(yaml.safe_load(open(sys.argv[1])),sys.stdout)";
  const out = execFileSync(PYTHON, ["-c", code, SPEC_PATH], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function refName(ref) {
  if (typeof ref !== "string") return null;
  return ref.split("/").pop() || null;
}

/** Per-op param view from the spec: names + which carry an enum + required set. */
function specParams(spec, op, path) {
  const params = op.parameters ?? [];
  const names = new Set();
  const withEnum = new Set();
  const required = new Set();
  for (const p of params) {
    if (p.in === "query" || p.in === "path") {
      names.add(p.name);
      if (p.required) required.add(p.name);
      if (p.schema?.enum) withEnum.add(p.name);
    }
  }
  for (const m of path.matchAll(/\{([^}]+)\}/g)) names.add(m[1]);
  const json = op.requestBody?.content?.["application/json"];
  let schemaName = null;
  if (json?.schema) {
    if (json.schema.$ref) {
      schemaName = refName(json.schema.$ref);
      const sc = spec.components?.schemas?.[schemaName];
      const props = sc?.properties ?? {};
      const req = new Set(sc?.required ?? []);
      for (const n of Object.keys(props)) {
        names.add(n);
        if (props[n]?.enum) withEnum.add(n);
        if (req.has(n)) required.add(n);
      }
    }
  }
  return { names, withEnum, required, schemaName };
}

function specOps(spec) {
  const ops = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(item)) {
      if (!["get", "post", "put", "delete", "patch"].includes(method)) continue;
      ops.push({
        method: method.toUpperCase(),
        path,
        key: `${method.toUpperCase()} ${path}`,
        operationId: op.operationId,
        ...specParams(spec, op, path),
      });
    }
  }
  return ops;
}

/** Diff parsed docs against the spec → structured findings. */
export function auditAgainstSpec(parsed, spec) {
  const ops = specOps(spec);
  const opByKey = new Map(ops.map((o) => [o.key, o]));
  const opByPath = new Map();
  for (const o of ops) {
    if (!opByPath.has(o.path)) opByPath.set(o.path, []);
    opByPath.get(o.path).push(o);
  }

  const findings = [];
  const matchedSpecKeys = new Set();

  for (const doc of parsed.docs) {
    let op = opByKey.get(doc.key);
    if (!op) {
      const samePathOps = opByPath.get(doc.path) ?? [];
      if (samePathOps.length > 0) {
        findings.push({
          kind: "METHOD_MISMATCH",
          path: doc.path,
          doc: doc.method,
          spec: samePathOps.map((o) => o.method).join(","),
          operationId: samePathOps[0].operationId,
          file: doc.file,
        });
        op = samePathOps[0]; // still diff the params against the mis-methoded op
      } else {
        findings.push({ kind: "DOC_NO_SPEC", key: doc.key, file: doc.file });
        continue;
      }
    }
    matchedSpecKeys.add(op.key);

    const docNames = new Set(doc.params.map((p) => p.name));
    const docOnly = [...docNames].filter((n) => !op.names.has(n));
    const specOnly = [...op.names].filter((n) => !docNames.has(n));
    const enumGaps = doc.params
      .filter((p) => p.enum.length > 0 && !op.withEnum.has(p.name))
      .map((p) => `${p.name}[${p.enum.join("|")}]`);
    const reqMismatch = doc.params
      .filter((p) => p.required !== op.required.has(p.name))
      .map((p) => `${p.name}(doc:${p.required ? "req" : "opt"})`);

    if (docOnly.length || specOnly.length || enumGaps.length || reqMismatch.length) {
      findings.push({
        kind: "PARAM_DIFF",
        key: op.key,
        operationId: op.operationId,
        file: doc.file,
        docOnly,
        specOnly,
        enumGaps,
        reqMismatch,
      });
    }
  }

  for (const o of ops) {
    if (!matchedSpecKeys.has(o.key)) {
      findings.push({ kind: "SPEC_NO_DOC", key: o.key, operationId: o.operationId });
    }
  }
  return { findings, docCount: parsed.docs.length, specOpCount: ops.length };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function domainOf(file) {
  return (file || "").split("/")[0];
}

function runParse(filter) {
  const { docs, skipped } = parseAllDocs();
  if (filter) {
    const hit = docs.filter((d) => d.key === filter || d.path === filter || d.file === filter);
    process.stdout.write(JSON.stringify(hit, null, 2) + "\n");
    return;
  }
  process.stdout.write(
    `Parsed ${docs.length} endpoint docs (skipped ${skipped.length} non-endpoint md).\n`,
  );
  for (const d of docs) {
    const enums = d.params.filter((p) => p.enum.length).length;
    process.stdout.write(
      `  ${d.method.padEnd(4)} ${d.path.padEnd(46)} params=${String(d.params.length).padStart(2)} enums=${enums}\n`,
    );
  }
  if (skipped.length) process.stdout.write(`\nSkipped (no HTTP Request): ${skipped.join(", ")}\n`);
}

function runAudit(domainFilter) {
  const parsed = parseAllDocs();
  const spec = loadSpec();
  const { findings, docCount, specOpCount } = auditAgainstSpec(parsed, spec);
  const show = domainFilter
    ? findings.filter(
        (f) => domainOf(f.file) === domainFilter || (f.key || "").includes(`/${domainFilter}/`),
      )
    : findings;

  const byKind = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;

  process.stdout.write(
    `\n=== doc↔openapi.yaml AUDIT ===\n` +
      `docs=${docCount}  specOps=${specOpCount}  findings=${findings.length}` +
      (domainFilter ? `  (showing domain="${domainFilter}": ${show.length})` : "") +
      `\nby kind: ${JSON.stringify(byKind)}\n\n`,
  );

  for (const f of show) {
    if (f.kind === "METHOD_MISMATCH") {
      process.stdout.write(
        `[METHOD] ${f.path}\n   doc=${f.doc} spec=${f.spec} (${f.operationId})  ${f.file}\n`,
      );
    } else if (f.kind === "DOC_NO_SPEC") {
      process.stdout.write(`[DOC_NO_SPEC] ${f.key}  ${f.file}\n`);
    } else if (f.kind === "SPEC_NO_DOC") {
      process.stdout.write(`[SPEC_NO_DOC] ${f.key}  (${f.operationId})\n`);
    } else if (f.kind === "PARAM_DIFF") {
      const bits = [];
      if (f.docOnly.length) bits.push(`spec-missing: ${f.docOnly.join(", ")}`);
      if (f.specOnly.length) bits.push(`doc-missing: ${f.specOnly.join(", ")}`);
      if (f.enumGaps.length) bits.push(`enum-gaps: ${f.enumGaps.join(", ")}`);
      if (f.reqMismatch.length) bits.push(`required: ${f.reqMismatch.join(", ")}`);
      process.stdout.write(`[PARAM] ${f.operationId}  (${f.key})\n   ${bits.join("\n   ")}\n`);
    }
  }
  process.stdout.write("\n");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [, , cmd, arg] = process.argv;
  if (cmd === "audit") runAudit(arg);
  else if (cmd === "parse") runParse(arg);
  else if (cmd === "json") process.stdout.write(JSON.stringify(parseAllDocs().docs) + "\n");
  else {
    process.stdout.write(
      "usage:\n  node scripts/extract-doc-metadata.mjs parse [METHOD /api/v3/... | domain/File.md]\n" +
        "  node scripts/extract-doc-metadata.mjs audit [domain]\n" +
        "  node scripts/extract-doc-metadata.mjs json   # all parsed docs as a JSON array\n",
    );
  }
}
