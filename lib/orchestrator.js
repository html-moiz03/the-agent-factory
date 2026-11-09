import Anthropic from '@anthropic-ai/sdk';
import { AGENTS, MAX_ROUNDS, parseVerdict, resolveAgent } from './agents';
import { mockReport, MOCK_SECONDS, mockToolEvents } from './mock';
import { toolsFor, parseContent, evidenceBlock, sumUsage, MAX_TURNS } from './tools';

// Runs the six agents in order and yields one event at a time.
// Event types: run_start, agent_start, tool_use, agent_done, handoff, revise, agent_error, run_end.
// tool_use is sent just before agent_done for each web search or sandbox run the agent made.
//
// Revise loop: when VISION ends with "VERDICT: REVISE (<agent>)", the pipeline goes back to that
// agent and runs forward from there again (every agent after it re-runs, because its inputs changed).
// It stops when VISION ships, or after MAX_ROUNDS passes in total.

function modelFor(agent) {
  return process.env['MODEL_' + agent.id.toUpperCase()] || agent.model;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(new Error('aborted'));
        },
        { once: true }
      );
    }
  });
}

async function runMock(agent, brief, ctx, signal) {
  await sleep((MOCK_SECONDS[agent.id] || 3) * 1000, signal);
  return {
    text: mockReport(agent.id, brief, { round: ctx.round, revise: ctx.mockRevise }),
    usage: null,
    model: 'mock',
    toolEvents: mockToolEvents(agent.id),
  };
}

// What one agent is told. It sees the brief and the CURRENT reports of the agents before it.
// In a later round it also sees its own previous report, and either the judge's complaint
// (if it is the agent being sent back) or a note that earlier work changed.
function buildPrompt(index, brief, reports, ctx) {
  const agent = AGENTS[index];
  const prior = AGENTS.slice(0, index)
    .filter((a) => reports[a.id])
    .map((a) => `### ${a.name} (${a.role}) report\n${reports[a.id]}`)
    .join('\n\n');

  const parts = [`Project brief:\n${brief}`];
  parts.push(prior ? `Reports from earlier agents:\n${prior}` : 'You are the first agent, so there are no earlier reports.');

  if (ctx.round > 1) {
    if (reports[agent.id]) parts.push(`Your previous report (before round ${ctx.round}):\n${reports[agent.id]}`);
    if (ctx.isFirstOfRound) {
      parts.push(
        `This is revision round ${ctx.round} of ${MAX_ROUNDS}. The final judge sent the work back to you. ` +
          `Fix the problems it raised and keep what was already good.\nJudge's feedback:\n${ctx.feedback}`
      );
    } else {
      parts.push(
        `This is revision round ${ctx.round} of ${MAX_ROUNDS}. An earlier agent changed its work after the judge's feedback. ` +
          'Update your report so it matches the new work.'
      );
    }
  }
  parts.push('Write your report now.');
  return parts.join('\n\n');
}

let client = null;
// Lets tests swap in a fake client. Pass null to go back to the real one.
export function setClient(c) {
  client = c;
}

const isToolError = (err) => err && err.status === 400;

async function runLive(index, brief, reports, ctx, signal) {
  const agent = AGENTS[index];
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = modelFor(agent);
  let tools = toolsFor(agent);
  const first = { role: 'user', content: buildPrompt(index, brief, reports, ctx) };

  const usage = { input: 0, output: 0, searches: 0 };
  const events = [];
  const sources = [];
  let notice = null;
  let messages = [first];
  let container;
  let finalText = '';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const params = { model, max_tokens: agent.maxTokens, system: agent.system, messages };
    if (tools.length) params.tools = tools;
    if (container) params.container = container;

    let res;
    try {
      res = await client.messages.create(params, { signal });
    } catch (err) {
      // If the account cannot use a tool (not enabled, not allowed), run again without tools
      // rather than failing the whole pipeline, and say so in the report.
      if (tools.length && turn === 0 && isToolError(err)) {
        notice = `Tools were not available (${err.message}). This report was written without them.`;
        tools = [];
        turn -= 1;
        continue;
      }
      throw err;
    }

    sumUsage(usage, res.usage);
    const parsed = parseContent(res.content);
    events.push(...parsed.events);
    for (const s of parsed.sources) if (!sources.some((x) => x.url === s.url)) sources.push(s);
    finalText = parsed.text;

    if (res.stop_reason === 'pause_turn') {
      // The server paused a long turn. Send its content back as-is and let it carry on.
      messages = [...messages, { role: 'assistant', content: res.content }];
      if (res.container && res.container.id) container = res.container.id;
      if (turn === MAX_TURNS - 1) notice = 'Stopped after the maximum number of tool turns; the report may be incomplete.';
      continue;
    }
    if (res.stop_reason === 'max_tokens') notice = 'The agent hit its length limit, so the report may be cut off.';
    break;
  }

  let text = finalText;
  if (!text) text = '(The agent returned no written report.)';
  if (notice) text += `\n\n[Note: ${notice}]`;
  text += evidenceBlock(events, sources);
  return { text, model, usage, toolEvents: events };
}

export async function* runPipeline({ brief, mode, signal }) {
  const live = mode === 'live';
  const mockRevise = mode === 'mock-revise';
  const last = AGENTS.length - 1;
  const reports = {};
  let round = 1;
  let start = 0;
  let feedback = null;

  yield { type: 'run_start', mode, brief, maxRounds: MAX_ROUNDS };

  for (;;) {
    for (let i = start; i <= last; i++) {
      const agent = AGENTS[i];
      yield { type: 'agent_start', agent: agent.id, model: live ? modelFor(agent) : 'mock', round };

      const ctx = { round, feedback, isFirstOfRound: i === start, mockRevise };
      let result;
      try {
        result = live ? await runLive(i, brief, reports, ctx, signal) : await runMock(agent, brief, ctx, signal);
      } catch (err) {
        if (signal && signal.aborted) return;
        yield { type: 'agent_error', agent: agent.id, message: err && err.message ? err.message : 'Unknown error' };
        yield { type: 'run_end', status: 'failed' };
        return;
      }

      for (const te of result.toolEvents || []) yield { type: 'tool_use', agent: agent.id, round, ...te };

      reports[agent.id] = result.text;
      yield { type: 'agent_done', agent: agent.id, report: result.text, usage: result.usage, round };

      if (i < last) yield { type: 'handoff', from: agent.id, to: AGENTS[i + 1].id };
    }

    const verdict = parseVerdict(reports.vision);
    if (verdict.decision !== 'REVISE') {
      yield { type: 'run_end', status: 'complete', verdict, rounds: round };
      return;
    }

    // The judge wants a revision. Work out who, and whether we are allowed another round.
    const target = resolveAgent(verdict.target);
    if (target < 0 || target >= last) {
      yield { type: 'run_end', status: 'complete', verdict, rounds: round, reason: 'unroutable' };
      return;
    }
    if (round >= MAX_ROUNDS) {
      yield { type: 'run_end', status: 'complete', verdict, rounds: round, reason: 'round_limit' };
      return;
    }

    round += 1;
    start = target;
    feedback = reports.vision;
    yield {
      type: 'revise',
      round,
      maxRounds: MAX_ROUNDS,
      from: 'vision',
      to: AGENTS[target].id,
      reset: AGENTS.slice(target).map((a) => a.id),
      feedback,
    };
  }
}
