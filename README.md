# Agent Factory

Six AI agents build a web project one after another while you watch them work in a small 3D city.
Each agent has a building, a robot and a report. When an agent finishes, its robot walks the work over to the next one.

| Agent | Role | Default model |
|---|---|---|
| FRIDAY | Research | claude-haiku-5-5 |
| EDITH | UI/UX | claude-sonnet-5-5 |
| JARVIS | Backend | claude-opus-5-5 |
| DUM-E | Testing | claude-haiku-5-5 |
| ULTRON | Security | claude-sonnet-5-5 |
| VISION | Final judge | claude-opus-5-5 |

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000, type a project brief and press **Run pipeline**.

**Mock mode** (default) is free. The agents return scripted reports that are clearly marked as mock output, so you can test the pipeline and the city without spending anything.

**Live mode** calls the real Claude API:

1. Copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY`.
2. Restart `npm run dev`.
3. Pick **Live** in the mode menu.

Each agent gets the brief plus the reports of the agents before it, and its answer is capped at a few hundred tokens, which keeps a full run small. The page shows total tokens used. Check Anthropic's pricing page for the current price per model.

To change a model, set `MODEL_FRIDAY`, `MODEL_EDITH`, `MODEL_JARVIS`, `MODEL_DUME`, `MODEL_ULTRON` or `MODEL_VISION` in `.env.local`, or edit `lib/agents.js`.

## Revise loop

VISION ends its report with `VERDICT: SHIP` or `VERDICT: REVISE (<agent>)`. On REVISE the pipeline goes back to that agent and runs forward from there again. Every agent after it re-runs too, because its inputs changed.

- The agent sent back gets VISION's complaint and its own previous report. Agents after it get a note that earlier work changed.
- In the city, VISION's robot carries a crate back to that agent along the roads, the stations from there onward reset to waiting, and the work flows forward again.
- It stops when VISION ships, or after `MAX_ROUNDS` passes in total (set in `lib/agents.js`, default 3, so at most 2 revisions). Then the run ends with a "still not ready" banner.
- If VISION names someone who cannot be found, the run ends instead of guessing.
- In Live mode every extra round is more API calls, so `MAX_ROUNDS` is also your spending cap.

To watch a revision without spending anything, pick **Mock with a revision (free)**. VISION sends the work back to JARVIS in round 1, JARVIS fixes it, and VISION ships in round 2.

## Agent tools

In Live mode some agents can use Anthropic's server-side tools:

| Agent | Tool | What it does |
|---|---|---|
| FRIDAY | Web search | Checks the products it names against live search results (up to 4 searches, set `WEB_SEARCH_MAX_USES`) |
| JARVIS, DUM-E | Code execution | Runs Python/shell in a sandbox hosted by Anthropic, with no internet and no access to your files or keys |

- Nothing the model writes ever runs on your computer. The sandbox is Anthropic's.
- Each report ends with an evidence block built from the tool results themselves: the searches made, the pages found, and every sandbox run with its exit code. Trust that block over the model's own words.
- Web pages are untrusted. FRIDAY is told to treat results as data, not instructions, but this is a mitigation, not a guarantee.
- Tools cost extra (searches and sandbox time are billed on top of tokens). Check Anthropic's pricing page. Set `AGENT_TOOLS=off` in `.env.local` to turn them all off.
- If your account cannot use a tool, the agent re-runs without it and the report says so.
- Mock mode shows scripted tool activity, marked `[mock]`.

## How it works

```
browser  --POST /api/run-->  route.js  -->  runPipeline()  (lib/orchestrator.js)
   ^                                              |
   |   one JSON event per step (server-sent events)
   +----------------------------------------------+
   |
   +--> log + chips + reports (page.js)
   +--> 3D city plays the same events one at a time (lib/city.js)
```

Events: `run_start`, `agent_start`, `tool_use`, `agent_done`, `handoff`, `revise`, `agent_error`, `run_end`.
The city queues events, so a handoff walk always finishes before the next robot starts working.

| File | What it does |
|---|---|
| `lib/agents.js` | The six agents: names, roles, models, system prompts, verdict parser |
| `lib/orchestrator.js` | Runs the agents in order and yields events (mock or live) |
| `lib/tools.js` | Which tools each agent gets, and reading tool results (sources, sandbox runs) |
| `lib/mock.js` | Scripted reports for mock mode |
| `app/api/run/route.js` | Streams the events to the browser |
| `lib/city.js` | The three.js city and robot animation |
| `app/page.js` | Controls, activity log, reports drawer |

## Before you put this on the internet

Live mode spends your API key on every run, and the `/api/run` route has no login. That is fine on your own computer. Before deploying publicly, add authentication and a rate limit, or remove Live mode.

## Not built yet

- Agents cannot write project files; they still only write reports (running code is checked in the sandbox, but the code is not saved anywhere).
- Live mode and the tools have not been run against the real API yet, because no key was available while building. They were tested against responses shaped like the API's. Try a short brief first and watch the first run's cost.
