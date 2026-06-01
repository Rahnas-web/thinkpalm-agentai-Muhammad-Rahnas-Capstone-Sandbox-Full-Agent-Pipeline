import { useState, useRef } from "react";

const SCENARIOS = [
  {
    id: "crew_cert",
    label: "Crew Certification Expiry Alerts",
    description: `Feature: Crew Certification Expiry Alert System
The fleet management system must track crew member certifications (STCW, GMDSS, Medical Fitness, etc.) 
and automatically alert relevant stakeholders when certificates approach expiry. Alerts must be sent 
at 90, 60, 30, and 7 days before expiry. The system must prevent assignment of crew members with 
expired or expiring-within-30-days certificates to vessels. Shore managers and vessel masters must 
receive email and in-app notifications. SOLAS compliance requires mandatory certificate validation 
before departure clearance is granted. The system shall maintain an audit trail of all certification 
status changes and alert acknowledgements.`
  },
  {
    id: "ais",
    label: "AIS Position Reporting",
    description: `Feature: AIS Vessel Position Reporting & Monitoring
The system integrates with AIS (Automatic Identification System) transponders on all fleet vessels 
to provide real-time position tracking. Class A vessels must transmit positions every 2-10 seconds 
when underway, every 3 minutes when anchored. Class B every 30 seconds. The system must detect 
AIS signal loss exceeding 15 minutes and raise a safety alert. Position data must be stored with 
timestamps for voyage reconstruction. Geofencing alerts must trigger when vessels enter/exit 
designated restricted zones (piracy zones, emission control areas, port approach corridors). 
The system must cross-validate AIS data with vessel's own GPS for discrepancy detection indicating 
potential GPS spoofing.`
  },
  {
    id: "port_ops",
    label: "Port Arrival/Departure Workflows",
    description: `Feature: Port Arrival and Departure Workflow Management
The system manages end-to-end port call workflows including pre-arrival notifications, berth 
requests, customs and immigration clearance, cargo manifest submission, and departure clearance. 
Vessels must submit Notice of Readiness (NOR) 24-72 hours before arrival. Port state control 
inspections must be tracked and deficiencies logged. The system enforces ISPS (International Ship 
and Port Facility Security) code compliance checks before departure. Dangerous goods declarations 
(IMDG) must be validated against cargo manifests. Ballast water management records must be 
updated on arrival and departure. The system must interface with port community systems (PCS) 
and generate vessel traffic service (VTS) reports automatically.`
  }
];

const GROQ_API = "/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

async function callClaude(systemPrompt, userMessage, onChunk) {
  const res = await fetch(GROQ_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ]
    })
  });
  if (!res.ok) {
    let detail = "";
    try {
      const errBody = await res.json();
      detail = errBody?.error?.message || JSON.stringify(errBody);
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(detail ? `API error ${res.status}: ${detail}` : `API error ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") break;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content || "";
          if (delta) { full += delta; onChunk(delta); }
        } catch {}
      }
    }
  }
  return full;
}

const AGENTS = {
  analyst: {
    name: "Requirement Analyst",
    icon: "ti-file-description",
    color: "#185FA5",
    bg: "#E6F1FB",
    role: "Parses maritime feature specs and extracts testable requirements, safety-critical paths, and compliance obligations (SOLAS, STCW, ISPS, MARPOL)."
  },
  bdd: {
    name: "BDD Scenario Generator",
    icon: "ti-list-check",
    color: "#0F6E56",
    bg: "#E1F5EE",
    role: "Converts requirements into structured Gherkin BDD test scenarios with Given/When/Then format, covering happy paths, edge cases, and compliance scenarios."
  },
  playwright: {
    name: "Playwright Script Writer",
    icon: "ti-code",
    color: "#533AB7",
    bg: "#EEEDFE",
    role: "Generates runnable Playwright TypeScript test scripts from BDD scenarios, including selectors, assertions, and test data setup."
  },
  coverage: {
    name: "Coverage Analyst",
    icon: "ti-chart-bar",
    color: "#854F0B",
    bg: "#FAEEDA",
    role: "Maps test cases against feature requirements, identifies coverage gaps, and flags safety-critical and compliance-related untested scenarios."
  }
};

const STEP_AGENTS = ["analyst", "bdd", "playwright", "coverage"];

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
Output ONLY Gherkin syntax like:
Feature: <name>

  Scenario: <title>
    Given <precondition>
    When <action>
    Then <expected result>

Write 5-7 scenarios covering: happy path, safety-critical failures, compliance checks, edge cases. Include @tags like @safety @compliance @regression.`,

  playwright: `You are a Playwright test automation engineer for maritime software. Convert BDD scenarios to TypeScript Playwright tests.
Output runnable TypeScript code using Playwright test framework.
Use: test(), expect(), page.goto(), page.fill(), page.click(), page.locator(), await expect(locator).toBeVisible()
Include: describe blocks, beforeEach setup, meaningful test names, comments for safety-critical assertions.
Keep tests realistic for a maritime fleet management web application. Max 50 lines.`,

  coverage: `You are a QA coverage analyst for maritime safety-critical software at ThinkPalm.
Given the feature spec, BDD scenarios, and Playwright tests, produce a coverage gap report.
Output EXACTLY this format:
COVERAGE SUMMARY:
- Total scenarios: X
- Covered by tests: X
- Coverage %: X%

COVERED AREAS:
- [list]

CRITICAL GAPS IDENTIFIED:
- [GAP] <description> | Risk: HIGH/MEDIUM/LOW | Compliance: <standard if applicable>

RECOMMENDATIONS:
- [list actionable next steps]

Focus on SOLAS, STCW, ISPS, MARPOL compliance and safety-critical maritime scenarios.`
};

function AgentCard({ agentKey, status, output, streaming }) {
  const agent = AGENTS[agentKey];
  const isActive = status === "running";
  const isDone = status === "done";
  const isPending = status === "pending";

  const cardClass = [
    "agent-card",
    isPending && "agent-card--pending",
    isActive && "agent-card--running",
    isDone && "agent-card--done",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cardClass} style={{ "--agent-color": agent.color }}>
      <div className="agent-card__head">
        <div className="agent-card__icon">
          <i className={`ti ${agent.icon}`} style={{ color: isDone || isActive ? agent.color : "var(--text-muted)" }} aria-hidden="true" />
        </div>
        <div style={{ flex: 1 }}>
          <div className="agent-card__name">{agent.name}</div>
          <div className={`agent-card__status ${isActive ? "agent-card__status--running" : ""} ${isDone ? "agent-card__status--done" : ""}`}>
            {isActive ? "● Running…" : isDone ? "✓ Complete" : "Waiting"}
          </div>
        </div>
        {isActive && <div className="spinner" style={{ borderColor: agent.color, borderTopColor: "transparent" }} />}
      </div>
      {(isActive || isDone) && output && (
        <div className="agent-card__output">
          {output}
          {streaming && <span className="cursor-blink">▋</span>}
        </div>
      )}
    </div>
  );
}

function MemoryPanel({ memory }) {
  return (
    <div className="panel" style={{ maxHeight: 200, overflowY: "auto" }}>
      <div className="memory-panel__title">
        <i className="ti ti-database" aria-hidden="true" />
        Pipeline Memory
      </div>
      {memory.length === 0 ? (
        <p className="panel__hint">No data stored yet.</p>
      ) : (
        memory.map((m, i) => (
          <div key={i} className="memory-panel__row">
            <span className="memory-panel__key">{m.key}</span>
            <span className="memory-panel__preview">{m.preview}</span>
          </div>
        ))
      )}
    </div>
  );
}

function CoverageReport({ report }) {
  if (!report) return null;

  const summaryMatch = report.match(/Coverage %:\s*(\d+)%/);
  const coveragePct = summaryMatch ? parseInt(summaryMatch[1]) : null;
  const gapsMatch = [...report.matchAll(/\[GAP\] (.+?) \| Risk: (HIGH|MEDIUM|LOW)/g)];

  const riskColor = { HIGH: "#ef4444", MEDIUM: "#f59e0b", LOW: "#34d399" };
  const riskClass = { HIGH: "high", MEDIUM: "medium", LOW: "low" };

  return (
    <div className="panel coverage-section">
      <div className="coverage-section__title">
        <i className="ti ti-report-analytics" style={{ color: "#f59e0b" }} aria-hidden="true" />
        Coverage Gap Report
      </div>

      {coveragePct !== null && (
        <div className="stats-grid">
          {[
            { label: "Coverage Score", value: `${coveragePct}%`, color: coveragePct >= 80 ? "#34d399" : coveragePct >= 60 ? "#f59e0b" : "#f87171" },
            { label: "Critical Gaps", value: gapsMatch.filter((m) => m[2] === "HIGH").length, color: "#f87171" },
            { label: "Total Gaps", value: gapsMatch.length, color: "#f59e0b" },
          ].map(({ label, value, color }) => (
            <div key={label} className="stat-card">
              <div className="stat-card__label">{label}</div>
              <div className="stat-card__value" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {gapsMatch.length > 0 && (
        <>
          <div className="section-title">Identified Gaps</div>
          <div className="gap-list">
            {gapsMatch.map((m, i) => (
              <div key={i} className={`gap-item gap-item--${riskClass[m[2]]}`}>
                <span className="gap-item__badge" style={{ background: riskColor[m[2]] }}>{m[2]}</span>
                <span>{m[1]}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="coverage-raw">{report}</div>
    </div>
  );
}

export default function App() {
  const [featureInput, setFeatureInput] = useState("");
  const [running, setRunning] = useState(false);
  const [agentStatus, setAgentStatus] = useState({ analyst: "pending", bdd: "pending", playwright: "pending", coverage: "pending" });
  const [agentOutput, setAgentOutput] = useState({ analyst: "", bdd: "", playwright: "", coverage: "" });
  const [streamingAgent, setStreamingAgent] = useState(null);
  const [memory, setMemory] = useState([]);
  const [coverageReport, setCoverageReport] = useState(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const memoryStore = useRef({});

  const storeMemory = (key, value) => {
    memoryStore.current[key] = value;
    setMemory(Object.entries(memoryStore.current).map(([k, v]) => ({
      key: k, preview: (v || "").slice(0, 80).replace(/\n/g, " ") + "..."
    })));
  };

  const resetPipeline = () => {
    setAgentStatus({ analyst: "pending", bdd: "pending", playwright: "pending", coverage: "pending" });
    setAgentOutput({ analyst: "", bdd: "", playwright: "", coverage: "" });
    setStreamingAgent(null);
    setMemory([]);
    setCoverageReport(null);
    setDone(false);
    setError("");
    memoryStore.current = {};
  };

  const runPipeline = async () => {
    const featureDesc = featureInput.trim();
    if (!featureDesc) {
      setError("Please enter a feature description or requirements in the text box.");
      return;
    }

    resetPipeline();
    setRunning(true);

    try {
      // AGENT 1: Requirement Analyst
      setAgentStatus(s => ({ ...s, analyst: "running" }));
      setStreamingAgent("analyst");
      let req = "";
      await callClaude(SYSTEM_PROMPTS.analyst, `Feature Description:\n${featureDesc}`, (chunk) => {
        req += chunk;
        setAgentOutput(o => ({ ...o, analyst: req }));
      });
      storeMemory("requirements", req);
      storeMemory("feature_spec", featureDesc);
      setAgentStatus(s => ({ ...s, analyst: "done" }));

      // AGENT 2: BDD Generator
      setAgentStatus(s => ({ ...s, bdd: "running" }));
      setStreamingAgent("bdd");
      let bdd = "";
      await callClaude(SYSTEM_PROMPTS.bdd,
        `Feature Description:\n${featureDesc}\n\nExtracted Requirements:\n${req}`,
        (chunk) => { bdd += chunk; setAgentOutput(o => ({ ...o, bdd })); }
      );
      storeMemory("bdd_scenarios", bdd);
      setAgentStatus(s => ({ ...s, bdd: "done" }));

      // AGENT 3: Playwright Writer
      setAgentStatus(s => ({ ...s, playwright: "running" }));
      setStreamingAgent("playwright");
      let pw = "";
      await callClaude(SYSTEM_PROMPTS.playwright,
        `BDD Scenarios:\n${bdd}\n\nFeature Context:\n${featureDesc}`,
        (chunk) => { pw += chunk; setAgentOutput(o => ({ ...o, playwright: pw })); }
      );
      storeMemory("playwright_tests", pw);
      setAgentStatus(s => ({ ...s, playwright: "done" }));

      // AGENT 4: Coverage Analyst
      setAgentStatus(s => ({ ...s, coverage: "running" }));
      setStreamingAgent("coverage");
      let cov = "";
      await callClaude(SYSTEM_PROMPTS.coverage,
        `FEATURE SPEC:\n${featureDesc}\n\nBDD SCENARIOS:\n${bdd}\n\nPLAYWRIGHT TESTS:\n${pw}`,
        (chunk) => { cov += chunk; setAgentOutput(o => ({ ...o, coverage: cov })); }
      );
      storeMemory("coverage_report", cov);
      setAgentStatus(s => ({ ...s, coverage: "done" }));
      setCoverageReport(cov);
      setDone(true);

    } catch (e) {
      setError(`Pipeline error: ${e.message}`);
    } finally {
      setStreamingAgent(null);
      setRunning(false);
    }
  };

  const exportResults = () => {
    const content = Object.entries(memoryStore.current).map(([k, v]) => `\n${"=".repeat(60)}\n${k.toUpperCase()}\n${"=".repeat(60)}\n${v}`).join("\n");
    const blob = new Blob([`THINKPALM MARITIME QA PIPELINE RESULTS\n${new Date().toISOString()}\n${content}`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "maritime_qa_report.txt"; a.click();
  };

  return (
    <div className="app">
      <h2 className="sr-only">Maritime QA Agentic Pipeline — ThinkPalm</h2>

      <header className="app-header">
        <div className="app-header__icon">
          <i className="ti ti-ship" aria-hidden="true" />
        </div>
        <div>
          <h1 className="app-header__title">Maritime QA Agent Pipeline</h1>
          <p className="app-header__subtitle">ThinkPalm · AI-powered test generation for maritime software</p>
          <div className="pipeline-flow">
            <span className="pipeline-flow__step"><i className="ti ti-file-description" /> Analyst</span>
            <span className="pipeline-flow__arrow">→</span>
            <span className="pipeline-flow__step"><i className="ti ti-list-check" /> BDD</span>
            <span className="pipeline-flow__arrow">→</span>
            <span className="pipeline-flow__step"><i className="ti ti-code" /> Playwright</span>
            <span className="pipeline-flow__arrow">→</span>
            <span className="pipeline-flow__step"><i className="ti ti-chart-bar" /> Coverage</span>
          </div>
        </div>
      </header>

      <section className="panel">
        <label htmlFor="feature-input" className="panel__label">
          <i className="ti ti-forms" aria-hidden="true" />
          Feature description / requirements
        </label>
        <textarea
          id="feature-input"
          className="feature-textarea"
          value={featureInput}
          onChange={(e) => setFeatureInput(e.target.value)}
          placeholder="Enter any feature spec, user story, requirements, or maritime domain description…"
          disabled={running}
        />
        <div className="panel__footer">
          <span className="panel__hint">
            {featureInput.length > 0 ? `${featureInput.length.toLocaleString()} characters` : "Supports any text — specs, stories, bullet lists, etc."}
          </span>
          <div className="chips">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                className="chip"
                disabled={running}
                onClick={() => setFeatureInput(s.description)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="actions">
        <button type="button" className="btn btn--primary" onClick={runPipeline} disabled={running || !featureInput.trim()}>
          {running ? (
            <>
              <span className="spinner spinner--light" />
              Running pipeline…
            </>
          ) : (
            <>
              <i className="ti ti-player-play" aria-hidden="true" />
              Run pipeline
            </>
          )}
        </button>
        {done && (
          <button type="button" className="btn btn--secondary" onClick={exportResults}>
            <i className="ti ti-download" aria-hidden="true" />
            Export report
          </button>
        )}
        {(done || error) && (
          <button type="button" className="btn btn--ghost" onClick={resetPipeline}>
            <i className="ti ti-refresh" aria-hidden="true" />
            Reset results
          </button>
        )}
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          <i className="ti ti-alert-circle" aria-hidden="true" />
          {error}
        </div>
      )}

      {memory.length > 0 && <MemoryPanel memory={memory} />}

      <p className="section-title">Agent pipeline</p>
      <div className="agents-grid">
        {STEP_AGENTS.map((key) => (
          <AgentCard key={key} agentKey={key} status={agentStatus[key]} output={agentOutput[key]} streaming={streamingAgent === key} />
        ))}
      </div>

      {coverageReport && <CoverageReport report={coverageReport} />}

      {done && (
        <div className="alert alert--success">
          <i className="ti ti-circle-check" aria-hidden="true" />
          Pipeline complete — all 4 agents finished. Export your report above.
        </div>
      )}
    </div>
  );
}
