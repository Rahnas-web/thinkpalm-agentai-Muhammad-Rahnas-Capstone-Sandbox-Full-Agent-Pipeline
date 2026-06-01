/**
 * CLI runner for the maritime QA agent pipeline (no UI).
 * Usage: set GROQ_API_KEY in .env, then: npm run pipeline
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

loadEnv();

const API_KEY = process.env.GROQ_API_KEY;
if (!API_KEY) {
  console.error("Missing GROQ_API_KEY. Copy .env.example to .env and add your key.");
  process.exit(1);
}

const MODEL = "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SCENARIO = `Feature: Crew Certification Expiry Alert System
The fleet management system must track crew member certifications (STCW, GMDSS, Medical Fitness, etc.) 
and automatically alert relevant stakeholders when certificates approach expiry. Alerts must be sent 
at 90, 60, 30, and 7 days before expiry. The system must prevent assignment of crew members with 
expired or expiring-within-30-days certificates to vessels. Shore managers and vessel masters must 
receive email and in-app notifications. SOLAS compliance requires mandatory certificate validation 
before departure clearance is granted. The system shall maintain an audit trail of all certification 
status changes and alert acknowledgements.`;

const SYSTEM_PROMPTS = {
  analyst: `You are a maritime software QA requirement analyst at ThinkPalm. Extract structured requirements from the feature description.
Output EXACTLY this format (no markdown, just plain text sections):
FUNCTIONAL REQUIREMENTS:
- [list each]
SAFETY-CRITICAL REQUIREMENTS:
- [list each, prefix with [SAFETY]]
COMPLIANCE REQUIREMENTS:
- [list each, prefix with [COMPLIANCE: <standard>]]
EDGE CASES TO TEST:
- [list each]
Be concise. Max 20 items total.`,
  bdd: `You are a BDD scenario writer for maritime QA at ThinkPalm. Given requirements, write Gherkin scenarios.
Output ONLY Gherkin syntax. Write 5-7 scenarios covering: happy path, safety-critical failures, compliance checks, edge cases. Include @tags like @safety @compliance @regression.`,
  playwright: `You are a Playwright test automation engineer for maritime software. Convert BDD scenarios to TypeScript Playwright tests.
Output runnable TypeScript using test(), expect(), page.goto(), etc. Max 50 lines.`,
  coverage: `You are a QA coverage analyst for maritime safety-critical software at ThinkPalm.
Given the feature spec, BDD scenarios, and Playwright tests, produce a coverage gap report with COVERAGE SUMMARY, COVERED AREAS, CRITICAL GAPS IDENTIFIED, RECOMMENDATIONS.`,
};

async function callLlm(systemPrompt, userMessage) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content || "";
}

async function main() {
  const memory = {};
  console.log("\n=== Maritime QA Pipeline (CLI) ===\n");

  console.log("1/4 Requirement Analyst...");
  memory.requirements = await callLlm(SYSTEM_PROMPTS.analyst, `Feature Description:\n${SCENARIO}`);
  console.log(memory.requirements.slice(0, 400) + "...\n");

  console.log("2/4 BDD Scenario Generator...");
  memory.bdd_scenarios = await callLlm(
    SYSTEM_PROMPTS.bdd,
    `Feature Description:\n${SCENARIO}\n\nExtracted Requirements:\n${memory.requirements}`
  );
  console.log(memory.bdd_scenarios.slice(0, 400) + "...\n");

  console.log("3/4 Playwright Script Writer...");
  memory.playwright_tests = await callLlm(
    SYSTEM_PROMPTS.playwright,
    `BDD Scenarios:\n${memory.bdd_scenarios}\n\nFeature Context:\n${SCENARIO}`
  );
  console.log(memory.playwright_tests.slice(0, 400) + "...\n");

  console.log("4/4 Coverage Analyst...");
  memory.coverage_report = await callLlm(
    SYSTEM_PROMPTS.coverage,
    `FEATURE SPEC:\n${SCENARIO}\n\nBDD SCENARIOS:\n${memory.bdd_scenarios}\n\nPLAYWRIGHT TESTS:\n${memory.playwright_tests}`
  );
  console.log(memory.coverage_report + "\n");

  const outPath = join(root, "maritime_qa_report.txt");
  const content = Object.entries(memory)
    .map(([k, v]) => `\n${"=".repeat(60)}\n${k.toUpperCase()}\n${"=".repeat(60)}\n${v}`)
    .join("\n");
  writeFileSync(outPath, `THINKPALM MARITIME QA PIPELINE RESULTS\n${new Date().toISOString()}\n${content}`, "utf8");
  console.log(`Done. Full report: ${outPath}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
