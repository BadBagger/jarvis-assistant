export class ModelScorer {
  constructor(_options = {}) {}

  async score(_case) {
    return {
      status: "skipped",
      reason: "No model scorer is configured. Deterministic checks still ran.",
    };
  }
}
