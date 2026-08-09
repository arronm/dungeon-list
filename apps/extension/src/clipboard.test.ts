import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "./clipboard.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyToClipboard", () => {
  it("uses the Clipboard API when the iframe permits it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await copyToClipboard("Y4Y9SJ");

    expect(writeText).toHaveBeenCalledWith("Y4Y9SJ");
  });

  it("falls back to a selected textarea when the iframe blocks the Clipboard API", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    const select = vi.fn();
    const remove = vi.fn();
    const input = {
      value: "",
      style: { position: "", opacity: "" },
      setAttribute: vi.fn(),
      select,
      remove
    };
    const appendChild = vi.fn();
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(input),
      body: { appendChild },
      execCommand
    });

    await copyToClipboard("Y4Y9SJ");

    expect(input.value).toBe("Y4Y9SJ");
    expect(appendChild).toHaveBeenCalledWith(input);
    expect(select).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(remove).toHaveBeenCalledOnce();
  });
});
