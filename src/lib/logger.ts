/**
 * Structured logger for TypeFlow.
 *
 * - Uses structured JSON output in production.
 * - Uses formatted console output in development.
 * - Never logs: passwords, secrets, payment secrets, raw keystroke streams.
 * - Each log entry includes: level, timestamp, message, context.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  requestId?: string | undefined;
  userId?: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context?: Record<string, any> | undefined;
  error?: {
    message: string;
    code?: string | undefined;
    stack?: string | undefined;
  } | undefined;
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

function formatForDev(entry: LogEntry): string {
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const context = entry.context
    ? ` ${JSON.stringify(entry.context)}`
    : "";
  const errMsg = entry.error ? ` [${entry.error.message}]` : "";
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
    // Production: structured JSON
    process.stdout.write(JSON.stringify(entry) + "\n");
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
    message,
    timestamp: new Date().toISOString(),
  };
  if (context !== undefined) entry.context = context;
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
    let errorEntry: LogEntry["error"] | undefined;
    if (err instanceof Error) {
      const e: LogEntry["error"] = { message: err.message };
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== undefined) e.code = code;
      if (isDev && err.stack !== undefined) e.stack = err.stack;
      errorEntry = e;
    } else if (err) {
      errorEntry = { message: String(err) };
    }

    const entry = createEntry("error", message, context);
    if (errorEntry !== undefined) entry.error = errorEntry;
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
