import { describe, expect, it } from "vitest";
import { fetchAllPages } from "@bitget-ai/bitget-agent-sdk";
import type { BitgetRestClient } from "@bitget-ai/bitget-agent-sdk";

/**
 * Deterministic fake client: returns the queued pages in order, recording the
 * args of every call so we can assert cursor/limit propagation. Cast to the
 * client type since fetchAllPages only needs `callOperation`.
 */
function fakeClient(pages: unknown[]) {
  const seen: Record<string, unknown>[] = [];
  let index = 0;
  const client = {
    async callOperation(_operationId: string, args: Record<string, unknown> = {}) {
      seen.push(args);
      const data = pages[index] ?? [];
      index += 1;
      return { endpoint: "GET /x", requestTime: "t", data, raw: {} };
    },
  };
  return { client: client as unknown as BitgetRestClient, seen };
}

describe("fetchAllPages", () => {
  it("walks pages until an empty page and advances the cursor", async () => {
    const { client, seen } = fakeClient([
      [{ orderId: "1" }, { orderId: "2" }],
      [{ orderId: "3" }],
      [],
    ]);
    const result = await fetchAllPages(client, "getOrderHistory", {
      category: "SPOT",
    });
    expect(result.items).toHaveLength(3);
    expect(result.pages).toBe(3);
    expect(result.truncated).toBe(false);
    // First call carries no cursor; later calls carry the prior page's last id.
    expect(seen[0].cursor).toBeUndefined();
    expect(seen[0].category).toBe("SPOT");
    expect(seen[1].cursor).toBe("2");
    expect(seen[2].cursor).toBe("3");
  });

  it("stops at the page cap and reports truncated", async () => {
    const { client } = fakeClient([
      [{ orderId: "1" }],
      [{ orderId: "2" }],
      [{ orderId: "3" }],
      [{ orderId: "4" }],
    ]);
    const result = await fetchAllPages(client, "op", {}, { pageCap: 2 });
    expect(result.pages).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("stops at the total cap and reports truncated", async () => {
    const { client } = fakeClient([
      [{ orderId: "1" }, { orderId: "2" }],
      [{ orderId: "3" }, { orderId: "4" }],
    ]);
    const result = await fetchAllPages(client, "op", {}, { totalCap: 3 });
    expect(result.items).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("honors custom cursor/page-size params", async () => {
    const { client, seen } = fakeClient([
      [{ id: "a" }],
      [],
    ]);
    await fetchAllPages(client, "op", {}, {
      cursorParam: "idLessThan",
      cursorField: "id",
      pageSizeParam: "limit",
      pageSize: 50,
    });
    expect(seen[0].limit).toBe(50);
    expect(seen[1].idLessThan).toBe("a");
  });

  it("stops when the cursor fails to advance (no infinite loop)", async () => {
    const { client } = fakeClient([
      [{ orderId: "1" }],
      [{ orderId: "1" }],
      [{ orderId: "1" }],
    ]);
    const result = await fetchAllPages(client, "op", {});
    // page 1 (cursor→"1"), page 2 (cursor "1" repeats → break after pushing).
    expect(result.pages).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it("extracts items from an object wrapper ({ list: [...] })", async () => {
    const { client } = fakeClient([
      { list: [{ id: "a" }, { id: "b" }] },
      { list: [] },
    ]);
    const result = await fetchAllPages(client, "op", {});
    expect(result.items).toHaveLength(2);
    expect(result.pages).toBe(2);
    expect(result.truncated).toBe(false);
  });
});
