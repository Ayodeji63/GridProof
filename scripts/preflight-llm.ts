import "dotenv/config";
import { resolveLlmConfig, type LlmConfig } from "../apps/agent-worker/src/llm-config.js";

/**
 * Pre-demo check for the LLM path.
 *
 * The orchestrator catches every failure and returns `escalate`
 * (apps/agent-worker/src/orchestrator.ts), so a JSON-mode incompatibility, an
 * expired key, and a genuine low-confidence call all look identical from the
 * dashboard. This fires real requests and reports which of those actually
 * happened, before demo day rather than during it.
 *
 * Run: pnpm llm:preflight
 */

type ProbeOutcome =
  | { kind: "ok"; latencyMs: number; servedModel: string | null; jsonParsed: true }
  | { kind: "bad_json"; latencyMs: number; servedModel: string | null; snippet: string }
  | { kind: "http_error"; latencyMs: number; status: number; snippet: string }
  | { kind: "timeout"; latencyMs: number }
  | { kind: "network"; latencyMs: number; message: string };

type ProbeResult = {
  label: string;
  model: string;
  jsonMode: boolean;
  outcome: ProbeOutcome;
};

const PROBE_PROMPT =
  'Return ONLY a JSON object of the form {"status":"grid_up"|"grid_down","confidence":<number 0-1>}. ' +
  "A feeder reported three sensor heartbeats then went silent for 20 minutes. Classify it.";

const RUNS_PER_MODEL = Number(process.env.LLM_PREFLIGHT_RUNS ?? 3);

async function probe(
  config: LlmConfig["analysis"],
  label: string,
  jsonMode: boolean
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 20_000);
  const startedAt = performance.now();

  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: PROBE_PROMPT }],
        temperature: 0.1,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {})
      }),
      signal: controller.signal
    });

    const latencyMs = Math.round(performance.now() - startedAt);
    const raw = await response.text();

    if (!response.ok) {
      return {
        label,
        model: config.model,
        jsonMode,
        outcome: { kind: "http_error", latencyMs, status: response.status, snippet: raw.slice(0, 300) }
      };
    }

    const body = JSON.parse(raw) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const servedModel = body.model ?? null;
    const content = body.choices?.[0]?.message?.content ?? "";

    try {
      JSON.parse(content);
      return { label, model: config.model, jsonMode, outcome: { kind: "ok", latencyMs, servedModel, jsonParsed: true } };
    } catch {
      // This is the failure the orchestrator hides: a 200 whose content is not
      // parseable JSON still collapses to `escalate`.
      return {
        label,
        model: config.model,
        jsonMode,
        outcome: { kind: "bad_json", latencyMs, servedModel, snippet: content.slice(0, 300) }
      };
    }
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    if (error instanceof Error && error.name === "AbortError") {
      return { label, model: config.model, jsonMode, outcome: { kind: "timeout", latencyMs } };
    }
    return {
      label,
      model: config.model,
      jsonMode,
      outcome: {
        kind: "network",
        latencyMs,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function listCatalog(config: LlmConfig["analysis"]): Promise<string[] | null> {
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/v1/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: Array<{ id?: string }> };
    return (body.data ?? []).map((entry) => entry.id).filter((id): id is string => Boolean(id));
  } catch {
    return null;
  }
}

function describe(outcome: ProbeOutcome): string {
  switch (outcome.kind) {
    case "ok":
      return `ok      ${outcome.latencyMs}ms  served=${outcome.servedModel ?? "?"}`;
    case "bad_json":
      return `BAD JSON ${outcome.latencyMs}ms  served=${outcome.servedModel ?? "?"}  content="${outcome.snippet}"`;
    case "http_error":
      return `HTTP ${outcome.status} ${outcome.latencyMs}ms  body="${outcome.snippet}"`;
    case "timeout":
      return `TIMEOUT ${outcome.latencyMs}ms (raise LLM_TIMEOUT_MS)`;
    case "network":
      return `NETWORK ${outcome.latencyMs}ms  ${outcome.message}`;
  }
}

async function main(): Promise<void> {
  const config = resolveLlmConfig();

  console.log("GridProof LLM preflight\n");
  console.log(`  base URL : ${config.analysis.baseUrl}`);
  console.log(`  timeout  : ${config.analysis.timeoutMs}ms`);
  console.log(`  analysis : ${config.analysis.model || "(unset)"}`);
  console.log(`  verify   : ${config.verification.model || "(unset)"}\n`);

  if (config.issues.length > 0) {
    console.log("Configuration warnings:");
    for (const issue of config.issues) console.log(`  ! [${issue.env}] ${issue.message}`);
    console.log("");
  }

  const catalog = await listCatalog(config.analysis);
  if (catalog === null) {
    console.log("Could not read /v1/models. Is the FreeLLMAPI router running and the key valid?\n");
  } else {
    console.log(`Catalog: ${catalog.length} models available.`);
    for (const [label, model] of [
      ["LLM_ANALYSIS_MODEL", config.analysis.model],
      ["LLM_VERIFICATION_MODEL", config.verification.model]
    ] as const) {
      if (model && !catalog.includes(model)) {
        console.log(`  ! ${label}="${model}" is NOT in the catalog. Nearby: ${catalog.slice(0, 5).join(", ")}`);
      }
    }
    console.log("");
  }

  if (!config.analysis.model || !config.verification.model) {
    console.error("Both models must be set before probing. Pick concrete IDs from the catalog above.");
    process.exitCode = 1;
    return;
  }

  const results: ProbeResult[] = [];
  for (const [label, options] of [
    ["analysis", config.analysis],
    ["verification", config.verification]
  ] as const) {
    for (let run = 0; run < RUNS_PER_MODEL; run += 1) {
      results.push(await probe(options, `${label} #${run + 1}`, true));
    }
  }

  console.log(`Probes (json_object mode, ${RUNS_PER_MODEL} per model):`);
  for (const result of results) {
    console.log(`  ${result.label.padEnd(16)} ${describe(result.outcome)}`);
  }

  // If strict JSON mode failed, retry without it: that distinguishes "this
  // provider rejects response_format" from "the model cannot follow the prompt".
  const jsonFailures = results.filter(
    (result) => result.outcome.kind === "bad_json" || result.outcome.kind === "http_error"
  );
  if (jsonFailures.length > 0) {
    console.log("\nRetrying once without response_format to isolate the cause:");
    const fallback = await probe(config.analysis, "analysis (no json_object)", false);
    console.log(`  ${fallback.label.padEnd(26)} ${describe(fallback.outcome)}`);
    if (fallback.outcome.kind === "ok") {
      console.log("  -> The served provider rejects strict JSON mode; the model itself is fine.");
    }
  }

  const latencies = results
    .map((result) => result.outcome.latencyMs)
    .sort((left, right) => left - right);
  const slowest = latencies.at(-1) ?? 0;
  const budget = config.analysis.timeoutMs ?? 20_000;

  console.log("\nLatency:");
  console.log(`  median ${latencies[Math.floor(latencies.length / 2)] ?? 0}ms, slowest ${slowest}ms, budget ${budget}ms`);
  if (slowest > budget * 0.7) {
    console.log(`  ! Slowest probe used >70% of the abort budget. Raise LLM_TIMEOUT_MS before the demo.`);
  }

  const healthy = results.filter((result) => result.outcome.kind === "ok").length;
  console.log(`\n${healthy}/${results.length} probes returned parseable JSON.`);
  if (healthy < results.length) {
    console.log("Every non-ok probe above would surface in the dashboard as a plain 'escalate'.");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("Preflight crashed:", error);
  process.exitCode = 1;
});
