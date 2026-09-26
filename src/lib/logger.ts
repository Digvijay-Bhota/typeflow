/**
 * Structured logger for TypeFlow.
 *
 * - Uses structured JSON output in production (one line per entry; warn and
 *   error go to stderr, so the platform classifies them as such).
 * - Uses formatted console output in development.
 * - Errors are serialized with name, message, code, status, stack and cause,
 *   in every environment. Logs are server-side only; responses never include
 *   them.
 * - Never logs: passwords, secrets, payment secrets, raw keystroke streams.
 *   As a safety net, values under sensitive keys (password, secret, token,
 *   authorization, cookie, API key, signature, connection URL, …) and
 *   credentials embedded in strings (URL user:password, Bearer tokens, JWTs)
 *   are redacted from messages, errors and context.
 * - Each log entry includes: level, timestamp, message, context.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface SerializedError {
  name: string;
  message: string;
  code?: string | number | undefined;
  status?: number | undefined;
  meta?: unknown;
  stack?: string | undefined;
  cause?: SerializedError | undefined;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  requestId?: string | undefined;
  userId?: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context?: Record<string, any> | undefined;
  error?: SerializedError | undefined;
}

export interface Logger {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug(message: string, context?: Record<string, any> | undefined): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info(message: string, context?: Record<string, any> | undefined): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn(message: string, context?: Record<string, any> | undefined): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error(message: string, err?: unknown, context?: Record<string, any> | undefined): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  child(sharedContext: Record<string, any>): Logger;
}

const isDev = process.env.NODE_ENV === "development";
const isTest = process.env.NODE_ENV === "test";

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY =
  /passw(or)?d|pwd|secret|token|authori[sz]ation|cookie|api[-_]?key|private[-_]?key|signature|credential|service[-_]?role|(database|direct|redis|connection)[-_]?(url|string)|^dsn$/i;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // scheme://user:password@host → scheme://[REDACTED]@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, `$1${REDACTED}@`],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, REDACTED],
  [/\bsb_secret_[A-Za-z0-9_-]+/g, REDACTED],
  [
    /\b(password|passwd|pwd|secret|api[-_]?key|access[-_]?token|token)=[^\s&"',;]+/gi,
    `$1=${REDACTED}`,
  ],
];

const MAX_STRING = 4000;
const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_CAUSE_DEPTH = 3;

export function redactString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…[truncated]` : out;
}

/** Deep copy safe for JSON: sensitive keys and embedded credentials redacted. */
export function redactValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): unknown {
  if (typeof value === "string") return redactString(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) return serializeError(value);
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value)) return `[Binary ${value.byteLength} bytes]`;
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY)
      .map((item) => redactValue(item, depth + 1, seen));
    if (value.length > MAX_ARRAY) items.push(`[${value.length - MAX_ARRAY} more]`);
    return items;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(item, depth + 1, seen);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Error serialization
// ---------------------------------------------------------------------------

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(redactValue(value)) ?? String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * Serializes anything thrown into a JSON-safe, redacted shape. Only known
 * fields are copied from Error objects (arbitrary own properties, e.g. a
 * client's request config or command arguments, are not).
 */
export function serializeError(err: unknown, depth = 0): SerializedError {
  if (err instanceof Error) {
    const e = err as Error & {
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
      meta?: unknown;
      cause?: unknown;
    };
    const out: SerializedError = {
      name: e.name || "Error",
      message: redactString(e.message),
    };
    if (typeof e.code === "string" || typeof e.code === "number") out.code = e.code;
    const status = typeof e.status === "number" ? e.status : e.statusCode;
    if (typeof status === "number") out.status = status;
    if (e.meta !== undefined) out.meta = redactValue(e.meta);
    if (e.stack) out.stack = redactString(e.stack);
    if (e.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
      out.cause = serializeError(e.cause, depth + 1);
    }
    return out;
  }

  if (typeof err === "string") return { name: "NonError", message: redactString(err) };

  if (err !== null && typeof err === "object") {
    const o = err as { code?: unknown; status?: unknown; statusCode?: unknown };
    const out: SerializedError = {
      name: "NonError",
      message: redactString(safeJson(err)),
    };
    if (typeof o.code === "string" || typeof o.code === "number") out.code = o.code;
    const status = typeof o.status === "number" ? o.status : o.statusCode;
    if (typeof status === "number") out.status = status;
    return out;
  }

  return { name: "NonError", message: String(err) };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function formatForDev(entry: LogEntry): string {
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const context = entry.context ? ` ${JSON.stringify(entry.context)}` : "";
  const errMsg = entry.error ? ` [${entry.error.name}: ${entry.error.message}]` : "";
  return `[${time}] ${entry.level.toUpperCase()} ${entry.message}${context}${errMsg}`;
}

function log(entry: LogEntry): void {
  // Silence in test environment unless explicitly needed
  if (isTest && entry.level === "debug") return;

  if (isDev) {
    const formatted = formatForDev(entry);
    switch (entry.level) {
      case "debug":
        console.debug(formatted);
        break;
      case "info":
        console.debug(formatted);
        break;
      case "warn":
        console.warn(formatted);
        break;
      case "error":
        console.error(formatted);
        if (entry.error?.stack) {
          console.error(entry.error.stack);
        }
        break;
    }
  } else {
    // Production: structured JSON, one line per entry
    const line = JSON.stringify(entry) + "\n";
    if (entry.level === "warn" || entry.level === "error") {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }
}

function createEntry(
  level: LogLevel,
  message: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context?: Record<string, any> | undefined
): LogEntry {
  const entry: LogEntry = {
    level,
    message: redactString(message),
    timestamp: new Date().toISOString(),
  };
  if (context !== undefined) {
    entry.context = redactValue(context) as Record<string, unknown>;
  }
  return entry;
}

export const logger = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug(message: string, context?: Record<string, any>): void {
    log(createEntry("debug", message, context));
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info(message: string, context?: Record<string, any>): void {
    log(createEntry("info", message, context));
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn(message: string, context?: Record<string, any>): void {
    log(createEntry("warn", message, context));
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error(message: string, err?: unknown, context?: Record<string, any>): void {
    const entry = createEntry("error", message, context);
    if (err !== undefined && err !== null) entry.error = serializeError(err);
    log(entry);
  },

  /** Create a child logger with shared context (e.g., per-request logger) */
  child(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sharedContext: Record<string, any>
  ): Logger {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      debug: (msg: string, ctx?: Record<string, any>) =>
        logger.debug(msg, { ...sharedContext, ...ctx }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      info: (msg: string, ctx?: Record<string, any>) =>
        logger.info(msg, { ...sharedContext, ...ctx }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      warn: (msg: string, ctx?: Record<string, any>) =>
        logger.warn(msg, { ...sharedContext, ...ctx }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error: (msg: string, err?: unknown, ctx?: Record<string, any>) =>
        logger.error(msg, err, { ...sharedContext, ...ctx }),
      child: logger.child.bind(logger),
    };
  },
} satisfies Logger;

/**
 * Logs a failed API request. Expected client-side outcomes (an error carrying
 * an HTTP status below 500, e.g. a ServiceError) are warnings without a
 * stack; anything else is an error with full diagnostics. The caller still
 * returns its own sanitized response.
 */
export function logRequestFailure(
  message: string,
  err: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: Record<string, any>
): void {
  const status = (err as { status?: unknown } | null)?.status;
  if (err instanceof Error && typeof status === "number" && status < 500) {
    const { stack: _stack, ...summary } = serializeError(err);
    logger.warn(message, { ...context, error: summary });
    return;
  }
  logger.error(message, err, context);
}
