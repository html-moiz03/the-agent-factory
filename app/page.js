'use client';

import { useEffect, useRef, useState } from 'react';
import { AGENTS } from '../lib/agents';

const DEFAULT_BRIEF = 'Build a website for a small restaurant with online table booking';
const agentById = Object.fromEntries(AGENTS.map((a) => [a.id, a]));

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

async function fontsReady() {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('700 50px "Chakra Petch"'), document.fonts.ready]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch (e) {
    // fonts are cosmetic; carry on without them
  }
}

export default function Home() {
  const canvasRef = useRef(null);
  const labelsRef = useRef(null);
  const cityRef = useRef(null);
  const abortRef = useRef(null);
  const genRef = useRef(0);
  const chainRef = useRef(Promise.resolve());
  const startRef = useRef(0);

  const [brief, setBrief] = useState(DEFAULT_BRIEF);
  const [mode, setMode] = useState('mock');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState({});
  const [reports, setReports] = useState({});
  const [models, setModels] = useState({});
  const [log, setLog] = useState([]);
  const [usage, setUsage] = useState({ input: 0, output: 0, searches: 0 });
  const [toolCount, setToolCount] = useState({ search: 0, run: 0 });
  const [round, setRound] = useState(null);
  const [reportRound, setReportRound] = useState({});
  const [drawer, setDrawer] = useState(false);
  const [active, setActive] = useState(AGENTS[0].id);
  const [banner, setBanner] = useState(null);
  const [error, setError] = useState('');
  const [noGL, setNoGL] = useState(false);

  /* create the 3D city once */
  useEffect(() => {
    let cancelled = false;
    let city = null;
    (async () => {
      await fontsReady();
      if (cancelled) return;
      const { createCity } = await import('../lib/city');
      if (cancelled) return;
      city = createCity({
        canvas: canvasRef.current,
        labelsEl: labelsRef.current,
        agents: AGENTS,
        onBanner: setBanner,
      });
      if (!city) {
        setNoGL(true);
        return;
      }
      cityRef.current = city;
    })();
    return () => {
      cancelled = true;
      if (city) city.dispose();
      cityRef.current = null;
    };
  }, []);

  function addLog(who, msg, color) {
    const t = (performance.now() - startRef.current) / 1000;
    setLog((l) => [{ t, who, msg, color }, ...l].slice(0, 6));
  }

  function applyEvent(ev) {
    switch (ev.type) {
      case 'run_start':
        setRound({ n: 1, max: ev.maxRounds });
        addLog('Orchestrator', `Brief received (${ev.mode} mode)`, '#FFC970');
        break;
      case 'revise': {
        const to = agentById[ev.to];
        setRound({ n: ev.round, max: ev.maxRounds });
        setStatus((s) => {
          const next = { ...s };
          (ev.reset || []).forEach((id) => {
            next[id] = 'idle';
          });
          return next;
        });
        addLog('VISION', `sent the work back to ${to.name} (round ${ev.round} of ${ev.maxRounds})`, agentById.vision.color);
        break;
      }
      case 'agent_start': {
        const a = agentById[ev.agent];
        setStatus((s) => ({ ...s, [ev.agent]: 'working' }));
        setModels((m) => ({ ...m, [ev.agent]: ev.model }));
        addLog(a.name, a.task, a.color);
        break;
      }
      case 'tool_use': {
        const a = agentById[ev.agent];
        if (ev.tool === 'web_search') {
          setToolCount((c) => ({ ...c, search: c.search + 1 }));
          addLog(a.name, `searched the web: "${ev.query}"${ev.error ? ' (failed)' : ''}${ev.mock ? ' [mock]' : ''}`, a.color);
        } else if (ev.tool === 'code_execution') {
          setToolCount((c) => ({ ...c, run: c.run + 1 }));
          const res = ev.error ? 'error' : ev.returnCode === 0 ? 'ok' : ev.returnCode === null ? 'no result' : 'failed, exit ' + ev.returnCode;
          addLog(a.name, `ran code in the sandbox: ${ev.summary || ev.action} (${res})${ev.mock ? ' [mock]' : ''}`, a.color);
        }
        break;
      }
      case 'agent_done': {
        const a = agentById[ev.agent];
        setStatus((s) => ({ ...s, [ev.agent]: 'done' }));
        setReports((r) => ({ ...r, [ev.agent]: ev.report }));
        setReportRound((r) => ({ ...r, [ev.agent]: ev.round }));
        if (ev.usage) {
          setUsage((u) => ({ input: u.input + ev.usage.input, output: u.output + ev.usage.output, searches: u.searches + (ev.usage.searches || 0) }));
        }
        addLog(a.name, 'finished its report', a.color);
        break;
      }
      case 'handoff': {
        const from = agentById[ev.from];
        const to = agentById[ev.to];
        addLog(from.name, `passing work to ${to.name}`, from.color);
        break;
      }
      case 'agent_error': {
        const a = agentById[ev.agent];
        setStatus((s) => ({ ...s, [ev.agent]: 'error' }));
        setError(`${a.name} failed: ${ev.message}`);
        addLog(a.name, 'failed', a.color);
        break;
      }
      case 'run_end':
        if (ev.status === 'complete') {
          const v = ev.verdict || {};
          let msg = `Verdict: ${v.decision || 'UNKNOWN'}${v.target ? ' (' + v.target + ')' : ''}`;
          if (ev.rounds > 1) msg += ` after ${ev.rounds} rounds`;
          if (ev.reason === 'round_limit') msg += '. Round limit reached, so it stopped.';
          if (ev.reason === 'unroutable') msg += '. Could not tell which agent to send it back to.';
          addLog('Orchestrator', msg, '#FFC970');
        } else {
          if (ev.message) setError(ev.message);
          addLog('Orchestrator', 'Run failed', '#FFC970');
        }
        break;
      default:
    }
  }

  async function run() {
    const city = cityRef.current;
    if (running || !city) return;
    const gen = ++genRef.current;
    city.reset();
    chainRef.current = Promise.resolve();
    startRef.current = performance.now();
    setStatus({});
    setReports({});
    setModels({});
    setLog([]);
    setUsage({ input: 0, output: 0, searches: 0 });
    setToolCount({ search: 0, run: 0 });
    setRound(null);
    setReportRound({});
    setError('');
    setBanner(null);
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, mode }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (!chunk.startsWith('data: ')) continue;
          const ev = JSON.parse(chunk.slice(6));
          if (gen !== genRef.current) return;
          applyEvent(ev);
          // the city plays events one after another, so a handoff finishes before the next agent starts
          chainRef.current = chainRef.current.then(() => (gen === genRef.current ? city.handle(ev) : undefined));
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError' && gen === genRef.current) setError(e.message);
    } finally {
      if (gen === genRef.current) setRunning(false);
    }
  }

  function stop() {
    genRef.current++;
    if (abortRef.current) abortRef.current.abort();
    if (cityRef.current) cityRef.current.reset();
    setRunning(false);
    setStatus({});
    setBanner(null);
    addLog('Orchestrator', 'Run stopped', '#FFC970');
  }

  function onSubmit(e) {
    e.preventDefault();
    if (running) stop();
    else run();
  }

  const activeAgent = agentById[active];
  const totalTokens = usage.input + usage.output;

  return (
    <main className="stage">
      <canvas ref={canvasRef} className="city" aria-label="3D city map with six agent robots working between stations" />
      <div ref={labelsRef} className="labels" />

      <div className="hud">
        <div className="top">
          <div className="title">
            <h1>Agent Factory</h1>
            <p>Drag to rotate · scroll or pinch to zoom</p>
          </div>
          <form className="brief" onSubmit={onSubmit}>
            <label htmlFor="brief" className="sr">
              Project brief
            </label>
            <input
              id="brief"
              type="text"
              value={brief}
              maxLength={2000}
              placeholder="Describe the project to build"
              onChange={(e) => setBrief(e.target.value)}
              disabled={running}
            />
            <label htmlFor="mode" className="sr">
              Mode
            </label>
            <select id="mode" value={mode} onChange={(e) => setMode(e.target.value)} disabled={running}>
              <option value="mock">Mock (free)</option>
              <option value="mock-revise">Mock with a revision (free)</option>
              <option value="live">Live (uses API key)</option>
            </select>
            <button type="submit" className={'btn ' + (running ? 'stop' : 'primary')}>
              {running ? 'Stop' : 'Run pipeline'}
            </button>
            <button type="button" className="btn" onClick={() => cityRef.current && cityRef.current.resetView()}>
              Reset view
            </button>
          </form>
        </div>

        {error ? (
          <div className="alert" role="alert">
            {error}
          </div>
        ) : null}

        <div className="bottom">
          <div className="log" aria-live="polite">
            <h2>Activity</h2>
            {log.length === 0 ? (
              <div className="empty">Press Run pipeline to send the brief through all six agents.</div>
            ) : (
              log.map((l, i) => (
                <div key={i}>
                  <span className="t">{fmt(l.t)} </span>
                  <span style={{ color: l.color }}>{l.who} </span>
                  <span>{l.msg}</span>
                </div>
              ))
            )}
          </div>
          <div className="pipe">
            <div className="chips">
              {AGENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="chip"
                  data-s={status[a.id] || 'idle'}
                  onClick={() => {
                    setActive(a.id);
                    setDrawer(true);
                  }}
                >
                  {a.name}
                </button>
              ))}
            </div>
            {round ? (
              <div className="usage">
                Round {round.n} of {round.max}
              </div>
            ) : null}
            {totalTokens > 0 ? (
              <div className="usage">
                Tokens: {usage.input.toLocaleString()} in · {usage.output.toLocaleString()} out
              </div>
            ) : null}
            {toolCount.search + toolCount.run > 0 ? (
              <div className="usage">
                Tools: {toolCount.search} searches · {toolCount.run} sandbox runs
              </div>
            ) : null}
            <button type="button" className="btn" onClick={() => setDrawer(true)}>
              Reports
            </button>
          </div>
        </div>
      </div>

      {drawer ? (
        <aside className="drawer" aria-label="Agent reports">
          <div className="drawer-head">
            <h2>Reports</h2>
            <button type="button" className="btn" onClick={() => setDrawer(false)}>
              Close
            </button>
          </div>
          <div className="tabs">
            {AGENTS.map((a) => (
              <button key={a.id} type="button" className="tab" aria-pressed={active === a.id} onClick={() => setActive(a.id)}>
                {a.name}
              </button>
            ))}
          </div>
          <div className="report-meta">
            {activeAgent.role} · model: {models[active] || activeAgent.model}
            {activeAgent.tools ? ' · tools: ' + activeAgent.tools.map((t) => (t === 'web_search' ? 'web search' : 'code sandbox')).join(', ') : ''}
            {reportRound[active] > 1 ? ` · revised in round ${reportRound[active]}` : ''}
          </div>
          <pre className="report">{reports[active] || 'No report yet. Run the pipeline to see what this agent writes.'}</pre>
        </aside>
      ) : null}

      {banner ? (
        <div className="banner" data-tone={banner.tone} role="status">
          {banner.text}
        </div>
      ) : null}

      {noGL ? <div className="fallback">The 3D city needs WebGL, which this browser has turned off.</div> : null}
    </main>
  );
}
