import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "@/lib/logger";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should log info", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    logger.info("test info", { foo: "bar" });
    expect(spy).toHaveBeenCalled();
  });

  it("should log warn", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    logger.warn("test warn", { foo: "bar" });
    expect(spy).toHaveBeenCalled();
  });

  it("should log error with error object", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    logger.error("test error", new Error("oops"), { foo: "bar" });
    expect(spy).toHaveBeenCalled();
  });

  it("should log error with string", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    logger.error("test error", "string error");
    expect(spy).toHaveBeenCalled();
  });

  it("should support child logger", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const child = logger.child({ reqId: "123" });
    child.info("test child info", { extra: true });
    expect(spy).toHaveBeenCalled();
  });
});
