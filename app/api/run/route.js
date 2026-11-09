import { runPipeline } from '../../../lib/orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BRIEF = 2000;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Send a JSON body with a brief and a mode.' });
  }

  const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
  const mode = ['live', 'mock-revise'].includes(body.mode) ? body.mode : 'mock';

  if (!brief) return json(400, { error: 'Write a project brief first.' });
  if (brief.length > MAX_BRIEF) return json(400, { error: `Keep the brief under ${MAX_BRIEF} characters.` });
  if (mode === 'live' && !process.env.ANTHROPIC_API_KEY) {
    return json(400, {
      error: 'Live mode needs ANTHROPIC_API_KEY. Add it to .env.local and restart the server, or switch to Mock mode.',
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      try {
        for await (const ev of runPipeline({ brief, mode, signal: req.signal })) {
          send(ev);
        }
      } catch (err) {
        if (!req.signal.aborted) {
          send({ type: 'run_end', status: 'failed', message: err && err.message ? err.message : 'Unknown error' });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // stream already closed by the client
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
