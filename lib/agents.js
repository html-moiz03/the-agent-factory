// The six agents, in pipeline order. Shared by the server (orchestrator) and the browser (UI + city).
// Model ids are defaults. Override one with MODEL_<ID> in .env.local, e.g. MODEL_JARVIS.

const COMMON =
  'You are one agent in a six-agent web development pipeline. Be concrete and brief: ' +
  'under 250 words, short bullet lists, no preamble, no closing remarks.';

// Total passes through the pipeline, including the first. 3 means at most 2 revisions.
// Each extra round re-runs agents, so in Live mode this directly caps your API spend.
export const MAX_ROUNDS = 3;

export const AGENTS = [
  {
    id: 'friday',
    name: 'FRIDAY',
    role: 'Research',
    station: 'Research Lab',
    color: '#4CC9F0',
    model: 'claude-haiku-5-5',
    maxTokens: 700,
    task: 'researching similar products and options',
    system:
      `You are FRIDAY, the research agent. ${COMMON} ` +
      'Study the project brief: name 3-4 comparable products or sites, what each does well, ' +
      'the content and feature gaps worth filling, and recommend a simple tech stack. ' +
      'You cannot browse the web, so mark anything from memory as "unverified".',
  },
  {
    id: 'edith',
    name: 'EDITH',
    role: 'UI/UX',
    station: 'UI/UX Studio',
    color: '#F78FB3',
    model: 'claude-sonnet-5-5',
    maxTokens: 900,
    task: 'designing screens and the visual system',
    system:
      `You are EDITH, the UI/UX agent. ${COMMON} ` +
      'Design the interface: list the pages, the layout of each, the color and type direction, ' +
      'the key components, and accessibility notes. Build on FRIDAY\'s research.',
  },
  {
    id: 'jarvis',
    name: 'JARVIS',
    role: 'Backend',
    station: 'Backend Forge',
    color: '#A78BFA',
    model: 'claude-opus-5-5',
    maxTokens: 1400,
    task: 'building the API and database',
    system:
      `You are JARVIS, the backend agent. ${COMMON} ` +
      'Plan and write the backend: the data model, the API routes (method, path, payload), ' +
      'the auth approach, and short working code for the single most important endpoint. ' +
      'Match the screens EDITH designed.',
  },
  {
    id: 'dume',
    name: 'DUM-E',
    role: 'Testing',
    station: 'Testing Bay',
    color: '#5FD3A0',
    model: 'claude-haiku-5-5',
    maxTokens: 800,
    task: 'running tests and hunting bugs',
    system:
      `You are DUM-E, the testing agent. ${COMMON} ` +
      'Write a test plan for the work so far: the most important test cases (happy path, edge cases, ' +
      'failure cases) with one short sample test. Flag anything ambiguous or likely to break.',
  },
  {
    id: 'ultron',
    name: 'ULTRON',
    role: 'Security',
    station: 'Security Gate',
    color: '#FF7B72',
    model: 'claude-sonnet-5-5',
    maxTokens: 800,
    task: 'attacking the design to find weak spots',
    system:
      `You are ULTRON, the security agent. ${COMMON} ` +
      'Review the design and backend as an attacker would. List the top risks (auth, input validation, ' +
      'secrets, dependencies, rate limiting), rank them by severity, and give one concrete fix for each.',
  },
  {
    id: 'vision',
    name: 'VISION',
    role: 'Final judge',
    station: "Judge's Court",
    color: '#FFB84D',
    model: 'claude-opus-5-5',
    maxTokens: 800,
    task: 'weighing every report',
    system:
      `You are VISION, the final judge. ${COMMON} ` +
      'Read every report. List what is solid and list any blocking issues. ' +
      'Only blocking issues (security holes, broken logic, missing requirements) justify a revision; ' +
      'minor points go in your notes and the work still ships. ' +
      'End with exactly one final line: "VERDICT: SHIP" or "VERDICT: REVISE (<agent name>)", ' +
      'where <agent name> is exactly one of FRIDAY, EDITH, JARVIS, DUM-E or ULTRON: the first agent whose work must be redone. ' +
      'In a later round, judge the updated reports from scratch.',
  },
];

export function agentIndex(id) {
  return AGENTS.findIndex((a) => a.id === id);
}

// Uses the LAST "VERDICT:" line, in case the judge quotes the format earlier in its notes.
export function parseVerdict(text) {
  const re = /VERDICT:\s*(SHIP|REVISE)(?:\s*\(([^)]*)\))?/gi;
  let m;
  let last = null;
  while ((m = re.exec(text || ''))) last = m;
  if (!last) return { decision: 'UNKNOWN', target: null };
  return { decision: last[1].toUpperCase(), target: last[2] ? last[2].trim() : null };
}

// Turns what the judge wrote ("JARVIS", "DUM-E", "backend") into an index in AGENTS, or -1.
export function resolveAgent(text) {
  if (!text) return -1;
  const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const t = norm(text);
  if (!t) return -1;
  let i = AGENTS.findIndex((a) => [a.name, a.id, a.role, a.station].some((v) => norm(v) === t));
  if (i >= 0) return i;
  // the judge may add words, e.g. "JARVIS - backend"; match on the agent name inside the text
  i = AGENTS.findIndex((a) => t.includes(norm(a.name)));
  return i;
}
