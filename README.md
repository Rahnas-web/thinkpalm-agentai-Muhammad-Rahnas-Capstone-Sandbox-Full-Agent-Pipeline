# Maritime QA Agent Pipeline

AI-powered QA workflow for maritime software. Paste any feature description and run four agents that produce requirements, Gherkin BDD scenarios, Playwright tests, and a coverage gap report.

**Agents:** Requirement Analyst → BDD Generator → Playwright Writer → Coverage Analyst  
**Powered by:** [Groq API](https://console.groq.com/) (`llama-3.3-70b-versatile`)

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A Groq API key

## Setup

```bash
cd maritime-qa-pipeline
npm install
```

Create a new .env file and Copy the example env file and add your API key:

```bash
copy example_env
```

Edit `.env`:

```env
GROQ_API_KEY=your_groq_api_key_here
```

## Run (Web UI)

```bash
npm run dev
```

Open **http://localhost:5173** in your browser.

1. Enter a feature spec, user story, or requirements in the text box (or click a sample chip).
2. Click **Run pipeline**.
3. Optionally **Export report** when finished.

## Run (CLI)

Runs the same pipeline in the terminal and saves `maritime_qa_report.txt`:

```bash
npm run pipeline
```

## Other commands

| Command | Description |
|---------|-------------|
| `npm run build` | Production build |
| `npm run preview` | Preview production build |

## Project structure

```
maritime-qa-pipeline/
├── src/App.jsx          # Main UI & pipeline logic
├── src/index.css        # Styles
├── scripts/run-pipeline.mjs  # CLI runner
├── vite.config.js       # Dev server + Groq API proxy
└── .env                 # API key (not committed)
```

## Notes

- Never commit `.env` or share your API key publicly.
- The dev server proxies API calls so your key stays on the server.
