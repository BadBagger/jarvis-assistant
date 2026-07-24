import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModelScorer } from "./adapters/modelScorer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.join(__dirname, "cases");
const requiredTopLevelFields = ["id", "suite", "mode", "task", "input", "deterministic_expectations"];
const approvalRequiredPermissions = new Set(["reversible-write", "external-network", "dangerous"]);
const useCaseCapabilities = {
  chat: ["chat"],
  coding: ["chat", "coding"],
  vision: ["chat", "vision"],
  "image-generation": ["image-generation"],
  embeddings: ["embeddings"],
  "long-context": ["chat", "long-context"],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => (current == null ? undefined : current[key]), value);
}

function tokenize(value) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_'-]+/g)
    .map((token) => token.replace(/^['-]+|['-]+$/g, ""))
    .filter((token) => token.length >= 2);
}

function recordSearchText(record) {
  return [
    record.type,
    record.title,
    record.content,
    record.tags.join(" "),
    record.source.label,
    record.source.kind,
    record.project?.id ?? "",
    record.project?.name ?? "",
    record.project?.path ?? "",
  ].join(" ");
}

function scoreMemoryRecord(record, queryTokens, nowMs) {
  const searchable = recordSearchText(record).toLowerCase();
  const title = record.title.toLowerCase();
  const tags = record.tags.join(" ").toLowerCase();
  let score = 0;
  const reasons = new Set();

  for (const token of queryTokens) {
    if (!searchable.includes(token)) continue;
    score += 1;
    reasons.add(`matched "${token}"`);
    if (title.includes(token)) score += 2;
    if (tags.includes(token)) score += 1.5;
  }

  const ageDays = Math.max(0, (nowMs - Date.parse(record.updatedAt)) / 86_400_000);
  const recencyScore = 1 / (1 + ageDays / 14);
  score += recencyScore;
  if (recencyScore > 0.75) reasons.add("recent");

  score += typeof record.confidence === "number" ? Math.min(1, Math.max(0, record.confidence)) : 0.75;
  return score <= 0 ? null : { record, score, reasons: Array.from(reasons) };
}

function retrieveMemory(input) {
  const queryTokens = tokenize(input.query);
  const typeSet = input.types ? new Set(input.types) : null;
  const nowMs = Date.parse(input.now);
  return input.records
    .filter((record) => !typeSet || typeSet.has(record.type))
    .filter((record) => !record.project || (input.projectId && record.project.id === input.projectId))
    .map((record) => scoreMemoryRecord(record, queryTokens, nowMs))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, input.limit ?? 6));
}

function selectModelRoute(input) {
  const requiredCapabilities = useCaseCapabilities[input.use_case];
  assert(requiredCapabilities, `unknown model route use case: ${input.use_case}`);

  const enabledModels = input.models.filter((model) => model.enabled);
  const match = enabledModels.find((model) => requiredCapabilities.every((capability) => model.capabilities.includes(capability)));

  if (match) {
    return { status: "selected", model: match };
  }

  if (enabledModels.length > 0) {
    return {
      status: "unsupported-capability",
      requiredCapabilities,
      enabledModelIds: enabledModels.map((model) => model.id),
    };
  }

  return { status: "unavailable", requiredCapabilities, enabledModelIds: [] };
}

function validateCommon(testCase) {
  for (const field of requiredTopLevelFields) {
    assert(Object.hasOwn(testCase, field), `${testCase.id ?? "(missing id)"} missing ${field}`);
  }
  assert(typeof testCase.id === "string" && testCase.id.length > 0, "case id must be a non-empty string");
  assert(typeof testCase.suite === "string" && testCase.suite.length > 0, `${testCase.id} suite must be non-empty`);
  assert(testCase.mode === "deterministic" || testCase.mode === "model_scored", `${testCase.id} mode is invalid`);

  const requiredFields = testCase.deterministic_expectations.required_fields ?? [];
  for (const field of requiredFields) {
    assert(Object.hasOwn(testCase, field), `${testCase.id} required field missing: ${field}`);
  }

  const maxInputMessages = testCase.deterministic_expectations.max_input_messages;
  if (maxInputMessages !== undefined && Array.isArray(testCase.input.messages)) {
    assert(testCase.input.messages.length <= maxInputMessages, `${testCase.id} has too many input messages`);
  }
}

function assertIncludes(value, needles, caseId, label) {
  const haystack = String(value ?? "").toLowerCase();
  for (const needle of needles ?? []) {
    assert(haystack.includes(String(needle).toLowerCase()), `${caseId} ${label} must include "${needle}"`);
  }
}

function assertExcludes(value, needles, caseId, label) {
  const haystack = String(value ?? "").toLowerCase();
  for (const needle of needles ?? []) {
    assert(!haystack.includes(String(needle).toLowerCase()), `${caseId} ${label} must not include "${needle}"`);
  }
}

function runDeterministicChecks(testCase) {
  validateCommon(testCase);
  const expectations = testCase.deterministic_expectations;

  if (testCase.suite === "chat_quality" || testCase.suite === "coding_help") {
    const response = testCase.input.candidate_response;
    assert(typeof response === "string" && response.length > 0, `${testCase.id} missing candidate response`);
    assertIncludes(response, expectations.response_must_include, testCase.id, "candidate response");
    assertExcludes(response, expectations.response_must_not_include, testCase.id, "candidate response");
    if (expectations.max_response_words !== undefined) {
      assert(tokenize(response).length <= expectations.max_response_words, `${testCase.id} candidate response is too long`);
    }
  }

  if (testCase.suite === "vision_prompt_handling" && expectations.image_base64_min_length !== undefined) {
    assertIncludes(testCase.input.prompt, expectations.prompt_must_include, testCase.id, "prompt");
    assertExcludes(testCase.input.prompt, expectations.prompt_must_not_include, testCase.id, "prompt");
    assert(
      String(testCase.input.image_base64 ?? "").length >= expectations.image_base64_min_length,
      `${testCase.id} image_base64 is shorter than expected`,
    );
  }

  if (testCase.suite === "image_generation_request_shaping") {
    const shaped = expectations.shaped_request;
    assert(shaped && typeof shaped.prompt === "string", `${testCase.id} missing shaped prompt`);
    assertIncludes(shaped.prompt, expectations.prompt_must_include, testCase.id, "shaped prompt");
    assertExcludes(shaped.prompt, expectations.prompt_must_not_include, testCase.id, "shaped prompt");
    assert(expectations.allowed_dimensions.includes(shaped.options.width), `${testCase.id} width is not allowed`);
    assert(expectations.allowed_dimensions.includes(shaped.options.height), `${testCase.id} height is not allowed`);
    assert(shaped.options.steps <= expectations.max_steps, `${testCase.id} step count exceeds maximum`);
  }

  if (testCase.suite === "memory_retrieval") {
    const results = retrieveMemory(testCase.input);
    const resultIds = results.map((result) => result.record.id);
    assert(results[0]?.record.id === expectations.expected_top_id, `${testCase.id} top memory result mismatch`);
    for (const expectedId of expectations.expected_ids ?? []) {
      assert(resultIds.includes(expectedId), `${testCase.id} missing expected memory id ${expectedId}`);
    }
    if (expectations.minimum_top_score !== undefined) {
      assert(results[0].score >= expectations.minimum_top_score, `${testCase.id} top memory score too low`);
    }
  }

  if (testCase.suite === "hallucination_checks") {
    const response = testCase.input.candidate_response;
    assertIncludes(response, expectations.response_must_include, testCase.id, "candidate response");
    assertExcludes(response, expectations.response_must_not_include, testCase.id, "candidate response");
    if (expectations.requires_uncertainty_language) {
      assert(/\b(cannot|can't|not|need|verify|unavailable)\b/i.test(response), `${testCase.id} lacks uncertainty language`);
    }
  }

  if (testCase.suite === "tool_permission_decisions") {
    const actualDecision = approvalRequiredPermissions.has(testCase.input.permission_level)
      ? "approval_required"
      : "allow_without_approval";
    const actualAuditStatus =
      actualDecision === "approval_required" ? "approval-required" : testCase.input.default_dry_run ? "dry-run" : "completed";
    assert(actualDecision === expectations.expected_decision, `${testCase.id} permission decision mismatch`);
    assert(actualAuditStatus === expectations.expected_audit_status, `${testCase.id} audit status mismatch`);
    if (expectations.expected_default_dry_run !== undefined) {
      assert(testCase.input.default_dry_run === expectations.expected_default_dry_run, `${testCase.id} default dry-run mismatch`);
    }
  }

  if (testCase.suite === "model_routing_choices") {
    const result = selectModelRoute(testCase.input);
    assert(result.status === expectations.expected_status, `${testCase.id} model route status mismatch`);
    if (expectations.expected_model_id !== undefined) {
      assert(result.model?.id === expectations.expected_model_id, `${testCase.id} selected model mismatch`);
    }
    for (const capability of expectations.expected_required_capabilities ?? []) {
      assert(result.requiredCapabilities?.includes(capability), `${testCase.id} missing required capability ${capability}`);
    }
    if (expectations.expected_local_only !== undefined) {
      const isLocalOnly = result.model?.privacyLevel === "local-only";
      assert(isLocalOnly === expectations.expected_local_only, `${testCase.id} local-only expectation mismatch`);
    }
    if (expectations.expected_requires_network !== undefined) {
      assert(result.model?.requiresNetwork === expectations.expected_requires_network, `${testCase.id} network expectation mismatch`);
    }
  }
}

async function loadCases() {
  const files = (await readdir(casesDir)).filter((file) => file.endsWith(".json") || file.endsWith(".jsonl")).sort();
  const testCases = [];

  for (const file of files) {
    const fullPath = path.join(casesDir, file);
    const contents = await readFile(fullPath, "utf8");
    if (file.endsWith(".jsonl")) {
      contents
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line, index) => testCases.push({ ...JSON.parse(line), _source: `${file}:${index + 1}` }));
      continue;
    }

    const parsed = JSON.parse(contents);
    const cases = Array.isArray(parsed) ? parsed : [parsed];
    cases.forEach((testCase, index) => testCases.push({ ...testCase, _source: `${file}:${index + 1}` }));
  }

  return testCases;
}

async function main() {
  const scorer = new ModelScorer();
  const testCases = await loadCases();
  const results = [];

  for (const testCase of testCases) {
    let deterministicPassed = false;
    try {
      runDeterministicChecks(testCase);
      deterministicPassed = true;
    } catch (error) {
      results.push({
        id: testCase.id ?? "(missing id)",
        suite: testCase.suite ?? "(missing suite)",
        source: testCase._source,
        deterministicStatus: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    let modelScore = { status: "not-applicable" };
    if (testCase.mode === "model_scored") {
      try {
        modelScore = await scorer.score(testCase);
      } catch (error) {
        modelScore = {
          status: "error",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }

    results.push({
      id: testCase.id,
      suite: testCase.suite,
      source: testCase._source,
      deterministicStatus: deterministicPassed ? "passed" : "failed",
      modelScore,
    });
  }

  const failed = results.filter((result) => result.deterministicStatus === "failed");
  const modelSkipped = results.filter((result) => result.modelScore?.status === "skipped").length;
  const modelErrors = results.filter((result) => result.modelScore?.status === "error").length;
  const suites = new Set(results.map((result) => result.suite));

  for (const result of results) {
    const suffix =
      result.modelScore?.status === "skipped"
        ? " (model score skipped)"
        : result.modelScore?.status === "error"
          ? " (model score error, non-gating)"
          : "";
    console.log(`${result.deterministicStatus === "passed" ? "PASS" : "FAIL"} ${result.suite}/${result.id}${suffix}`);
    if (result.error) console.log(`  ${result.error}`);
    if (result.modelScore?.status === "error") console.log(`  ${result.modelScore.reason}`);
  }

  console.log("");
  console.log("Summary");
  console.log(`  Suites: ${suites.size}`);
  console.log(`  Cases: ${results.length}`);
  for (const suite of [...suites].sort()) {
    const suiteResults = results.filter((result) => result.suite === suite);
    const suiteFailures = suiteResults.filter((result) => result.deterministicStatus === "failed").length;
    console.log(`  ${suite}: ${suiteResults.length} case(s), ${suiteFailures} deterministic failure(s)`);
  }
  console.log(`Deterministic failures: ${failed.length}`);
  console.log(`Model-scored cases skipped: ${modelSkipped}`);
  console.log(`Model-scored cases errored: ${modelErrors}`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
