/**
 * fetchRazorpaySubscription against a real local HTTP server: response
 * handling, and that the timeout is a genuine HTTP deadline. A stalled
 * request is aborted and its connection closed at the deadline (the server
 * sees the socket close), not merely stopped being awaited.
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "http";
import type { AddressInfo, Socket } from "net";
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { __clearServerEnvForTesting } from "@/lib/env";
import {
  fetchRazorpaySubscription,
  RAZORPAY_LOOKUP_TIMEOUT_MS,
  RazorpayLookupError,
} from "@/server/services/razorpay.subscription.service";

const KEY_ID = "rzp_test_fetchtest";
const KEY_SECRET = "test-only-fetch-secret";

beforeAll(() => {
  vi.stubEnv("RAZORPAY_KEY_ID", KEY_ID);
  vi.stubEnv("RAZORPAY_KEY_SECRET", KEY_SECRET);
  __clearServerEnvForTesting();
});
afterAll(() => {
  vi.unstubAllEnvs();
  __clearServerEnvForTesting();
});

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

type TestServer = {
  baseUrl: string;
  requests: { url: string; authorization: string | undefined }[];
  /** Resolves when a request's socket has closed. */
  socketClosed: Promise<number>;
  openSockets: () => number;
  close: () => Promise<void>;
};

let current: TestServer | null = null;

async function startServer(handler: Handler): Promise<TestServer> {
  const sockets = new Set<Socket>();
  let resolveClosed!: (t: number) => void;
  const socketClosed = new Promise<number>((r) => (resolveClosed = r));
  const requests: TestServer["requests"] = [];
  const server: Server = createServer((req, res) => {
    requests.push({ url: req.url ?? "", authorization: req.headers.authorization });
    handler(req, res);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
      resolveClosed(Date.now());
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  current = {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    socketClosed,
    openSockets: () => sockets.size,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
  return current;
}

afterEach(async () => {
  await current?.close();
  current = null;
});

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(RazorpayLookupError);
    return e as RazorpayLookupError;
  }
  throw new Error("expected the lookup to fail");
}

describe("fetchRazorpaySubscription: responses", () => {
  it("returns the compared fields only, using the configured key", async () => {
    const s = await startServer((_req, res) =>
      json(res, 200, {
        id: "sub_Abc123",
        status: "active",
        plan_id: "plan_X",
        current_start: 1_800_000_000,
        current_end: 1_802_592_000,
        ended_at: null,
        paid_count: 2,
        notes: { userId: "user-uuid", email: "someone@example.com" },
        customer_id: "cust_1",
        short_url: "https://rzp.io/i/x",
      })
    );
    const snap = await fetchRazorpaySubscription("sub_Abc123", { baseUrl: s.baseUrl });
    expect(snap).toEqual({
      id: "sub_Abc123",
      status: "active",
      planId: "plan_X",
      currentStart: 1_800_000_000,
      currentEnd: 1_802_592_000,
      endedAt: null,
      paidCount: 2,
      notesUserId: "user-uuid",
    });
    expect(JSON.stringify(snap)).not.toContain("someone@example.com");
    expect(s.requests).toHaveLength(1);
    expect(s.requests[0]!.url).toBe("/v1/subscriptions/sub_Abc123");
    expect(s.requests[0]!.authorization).toBe(
      `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`
    );
  });

  it.each([
    [
      "not_found",
      "400 'does not exist'",
      400,
      {
        error: {
          code: "BAD_REQUEST_ERROR",
          description: "The id provided does not exist",
        },
      },
    ],
    ["not_found", "404", 404, { error: { code: "NOT_FOUND" } }],
    [
      "http_error",
      "another 400",
      400,
      { error: { code: "BAD_REQUEST_ERROR", description: "bad" } },
    ],
    ["http_error", "401", 401, { error: { code: "BAD_REQUEST_ERROR" } }],
    ["http_error", "500", 500, { error: { code: "SERVER_ERROR" } }],
  ])("%s for %s", async (kind, _label, status, body) => {
    const s = await startServer((_req, res) => json(res, status, body));
    const e = await failure(
      fetchRazorpaySubscription("sub_Abc123", { baseUrl: s.baseUrl })
    );
    expect(e.kind).toBe(kind);
    expect(e.status).toBe(status);
  });

  it("invalid JSON and a different ID are invalid responses", async () => {
    let body = "not json";
    const s = await startServer((_req, res) => {
      res.writeHead(200);
      res.end(body);
    });
    expect(
      (await failure(fetchRazorpaySubscription("sub_Abc123", { baseUrl: s.baseUrl })))
        .kind
    ).toBe("invalid_response");
    body = JSON.stringify({ id: "sub_Other", status: "active" });
    expect(
      (await failure(fetchRazorpaySubscription("sub_Abc123", { baseUrl: s.baseUrl })))
        .kind
    ).toBe("invalid_response");
  });

  it("rejects a malformed ID without making a request", async () => {
    const s = await startServer((_req, res) => json(res, 200, {}));
    for (const id of ["pending_x", "sub_../payments", "sub_", "SUB_abc", ""]) {
      expect(
        (await failure(fetchRazorpaySubscription(id, { baseUrl: s.baseUrl }))).kind
      ).toBe("not_found");
    }
    expect(s.requests).toHaveLength(0);
  });

  it("a refused connection is a network error, and errors never carry credentials", async () => {
    const s = await startServer((_req, res) => json(res, 200, {}));
    const baseUrl = s.baseUrl;
    await s.close();
    current = null;
    const e = await failure(fetchRazorpaySubscription("sub_Abc123", { baseUrl }));
    expect(e.kind).toBe("network_error");
    const serialized = JSON.stringify({ ...e, message: e.message, stack: e.stack });
    expect(serialized).not.toContain(KEY_SECRET);
    expect(serialized).not.toContain(
      Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")
    );
  });

  it("defaults to an 8-second deadline", () => {
    expect(RAZORPAY_LOOKUP_TIMEOUT_MS).toBe(8_000);
  });
});

describe("fetchRazorpaySubscription: genuine timeout", () => {
  it("aborts a request that never gets a response, and closes its connection", async () => {
    const s = await startServer(() => {
      /* never respond */
    });
    const started = Date.now();
    const e = await failure(
      fetchRazorpaySubscription("sub_Abc123", { baseUrl: s.baseUrl, timeoutMs: 200 })
    );
    const rejectedAt = Date.now();
    expect(e.kind).toBe("timeout");
    expect(rejectedAt - started).toBeGreaterThanOrEqual(190);
    expect(rejectedAt - started).toBeLessThan(1_500);

    // The client tore the connection down: the server sees the socket close
    // promptly, so nothing keeps running (or holding a socket) after the deadline.
    const closedAt = await Promise.race([
      s.socketClosed,
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error("socket still open")), 1_500)
      ),
    ]);
    expect(closedAt - started).toBeLessThan(1_500);
    expect(s.openSockets()).toBe(0);
  });

  it("is a deadline for the whole exchange: a body that keeps trickling is aborted too", async () => {
    let writes = 0;
    let stopped: number | null = null;
    const s = await startServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"id":"sub_Abc123",');
      const timer = setInterval(() => {
        writes++;
        res.write(" ");
      }, 50);
      req.socket.on("close", () => {
        clearInterval(timer);
        stopped = Date.now();
      });
    });
    const started = Date.now();
    const e = await failure(
      fetchRazorpaySubscription("sub_Abc123", { baseUrl: s.baseUrl, timeoutMs: 300 })
    );
    expect(e.kind).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(1_500);
    await s.socketClosed;
    expect(stopped).not.toBeNull();
    expect(stopped! - started).toBeLessThan(1_500);

    // After the abort the server can no longer write to the client.
    const writesAtAbort = writes;
    await new Promise((r) => setTimeout(r, 200));
    expect(writes).toBe(writesAtAbort);
  });

  it("times out only at the deadline: a slow but timely response succeeds", async () => {
    const s = await startServer((_req, res) =>
      setTimeout(() => json(res, 200, { id: "sub_Abc123", status: "active" }), 100)
    );
    const snap = await fetchRazorpaySubscription("sub_Abc123", {
      baseUrl: s.baseUrl,
      timeoutMs: 1_000,
    });
    expect(snap.status).toBe("active");
  });
});
