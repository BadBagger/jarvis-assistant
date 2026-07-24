import type { ChatProviderMessage } from "../models/types";

export type RetryRequestKind = "text" | "image-scan" | "image-gen";

export interface RetryRequest {
  kind: RetryRequestKind;
  prompt: string;
  imageDataUrl?: string;
  messages?: ChatProviderMessage[];
}

export type RetryQueueStatus = "queued" | "retrying" | "failed";

export interface RetryQueueItem {
  id: string;
  request: RetryRequest;
  assistantMessageId: string;
  error: string;
  attempts: number;
  status: RetryQueueStatus;
  createdAt: number;
  updatedAt: number;
}

export function createRetryQueueItem(params: {
  id: string;
  request: RetryRequest;
  assistantMessageId: string;
  error: string;
  now: number;
}): RetryQueueItem {
  return {
    id: params.id,
    request: params.request,
    assistantMessageId: params.assistantMessageId,
    error: params.error,
    attempts: 0,
    status: "queued",
    createdAt: params.now,
    updatedAt: params.now,
  };
}

export function markRetrying(items: RetryQueueItem[], id: string, now: number): RetryQueueItem[] {
  return items.map((item) =>
    item.id === id ? { ...item, status: "retrying", attempts: item.attempts + 1, updatedAt: now } : item,
  );
}

export function markRetryFailed(items: RetryQueueItem[], id: string, error: string, now: number): RetryQueueItem[] {
  return items.map((item) => (item.id === id ? { ...item, status: "failed", error, updatedAt: now } : item));
}

export function removeRetryItem(items: RetryQueueItem[], id: string): RetryQueueItem[] {
  return items.filter((item) => item.id !== id);
}

export function nextRetryItem(items: RetryQueueItem[]): RetryQueueItem | undefined {
  return [...items]
    .filter((item) => item.status !== "retrying")
    .sort((a, b) => a.createdAt - b.createdAt)[0];
}
