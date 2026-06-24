#!/usr/bin/env node
/**
 * generate-catalog.mjs
 *
 * Reads the single source of truth — openapi.yaml — and emits a typed
 * operation catalog at src/generated/catalog.ts. Every layer of the SDK
 * (rest client, tool builder, mock server, regression tests) is driven by
 * this catalog, so a spec change followed by `pnpm run gen` propagates
 * everywhere with zero hand-editing and zero drift.
 *
 * YAML parsing is delegated to the system python (already required by the
 * openapi regen pipeline: gen_openapi.py / verify_openapi.py).
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SPEC_PATH = resolve(ROOT, "openapi.yaml");
const OUT_PATH = resolve(ROOT, "src/generated/catalog.ts");

// Must mirror TAG_TO_MODULE in src/constants.ts. The regression suite asserts
// every emitted module is a known ModuleId, so drift fails the build.
const TAG_TO_MODULE = {
  Account: "account",
  Trade: "trade",
  Market: "market",
  Strategy: "strategy",
  Broker: "broker",
  "Crypto Loans": "cryptoloans",
  "Inst Loan": "instloan",
  Tax: "tax",
};

const PYTHON = "/usr/bin/python3";

function loadSpecAsJson() {
  const code =
    "import json,sys,yaml;json.dump(yaml.safe_load(open(sys.argv[1])),sys.stdout)";
  const out = execFileSync(PYTHON, ["-c", code, SPEC_PATH], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function refName(ref) {
  if (typeof ref !== "string") return null;
  const parts = ref.split("/");
  return parts[parts.length - 1] || null;
}

function resolveSchema(spec, schema) {
  if (!schema) return null;
  if (schema.$ref) {
    const name = refName(schema.$ref);
    const target = spec.components?.schemas?.[name];
    return { name, schema: target ?? null };
  }
  return { name: null, schema };
}

// Build a CatalogParam, emitting type/enum/description ONLY when present so
// un-enriched params stay byte-identical to {name,required} (forward-compatible
// with existing tests). Doc-grounded metadata flows straight from openapi.yaml.
function paramMeta(name, required, schema, description) {
  const out = { name, required };
  const type = schema?.type;
  const en = schema?.enum;
  const desc = description ?? schema?.description;
  if (typeof type === "string") out.type = type;
  if (Array.isArray(en) && en.length) out.enum = en;
  if (typeof desc === "string" && desc) out.description = desc;
  return out;
}

function extractBodyParams(spec, op) {
  const json = op.requestBody?.content?.["application/json"];
  if (!json?.schema) return { requestSchemaName: null, bodyParams: [] };
  const resolved = resolveSchema(spec, json.schema);
  if (!resolved?.schema) {
    return { requestSchemaName: resolved?.name ?? null, bodyParams: [] };
  }
  const props = resolved.schema.properties ?? {};
  const required = new Set(resolved.schema.required ?? []);
  const bodyParams = Object.keys(props).map((name) => {
    const ps = props[name] ?? {};
    return paramMeta(name, required.has(name), ps, ps.description);
  });
  return { requestSchemaName: resolved.name, bodyParams };
}

function buildCatalog(spec) {
  const ops = [];
  const seen = new Set();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(item)) {
      if (!["get", "post", "put", "delete", "patch"].includes(method)) continue;
      const operationId = op.operationId;
      if (!operationId) {
        throw new Error(`Missing operationId for ${method.toUpperCase()} ${path}`);
      }
      if (seen.has(operationId)) {
        throw new Error(`Duplicate operationId "${operationId}"`);
      }
      seen.add(operationId);

      const tag = (op.tags ?? [])[0] ?? "Account";
      const module = TAG_TO_MODULE[tag];
      if (!module) throw new Error(`Unknown tag "${tag}" for ${operationId}`);

      const params = op.parameters ?? [];
      const pathParams = params
        .filter((p) => p.in === "path")
        .map((p) => p.name);
      // Also capture {brace} tokens in the path that lack a declared param.
      for (const m of path.matchAll(/\{([^}]+)\}/g)) {
        if (!pathParams.includes(m[1])) pathParams.push(m[1]);
      }
      const queryParams = params
        .filter((p) => p.in === "query")
        .map((p) => paramMeta(p.name, Boolean(p.required), p.schema, p.description));

      const { requestSchemaName, bodyParams } = extractBodyParams(spec, op);

      const upper = method.toUpperCase();
      const auth = tag === "Market" ? "public" : "private";
      const isWrite = upper === "POST" && !operationId.startsWith("get");

      ops.push({
        operationId,
        method: upper,
        path,
        tag,
        module,
        summary: op.summary ?? operationId,
        description: (op.description ?? "").split("\n")[0].slice(0, 300),
        pathParams,
        queryParams,
        bodyParams,
        requestSchemaName,
        auth,
        isWrite,
      });
    }
  }
  ops.sort((a, b) =>
    a.module === b.module
      ? a.operationId.localeCompare(b.operationId)
      : a.module.localeCompare(b.module),
  );
  return ops;
}

function emit(spec, ops) {
  const version = spec.info?.version ?? "0.0.0";
  const lines = [];
  lines.push(
    "// AUTO-GENERATED by scripts/generate-catalog.mjs from openapi.yaml.",
    "// DO NOT EDIT BY HAND — run `pnpm run gen` to regenerate.",
    "",
    'import type { ModuleId } from "../constants.js";',
    "",
    "export interface CatalogParam {",
    "  name: string;",
    "  required: boolean;",
    "  type?: string;",
    "  enum?: string[];",
    "  description?: string;",
    "}",
    "",
    "export interface CatalogOperation {",
    "  operationId: string;",
    '  method: "GET" | "POST";',
    "  path: string;",
    "  tag: string;",
    "  module: ModuleId;",
    "  summary: string;",
    "  description: string;",
    "  pathParams: string[];",
    "  queryParams: CatalogParam[];",
    "  bodyParams: CatalogParam[];",
    "  requestSchemaName: string | null;",
    '  auth: "public" | "private";',
    "  isWrite: boolean;",
    "}",
    "",
    `export const CATALOG_SPEC_VERSION = ${JSON.stringify(version)};`,
    `export const CATALOG_OPERATION_COUNT = ${ops.length};`,
    "",
    "export const CATALOG: readonly CatalogOperation[] = [",
  );
  for (const op of ops) {
    lines.push("  " + JSON.stringify(op) + ",");
  }
  lines.push("];", "");
  lines.push(
    "const BY_ID = new Map<string, CatalogOperation>(",
    "  CATALOG.map((op) => [op.operationId, op]),",
    ");",
    "",
    "export function getOperation(operationId: string): CatalogOperation | undefined {",
    "  return BY_ID.get(operationId);",
    "}",
    "",
  );
  return lines.join("\n");
}

const spec = loadSpecAsJson();
const ops = buildCatalog(spec);
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, emit(spec, ops));
process.stdout.write(
  `Generated ${ops.length} operations -> src/generated/catalog.ts (spec v${spec.info?.version})\n`,
);
