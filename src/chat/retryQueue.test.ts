import { describe, expect, it } from "vitest";
import { createRetryQueueItem, markRetryFailed, markRetrying, nextRetryItem, removeRetryItem } from "./retryQueue";

describe("retryQueue", () => {
  it("returns the oldest non-retrying item first", () => {
    const first = createRetryQueueItem({
      id: "first",
      request: { kind: "text", prompt: "one" },
      assistantMessageId: "a1",
      error: "offline",
      now: 10,
    });
    const second = createRetryQueueItem({
      id: "second",
      request: { kind: "image-gen", prompt: "two" },
      assistantMessageId: "a2",
      error: "offline",
      now: 20,
    });

    expect(nextRetryItem([second, first])?.id).toBe("first");
    expect(nextRetryItem(markRetrying([second, first], "first", 30))?.id).toBe("second");
  });

  it("tracks attempts and preserves items until removed", () => {
    const item = createRetryQueueItem({
      id: "retry-1",
      request: { kind: "image-scan", prompt: "describe", imageDataUrl: "data:image/png;base64,abc" },
      assistantMessageId: "assistant-1",
      error: "timeout",
      now: 100,
    });

    const retrying = markRetrying([item], item.id, 120);
    expect(retrying[0]).toMatchObject({ attempts: 1, status: "retrying", updatedAt: 120 });

    const failed = markRetryFailed(retrying, item.id, "still offline", 140);
    expect(failed[0]).toMatchObject({ attempts: 1, status: "failed", error: "still offline", updatedAt: 140 });

    expect(removeRetryItem(failed, item.id)).toEqual([]);
  });
});
