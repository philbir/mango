import { ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  accessSync: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: mocks.spawn,
}));

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  accessSync: mocks.accessSync,
}));

const createChild = () => {
  const child = new ChildProcess();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  vi.spyOn(child, "kill").mockReturnValue(true);
  return { child, stdin, stdout, stderr };
};

const mockCli = (authError = false) => {
  mocks.spawn.mockImplementation((_command: string, args: string[]) => {
    const { child, stdin, stdout, stderr } = createChild();

    if (args.includes("--acp")) {
      stdin.on("data", (chunk: Buffer) => {
        const request = JSON.parse(chunk.toString());
        queueMicrotask(() => {
          if (request.method === "initialize") {
            stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
          } else if (request.method === "session/new") {
            stdout.write(`${JSON.stringify(authError
              ? { id: 2, error: { message: "Authentication required" } }
              : {
                  id: 2,
                  result: {
                    sessionId: "test-session",
                    models: {
                      availableModels: [{ modelId: "test-model", name: "Test model" }],
                    },
                  },
                })}\n`);
          }
        });
      });
    } else {
      queueMicrotask(() => {
        if (args.includes("--version")) {
          stdout.write("GitHub Copilot CLI 1.0.90-1\n");
          child.emit("close", 0);
        } else if (authError) {
          stderr.write("No authentication information found.");
          child.emit("close", 1);
        } else {
          stdout.write(`${JSON.stringify({
            type: "assistant.message",
            data: { content: "Test response" },
          })}\n`);
          child.emit("close", 0);
        }
      });
    }
    return child;
  });
};

describe("Copilot authentication context", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.spawn.mockReset();
    mocks.accessSync.mockReset();
    for (const name of ["COPILOT_HOME", "COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]) {
      vi.stubEnv(name, undefined);
    }
    mockCli();
  });

  afterEach(() => {
    if (vi.isFakeTimers()) {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([undefined, "/custom/copilot-home"])(
    "preserves saved-login configuration with COPILOT_HOME=%s for models and chat",
    async (home) => {
      vi.stubEnv("COPILOT_HOME", home);
      const { buildCopilotProvider } = await import("../src/providers/copilot.js");
      const provider = buildCopilotProvider({ cliPath: "/test/copilot" });
      expect(provider.configured).toBe(true);
      await expect(provider.validate?.()).resolves.toMatchObject({
        modelSource: "Copilot CLI (live account catalog)",
      });
      await expect(provider.listModels()).resolves.toEqual([
        { id: "test-model", name: "Test model" },
      ]);
      await expect(provider.chat({
        systemPrompt: "System context",
        messages: [{ role: "user", content: "Hello" }],
      })).resolves.toEqual({ text: "Test response", model: "auto" });

      const sessions = mocks.spawn.mock.calls.filter(([, args]) =>
        args.includes("--acp") || args.includes("-p"));
      expect(sessions).toHaveLength(2);
      for (const [, args, options] of sessions) {
        expect(args).not.toContain("--config-dir");
        expect(args).toContain("--no-custom-instructions");
        expect(args).toContain("--disable-builtin-mcps");
        expect(options.cwd).toBe(tmpdir());
        expect(options.env.COPILOT_HOME).toBe(home);
      }
    },
  );

  it.each(["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"])(
    "inherits %s for both model discovery and chat",
    async (name) => {
      vi.stubEnv(name, "test-token");
      const { buildCopilotProvider } = await import("../src/providers/copilot.js");
      const provider = buildCopilotProvider({ cliPath: "/test/copilot" });
      await provider.listModels();
      await provider.chat({
        systemPrompt: "",
        messages: [{ role: "user", content: "Hello" }],
      });
      expect(mocks.spawn).toHaveBeenCalledTimes(2);
      for (const [, , options] of mocks.spawn.mock.calls) {
        expect(options.env[name]).toBe("test-token");
      }
    },
  );

  it("surfaces real authentication failures from validation and chat", async () => {
    mockCli(true);
    const { buildCopilotProvider } = await import("../src/providers/copilot.js");
    const provider = buildCopilotProvider({ cliPath: "/test/copilot" });
    await expect(provider.validate?.()).rejects.toThrow("Authentication required");
    await expect(provider.chat({
      systemPrompt: "",
      messages: [{ role: "user", content: "Hello" }],
    })).rejects.toThrow("No authentication information found.");
  });

  it("remains unconfigured when the CLI is missing", async () => {
    mocks.accessSync.mockImplementation(() => { throw new Error("ENOENT"); });
    const { buildCopilotProvider } = await import("../src/providers/copilot.js");
    expect(buildCopilotProvider({ cliPath: "/missing/copilot" }).configured).toBe(false);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("runs follow-ups as fresh text-only requests with conversation history", async () => {
    const { buildCopilotProvider } = await import("../src/providers/copilot.js");
    const provider = buildCopilotProvider({ cliPath: "/test/copilot" });
    const first = await provider.chat({
      systemPrompt: "Use the supplied schema",
      messages: [{ role: "user", content: "Show recent documents" }],
    });
    await provider.chat({
      systemPrompt: "Use the supplied schema",
      messages: [
        { role: "user", content: "Show recent documents" },
        { role: "assistant", content: first.text },
        { role: "user", content: "Only include active documents" },
      ],
    });
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    for (const [, args] of mocks.spawn.mock.calls) {
      expect(args[args.indexOf("--available-tools") + 1]).toBe("*");
      expect(args).toContain("--no-ask-user");
      expect(args).not.toContain("--allow-all-tools");
      expect(args).not.toContain("--resume");
    }
    const args = mocks.spawn.mock.calls[1]![1];
    const prompt = args[args.indexOf("-p") + 1];
    expect(prompt).toContain("No tools are available.");
    expect(prompt).toContain("User: Show recent documents");
    expect(prompt).toContain("Assistant: Test response");
    expect(prompt).toContain("User: Only include active documents");
  });

  it("returns on the terminal result even when the process keeps stdio open", async () => {
    const { child, stdout } = createChild();
    mocks.spawn.mockReturnValue(child);
    const { buildCopilotProvider } = await import("../src/providers/copilot.js");
    const response = buildCopilotProvider({ cliPath: "/test/copilot" }).chat({
      systemPrompt: "",
      messages: [{ role: "user", content: "Follow up" }],
    });
    stdout.write('{"type":"session.tools_updated","data":{"model":"test-model"}}\n');
    stdout.write('{"type":"assistant.message","data":{"content":"Answer"}}\n');
    stdout.write('{"type":"result"}\n');
    await expect(response).resolves.toEqual({ text: "Answer", model: "test-model" });
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit("close", 0);
  });

  it("reads a final message without a trailing newline on normal exit", async () => {
    const { child, stdout } = createChild();
    mocks.spawn.mockReturnValue(child);
    const { buildCopilotProvider } = await import("../src/providers/copilot.js");
    const response = buildCopilotProvider({ cliPath: "/test/copilot" }).chat({
      systemPrompt: "",
      messages: [{ role: "user", content: "Hello" }],
    });
    stdout.write('{"type":"assistant.message","data":{"content":"Answer"}}');
    child.emit("close", 0);
    await expect(response).resolves.toMatchObject({ text: "Answer" });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("times out a stalled request and forcibly stops a CLI that ignores termination", async () => {
    vi.useFakeTimers();
    const { child } = createChild();
    mocks.spawn.mockReturnValue(child);
    const { buildCopilotProvider } = await import("../src/providers/copilot.js");
    const response = buildCopilotProvider({ cliPath: "/test/copilot" }).chat({
      systemPrompt: "",
      messages: [{ role: "user", content: "Hello" }],
    });
    const rejected = expect(response).rejects.toThrow("timed out after 120 seconds");
    await vi.advanceTimersByTimeAsync(120_000);
    await rejected;
    expect(child.kill).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenLastCalledWith("SIGKILL");
    child.emit("close", null);
  });

  it("clears the request timeout after completion", async () => {
    vi.useFakeTimers();
    const { child, stdout } = createChild();
    mocks.spawn.mockReturnValue(child);
    const { buildCopilotProvider } = await import("../src/providers/copilot.js");
    const response = buildCopilotProvider({ cliPath: "/test/copilot" }).chat({
      systemPrompt: "",
      messages: [{ role: "user", content: "Hello" }],
    });
    stdout.write('{"type":"assistant.message","data":{"content":"Answer"}}\n');
    stdout.write('{"type":"result"}\n');
    await response;
    child.emit("exit", 0);
    child.emit("close", 0);
    await vi.advanceTimersByTimeAsync(125_000);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 1])("rejects incomplete output when the CLI exits with %s", async (code) => {
    const { child, stdout, stderr } = createChild();
    mocks.spawn.mockReturnValue(child);
    const { buildCopilotProvider } = await import("../src/providers/copilot.js");
    const response = buildCopilotProvider({ cliPath: "/test/copilot" }).chat({
      systemPrompt: "",
      messages: [{ role: "user", content: "Hello" }],
    });
    if (code !== 0) {
      stdout.write('{"type":"assistant.message","data":{"content":"Partial"}}\n');
      stderr.write("CLI failure");
    }
    child.emit("close", code);
    await expect(response).rejects.toThrow(
      code === 0 ? "without an assistant response" : "CLI failure",
    );
  });

  it("rejects a failed terminal result even after an assistant message", async () => {
    const { child, stdout, stderr } = createChild();
    mocks.spawn.mockReturnValue(child);
    const { buildCopilotProvider } = await import("../src/providers/copilot.js");
    const response = buildCopilotProvider({ cliPath: "/test/copilot" }).chat({
      systemPrompt: "",
      messages: [{ role: "user", content: "Hello" }],
    });
    stdout.write('{"type":"assistant.message","data":{"content":"Partial"}}\n');
    stderr.write("Session failed");
    stdout.write('{"type":"result","exitCode":1}\n');
    await expect(response).rejects.toThrow("Session failed");
    child.emit("close", 1);
  });
});
