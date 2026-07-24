export interface MemoryEmbeddingProvider {
  readonly id: string;
  readonly available: boolean;
  embed(input: string | string[]): Promise<number[][]>;
}

export class StubMemoryEmbeddingProvider implements MemoryEmbeddingProvider {
  readonly id = "stub-keyword-only";
  readonly available = false;

  async embed(input: string | string[]): Promise<number[][]> {
    const items = Array.isArray(input) ? input : [input];
    void items;
    throw new Error("Memory embeddings are not enabled yet. Keyword/recency retrieval is active.");
  }
}

export const defaultMemoryEmbeddingProvider = new StubMemoryEmbeddingProvider();
