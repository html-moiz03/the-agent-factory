// Agent tools (server side only).
//
// These are Anthropic's own server tools: they run on Anthropic's servers, not on your computer.
//   - FRIDAY gets web search.
//   - JARVIS and DUM-E get code execution, which runs in a sandbox Anthropic hosts
//     (no access to your files, your network or your keys).
// Nothing the model writes is ever executed on your machine.
//
// Turn everything off with AGENT_TOOLS=off in .env.local. Override limits with
// WEB_SEARCH_MAX_USES (default 4).

const SEARCH_TYPE = 'web_search_20250305';
const CODE_TYPE = 'code_execution_20250825';

export const MAX_TURNS = 4; // pause_turn continuations allowed per agent
const CLIP = 500;

export function toolsEnabled() {
  return String(process.env.AGENT_TOOLS || 'on').toLowerCase() !== 'off';
}

// Which tool each agent may use. Ids match lib/agents.js `tools`.
export function toolsFor(agent) {
  if (!toolsEnabled() || !agent.tools || agent.tools.length === 0) return [];
  const out = [];
  if (agent.tools.includes('web_search')) {
    const max = parseInt(process.env.WEB_SEARCH_MAX_USES, 10);
    out.push({ type: SEARCH_TYPE, name: 'web_search', max_uses: Number.isFinite(max) && max > 0 ? max : 4 });
  }
  if (agent.tools.includes('code_execution')) {
    out.push({ type: CODE_TYPE, name: 'code_execution' });
  }
  return out;
}

function clip(s, n = CLIP) {
  const t = String(s == null ? '' : s).trim();
  return t.length > n ? t.slice(0, n) + '...' : t;
}

function isHttp(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

function firstLine(s) {
  return clip(String(s || '').split('\n').find((l) => l.trim()) || '', 90);
}

// Reads one API response (all its content blocks) into:
//   text     the agent's written answer (only the text after its last tool result, so "let me search..." chatter is dropped)
//   sources  [{title, url}] pages the search returned or the answer cited
//   events   [{tool:'web_search'|'code_execution', ...}] what the agent did, in order
export function parseContent(content) {
  const calls = new Map(); // tool_use_id -> event
  const events = [];
  const sources = [];
  const seen = new Set();
  const addSource = (title, url) => {
    if (!isHttp(url) || seen.has(url)) return;
    seen.add(url);
    sources.push({ title: clip(title || url, 120), url });
  };

  let textAfterTool = [];
  let allText = [];

  for (const b of content || []) {
    if (b.type === 'text') {
      textAfterTool.push(b.text);
      allText.push(b.text);
      for (const c of b.citations || []) addSource(c.title, c.url);
    } else if (b.type === 'server_tool_use') {
      let ev;
      const input = b.input || {};
      if (b.name === 'web_search') {
        ev = { tool: 'web_search', query: clip(input.query, 160), results: 0, error: null };
      } else if (b.name === 'code_execution' || b.name === 'bash_code_execution' || b.name === 'text_editor_code_execution') {
        const src = input.code || input.command || input.file_text || '';
        ev = {
          tool: 'code_execution',
          action: b.name === 'text_editor_code_execution' ? 'file ' + (input.command || 'edit') : 'run',
          summary: b.name === 'text_editor_code_execution' ? clip(input.path || '', 90) : firstLine(src),
          returnCode: null,
          stdout: '',
          stderr: '',
          error: null,
        };
      } else {
        continue; // other server tools: ignore
      }
      calls.set(b.id, ev);
      events.push(ev);
    } else if (b.type === 'web_search_tool_result') {
      const ev = calls.get(b.tool_use_id);
      if (Array.isArray(b.content)) {
        if (ev) ev.results = b.content.length;
        for (const r of b.content) addSource(r.title, r.url);
      } else if (b.content && b.content.error_code && ev) {
        ev.error = b.content.error_code;
      }
      textAfterTool = [];
    } else if (b.type === 'code_execution_tool_result' || b.type === 'bash_code_execution_tool_result' || b.type === 'text_editor_code_execution_tool_result') {
      const ev = calls.get(b.tool_use_id);
      const c = b.content || {};
      if (ev) {
        if (c.error_code) ev.error = c.error_code;
        else if (typeof c.return_code === 'number') {
          ev.returnCode = c.return_code;
          ev.stdout = clip(c.stdout);
          ev.stderr = clip(c.stderr);
        }
      }
      textAfterTool = [];
    }
  }

  const pick = textAfterTool.join('').trim() || allText.join('').trim();
  return { text: pick, sources, events };
}

// A short plain-text block appended to the report so the person (and later agents) can see
// what really happened, in the tool's own words rather than the model's.
export function evidenceBlock(events, sources) {
  const lines = [];
  const searches = events.filter((e) => e.tool === 'web_search');
  const runs = events.filter((e) => e.tool === 'code_execution');
  if (searches.length || sources.length) {
    lines.push('Web search (live results):');
    for (const s of searches.slice(0, 6)) lines.push(`- searched: "${s.query}"${s.error ? ` (failed: ${s.error})` : ''}`);
    for (const s of sources.slice(0, 8)) lines.push(`- ${s.title} - ${s.url}`);
  }
  if (runs.length) {
    lines.push('Code run in the sandbox:');
    for (const r of runs.slice(0, 6)) {
      const res = r.error ? `error: ${r.error}` : r.returnCode === null ? 'no result' : r.returnCode === 0 ? 'exit 0 (ok)' : `exit ${r.returnCode} (failed)`;
      lines.push(`- ${r.action}: ${r.summary || '(empty)'} -> ${res}`);
    }
  }
  return lines.length ? '\n\n---\n' + lines.join('\n') : '';
}

export function sumUsage(acc, usage) {
  if (!usage) return acc;
  acc.input += usage.input_tokens || 0;
  acc.output += usage.output_tokens || 0;
  acc.searches += (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0;
  return acc;
}
