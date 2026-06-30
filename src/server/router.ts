import type { IncomingMessage, ServerResponse } from "node:http";
import type { CatalogOperation } from "../generated/catalog.js";
import type { MockState } from "./state.js";

export interface MockHandlerContext {
  req: IncomingMessage;
  body: Record<string, unknown>;
  query: URLSearchParams;
  state: MockState;
  op: CatalogOperation;
}

export type MockHandler = (ctx: MockHandlerContext) => Promise<unknown> | unknown;

interface Route {
  op: CatalogOperation;
  handler: MockHandler;
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

export class Router {
  private readonly routes = new Map<string, Route>();

  public register(op: CatalogOperation, handler: MockHandler): void {
    this.routes.set(`${op.method} ${op.path}`, { op, handler });
  }

  public hasRoute(method: string, path: string): boolean {
    return this.routes.has(`${method.toUpperCase()} ${path}`);
  }

  public async handle(
    req: IncomingMessage,
    res: ServerResponse,
    state: MockState,
  ): Promise<void> {
    const urlObj = new URL(req.url ?? "/", "http://localhost");
    const path = urlObj.pathname;
    const method = (req.method ?? "GET").toUpperCase();
    const key = `${method} ${path}`;

    const route = this.routes.get(key);
    if (!route) {
      send(res, 404, { code: "40404", msg: `Unknown endpoint: ${key}`, data: null });
      return;
    }

    const override = state.errorOverrides.get(key);
    if (override) {
      send(res, 200, { code: override.code, msg: override.msg, data: null });
      return;
    }

    // Auth enforcement is driven entirely by the catalog's `auth` field.
    if (route.op.auth === "private") {
      const h = req.headers;
      if (
        !h["access-key"] ||
        !h["access-sign"] ||
        !h["access-passphrase"] ||
        !h["access-timestamp"]
      ) {
        send(res, 200, { code: "40017", msg: "Invalid API key", data: null });
        return;
      }
    }

    let body: Record<string, unknown> = {};
    if (method === "POST") {
      try {
        body = await readBody(req);
      } catch {
        send(res, 200, { code: "40808", msg: "Invalid JSON body", data: null });
        return;
      }
    }

    const opId = route.op.operationId;
    try {
      const data = state.responseOverrides.has(opId)
        ? state.responseOverrides.get(opId)
        : await Promise.resolve(
            route.handler({ req, body, query: urlObj.searchParams, state, op: route.op }),
          );
      send(res, 200, {
        code: "00000",
        msg: "success",
        requestTime: Date.now(),
        data: data ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      send(res, 200, { code: "50000", msg, data: null });
    }
  }
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}
