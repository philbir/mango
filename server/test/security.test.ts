import { describe, expect, it } from "vitest";
import {
  isAllowedOrigin,
  redactErrorMessage,
  validateAiBaseUrl,
  validateMongoUri,
} from "../src/security.js";
import { redactUri } from "../src/store/crypto.js";

describe("origin checks", () => {
  it("allows the Vite dev origin by default", () => {
    expect(isAllowedOrigin("http://localhost:5173", "http://127.0.0.1:5180/api/health")).toBe(true);
  });

  it("allows same-origin loopback requests", () => {
    expect(isAllowedOrigin("http://127.0.0.1:5180", "http://127.0.0.1:5180/api/health")).toBe(true);
  });

  it("rejects unrelated origins", () => {
    expect(isAllowedOrigin("https://example.com", "http://127.0.0.1:5180/api/health")).toBe(false);
  });
});

describe("URI validation", () => {
  it("accepts MongoDB URI schemes", () => {
    expect(validateMongoUri("mongodb://localhost:27017/db")).toBeNull();
    expect(validateMongoUri("mongodb://host1:27017,host2:27017/db")).toBeNull();
    expect(validateMongoUri("mongodb+srv://cluster.example.com/db")).toBeNull();
  });

  it("rejects non-MongoDB URI schemes", () => {
    expect(validateMongoUri("http://localhost:27017")).toMatch(/mongodb/);
  });

  it("requires https for non-local AI base URLs", () => {
    expect(validateAiBaseUrl("https://api.example.com/v1")).toBeNull();
    expect(validateAiBaseUrl("http://localhost:11434/v1")).toBeNull();
    expect(validateAiBaseUrl("http://api.example.com/v1")).toMatch(/https/);
  });
});

describe("redaction", () => {
  it("redacts MongoDB passwords in display URIs", () => {
    expect(redactUri("mongodb://user:p%40ss@localhost:27017/db")).toContain("user:***@");
    expect(redactUri("mongodb://user:p@host1:27017,host2:27017/db")).toContain(
      "user:***@host1:27017,host2:27017",
    );
  });

  it("redacts secrets in error messages", () => {
    const msg = redactErrorMessage(
      "failed mongodb://user:secret@localhost:27017/db?apiKey=abc123 with sk-testsecret1234567890",
    );
    expect(msg).not.toContain("secret@");
    expect(msg).not.toContain("abc123");
    expect(msg).not.toContain("sk-testsecret");
  });
});
