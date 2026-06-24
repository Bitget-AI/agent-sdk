import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CATALOG } from "../generated/catalog.js";
import { Router } from "./router.js";
import {
  createEmptyState,
  nextId,
  type MockOrder,
  type MockState,
} from "./state.js";
import { seedState } from "./fixtures.js";
import { OVERRIDES, defaultHandler } from "./overrides.js";

/**
 * Catalog-driven in-memory Bitget mock. Every operation in the generated
 * catalog is auto-registered, so the mock can never fall out of sync with the
 * spec: regenerate the catalog and the mock instantly covers new endpoints.
 * Curated operations get stateful behaviour via OVERRIDES; the rest return a
 * generic success stub.
 */
export class MockServer {
  private state: MockState;
  private readonly router: Router;
  private server: Server | null = null;
  private _baseUrl: string | null = null;

  public get baseUrl(): string {
    if (!this._baseUrl) {
      throw new Error("MockServer is not running. Call start() first.");
    }
    return this._baseUrl;
  }

  public constructor(initialState?: Partial<MockState>) {
    this.state = { ...createEmptyState(), ...initialState };
    seedState(this.state);
    this.router = new Router();
    const fallback = defaultHandler();
    for (const op of CATALOG) {
      this.router.register(op, OVERRIDES[op.operationId] ?? fallback);
    }
  }

  public start(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        void this.router.handle(req, res, this.state);
      });
      this.server.on("error", reject);
      this.server.listen(port, "127.0.0.1", () => {
        const addr = this.server!.address() as AddressInfo;
        this._baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve(addr.port);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      const srv = this.server;
      this.server = null;
      this._baseUrl = null;
      srv.close((err) => (err ? reject(err) : resolve()));
    });
  }

  public reset(): void {
    Object.assign(this.state, createEmptyState());
    seedState(this.state);
  }

  public getState(): MockState {
    return this.state;
  }

  public setState(patch: Partial<MockState>): void {
    Object.assign(this.state, patch);
  }

  /** Force a Bitget error envelope for `METHOD /path`. */
  public setErrorOverride(method: string, path: string, code: string, msg: string): void {
    this.state.errorOverrides.set(`${method.toUpperCase()} ${path}`, { code, msg });
  }

  /** Override the `data` payload for a given operationId. */
  public setResponseOverride(operationId: string, data: unknown): void {
    this.state.responseOverrides.set(operationId, data);
  }

  /** Seed a live order directly into state. */
  public seedOrder(order: Partial<MockOrder>): string {
    const orderId = order.orderId ?? nextId(this.state, "ORDER");
    const now = Date.now().toString();
    const full: MockOrder = {
      orderId,
      symbol: "BTCUSDT",
      category: "SPOT",
      side: "buy",
      orderType: "limit",
      price: "50000",
      size: "0.001",
      status: "live",
      filledSize: "0",
      cTime: now,
      uTime: now,
      ...order,
    };
    this.state.orders.set(orderId, full);
    return orderId;
  }
}
