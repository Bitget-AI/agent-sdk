import { getOperation } from "../generated/catalog.js";
import { ValidationError } from "../utils/errors.js";
import { actionContract } from "./conditional-required.js";
import { readString } from "./helpers.js";
import { domainOrder, META_DOMAIN } from "./domains.js";
import { projectOperation } from "./param-schema.js";
import { riskLevelOf } from "./risk.js";
import type { JsonSchema, ToolSpec } from "./types.js";

export const DISCOVER_TOOL_NAME = "discover";

function discoverSchema(): JsonSchema {
  return {
    type: "object",
    properties: {
      domain: {
        type: "string",
        description: "List every tool in this domain, with one-line descriptions.",
      },
      tool: {
        type: "string",
        description:
          "Return one tool's full input schema and metadata, ready to execute.",
      },
      action: {
        type: "string",
        description:
          "With `tool`, drill into one action's exact contract: required vs optional params, each with type/enum/description. Action-routed verbs only.",
      },
      search: {
        type: "string",
        description:
          "Keyword-search the surface (tool names, actions, fronts, descriptions); returns ranked matches with the tool to open next.",
      },
    },
    additionalProperties: false,
  };
}

/**
 * Split a flat input schema into required/optional param lists, each field
 * carrying its full schema (type/enum/description). Used for action-less tools
 * (composite fan-outs like `account_overview`, or 1:1 ops) that have no L4
 * drill-down — so the L3 view still hands back an assembly-ready contract.
 */
function splitParams(schema: JsonSchema) {
  const requiredSet = new Set(schema.required ?? []);
  const toParam = (name: string) => ({
    name,
    ...(schema.properties[name] as Record<string, unknown>),
  });
  const names = Object.keys(schema.properties);
  return {
    required: names.filter((name) => requiredSet.has(name)).map(toParam),
    optional: names.filter((name) => !requiredSet.has(name)).map(toParam),
  };
}

function overview(tools: ToolSpec[]) {
  const counts = new Map<string, number>();
  const meta: string[] = [];
  for (const t of tools) {
    if (t.domain === META_DOMAIN) {
      meta.push(t.name);
      continue;
    }
    counts.set(t.domain, (counts.get(t.domain) ?? 0) + 1);
  }
  const domains = [...counts.entries()]
    .map(([domain, toolCount]) => ({ domain, toolCount }))
    .sort((a, b) => domainOrder(a.domain) - domainOrder(b.domain));
  return {
    domains,
    // Cross-cutting tools shown apart from business domains (never mixed in).
    meta,
    hint: "Call discover({ domain }) to list a domain's tools, then discover({ tool }) for one tool's input schema. discover({ search }) keyword-searches the whole surface. `meta` lists cross-cutting tools (raw, discover).",
  };
}

function listDomain(tools: ToolSpec[], domain: string) {
  const matches = tools
    .filter((t) => t.domain === domain)
    .map((t) => ({
      name: t.name,
      description: t.description,
      isWrite: t.isWrite,
      riskLevel: t.riskLevel,
      fronts: t.fronts,
    }));
  if (matches.length === 0) {
    const available = [...new Set(tools.map((t) => t.domain))].sort(
      (a, b) => domainOrder(a) - domainOrder(b),
    );
    return { domain, tools: [], note: `No domain "${domain}" in the active surface.`, available };
  }
  return { domain, tools: matches };
}

function describeTool(tools: ToolSpec[], name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new ValidationError(
      `Unknown tool "${name}".`,
      "Call discover({}) then discover({ domain }) to list valid tool names.",
    );
  }
  const base = {
    name: tool.name,
    domain: tool.domain,
    module: tool.module,
    method: tool.method,
    path: tool.path,
    auth: tool.auth,
    isWrite: tool.isWrite,
    riskLevel: tool.riskLevel,
    description: tool.description,
    fronts: tool.fronts,
    inputSchema: tool.inputSchema,
  };
  if (tool.actions) {
    // Action-routed verb: the flat schema unions every action's params (enums
    // included), so it can't show one action's exact required set. Point the
    // agent at the L4 drill-down before it assembles a call.
    return {
      ...base,
      actions: Object.keys(tool.actions),
      hint: `Params differ per action; the schema above is the union across all actions. Call discover({ tool: "${tool.name}", action }) for one action's exact required/optional contract before assembling a call.`,
    };
  }
  // Action-less tool (composite fan-out like account_overview, or a 1:1 op):
  // there is no L4 drill-down, so split the flat schema here so the agent still
  // gets an explicit required/optional contract.
  return { ...base, params: splitParams(tool.inputSchema) };
}

/**
 * Fourth disclosure level: project ONE action's exact contract from the catalog
 * (the single source of truth). The flat tool schema is intentionally permissive
 * — enums there are the union across actions — so this drill-down is where an
 * agent gets the precise required/optional split for the action it is about to
 * call, every field carrying its doc-grounded type/enum/description.
 */
function describeToolAction(tools: ToolSpec[], name: string, action: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new ValidationError(
      `Unknown tool "${name}".`,
      "Call discover({}) then discover({ domain }) to list valid tool names.",
    );
  }
  const operationId = tool.actions?.[action];
  if (!operationId) {
    const available = tool.actions ? Object.keys(tool.actions) : [];
    throw new ValidationError(
      `Tool "${name}" has no action "${action}".`,
      available.length > 0
        ? `Valid actions: ${available.join(", ")}.`
        : `"${name}" is not an action-routed verb — call discover({ tool: "${name}" }) for its full input schema.`,
    );
  }
  const op = getOperation(operationId);
  if (!op) {
    throw new ValidationError(
      `Action "${action}" routes to unknown operation "${operationId}".`,
      "The spec may have changed; regenerate the catalog (pnpm run gen).",
    );
  }
  const { properties, required } = projectOperation(op);
  const contract = actionContract(name, action);

  // Action-specific hard-required params: the catalog op marks them optional, but
  // THIS intent action requires them (e.g. position.close needs symbol, else it
  // would close the whole category).
  const requiredSet = new Set(required);
  for (const param of contract?.alsoRequired ?? []) {
    if (properties[param]) requiredSet.add(param);
  }

  // Conditional rules attach a `requiredWhen` annotation to a param's fragment,
  // wherever it lands (required or optional), so the obligation travels with the
  // field — not just in a separate list.
  const condByParam = new Map(
    (contract?.conditional ?? []).map((rule) => [rule.param, rule] as const),
  );
  const toParam = (paramName: string): Record<string, unknown> => {
    const fragment: Record<string, unknown> = {
      name: paramName,
      ...properties[paramName],
    };
    const cond = condByParam.get(paramName);
    if (cond) {
      fragment.requiredWhen = cond.requiredWhen;
      if (cond.trigger) fragment.requiredWhenTrigger = cond.trigger;
    }
    return fragment;
  };

  const riskLevel = riskLevelOf(op);
  const contractView: Record<string, unknown> = {
    tool: name,
    action,
    operationId,
    method: op.method,
    path: op.path,
    auth: op.auth,
    isWrite: op.isWrite,
    // only high-risk ops are gated by --confirm; ordinary writes execute live once --dry-run is omitted.
    riskLevel,
    requiresConfirm: riskLevel === "high",
    summary: op.summary,
    description: op.description,
    required: [...requiredSet].map(toParam),
    optional: Object.keys(properties)
      .filter((paramName) => !requiredSet.has(paramName))
      .map(toParam),
  };
  // A compact, top-level list of the conditional obligations so an agent reads the
  // "required only when…" rules at a glance, without scanning every optional field.
  if (contract?.conditional?.length) {
    contractView.conditionalRequired = contract.conditional.map((rule) => ({
      param: rule.param,
      requiredWhen: rule.requiredWhen,
      ...(rule.trigger ? { trigger: rule.trigger } : {}),
    }));
  }
  return contractView;
}

/**
 * Keyword search across the business surface (design §5.1, the "I don't know
 * which domain" entry). Scores name > action > front > description so the most
 * direct hit ranks first, and reports which actions/fronts matched so the agent
 * sees *why* a tool surfaced. Meta tools (raw, discover) are excluded — they are
 * listed under `meta`, not searched for by intent.
 */
function searchTools(tools: ToolSpec[], query: string) {
  const q = query.toLowerCase();
  const scored = tools
    .filter((t) => t.domain !== META_DOMAIN)
    .map((t) => {
      const matchedActions = t.actions
        ? Object.keys(t.actions).filter((a) => a.toLowerCase().includes(q))
        : [];
      const matchedFronts = t.fronts.filter((f) => f.toLowerCase().includes(q));
      let score = 0;
      if (t.name.toLowerCase().includes(q)) score += 100;
      score += matchedActions.length * 50;
      score += matchedFronts.length * 20;
      if (t.description.toLowerCase().includes(q)) score += 10;
      return { tool: t, score, matchedActions, matchedFronts };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      search: query,
      matches: [],
      note: `No tool matches "${query}". Call discover({}) to see domains, or try a broader keyword.`,
    };
  }
  return {
    search: query,
    matches: scored.map(({ tool, matchedActions, matchedFronts }) => ({
      name: tool.name,
      domain: tool.domain,
      description: tool.description,
      ...(matchedActions.length ? { matchedActions } : {}),
      ...(matchedFronts.length ? { matchedFronts } : {}),
    })),
    hint: "Call discover({ tool }) for a match's full input schema.",
  };
}

/**
 * `discover` — progressive, in-core discovery of the active tool surface
 * (design guide §5.1). Layered disclosure keeps the entry point to "一屏":
 *   discover({})            → domains + tool counts (the map)
 *   discover({ domain })    → that domain's tools with one-line descriptions
 *   discover({ tool })      → one tool's full input schema + metadata; action
 *                             verbs get a drill-down hint, action-less tools an
 *                             explicit required/optional param split
 *   discover({ tool, action }) → that action's exact required/optional contract
 *   discover({ search })    → keyword search across the surface (skips domains)
 *
 * Discovery lives here in the SDK core (not in a frontend) so every consumer —
 * cli / mcp / skill — discovers the surface the same way. `listActiveTools`
 * returns the surface for the current config, so discover reflects exactly what
 * is callable (intent vs full, module/readOnly filtering included).
 */
export function buildDiscoverTool(listActiveTools: () => ToolSpec[]): ToolSpec {
  return {
    name: DISCOVER_TOOL_NAME,
    module: "core",
    domain: META_DOMAIN,
    fronts: [],
    method: "GET",
    path: "(introspection)",
    auth: "public",
    isWrite: false,
    riskLevel: "read",
    description:
      "[META] Discover the tool surface. discover({}) lists domains; discover({ domain }) lists that domain's tools; discover({ tool }) returns one tool's full input schema for execution; discover({ search }) keyword-searches the whole surface.",
    inputSchema: discoverSchema(),
    handler: async (args) => {
      const tools = listActiveTools();
      const tool = readString(args, "tool");
      const domain = readString(args, "domain");
      const action = readString(args, "action");
      const search = readString(args, "search");
      const data = tool
        ? action
          ? describeToolAction(tools, tool, action)
          : describeTool(tools, tool)
        : domain
          ? listDomain(tools, domain)
          : search
            ? searchTools(tools, search)
            : overview(tools);
      return {
        endpoint: "(introspection) discover",
        requestTime: new Date().toISOString(),
        data,
      };
    },
  };
}
