// Scripted reports for mock mode. They cost nothing and are clearly labelled so they are never
// mistaken for real agent output.
//
// Mode "mock" always ships on the first pass. Mode "mock-revise" has VISION send the work back to
// JARVIS in round 1 so you can watch a full revision, then ship in round 2.

const TAG = '[MOCK OUTPUT: scripted, not written by an AI]';

export const MOCK_SECONDS = {
  friday: 5,
  edith: 5.5,
  jarvis: 7,
  dume: 5,
  ultron: 5.5,
  vision: 5,
};

// Scripted tool activity so you can see the tool UI without spending anything.
export function mockToolEvents(id) {
  const m = true;
  if (id === 'friday')
    return [
      { tool: 'web_search', query: 'best small restaurant websites online booking', results: 5, error: null, mock: m },
      { tool: 'web_search', query: 'restaurant table booking widget comparison', results: 5, error: null, mock: m },
    ];
  if (id === 'jarvis')
    return [{ tool: 'code_execution', action: 'run', summary: 'python booking_check.py', returnCode: 0, stdout: '', stderr: '', error: null, mock: m }];
  if (id === 'dume')
    return [{ tool: 'code_execution', action: 'run', summary: 'python -m pytest test_booking.py', returnCode: 0, stdout: '', stderr: '', error: null, mock: m }];
  return [];
}

export function mockReport(id, brief, opts = {}) {
  const round = opts.round || 1;
  const revise = Boolean(opts.revise);
  const b = brief.length > 90 ? brief.slice(0, 90) + '...' : brief;
  switch (id) {
    case 'friday':
      return [
        TAG,
        `Research for: "${b}"`,
        '- Compared 4 similar products (unverified, from memory).',
        '- They all do clear navigation well; most are weak on mobile checkout and empty states.',
        '- Gap to fill: a faster first screen and a simple booking or contact flow.',
        '- Suggested stack: Next.js, Postgres, Prisma, deployed on Vercel.',
      ].join('\n');
    case 'edith':
      return [
        TAG,
        '- Pages: Home, Menu or Catalog, Booking, About, Contact.',
        '- Layout: one-column mobile first, 12-column grid from tablet up.',
        '- Direction: calm neutral base, one warm accent, a serif display face with a clean sans body.',
        '- Components: sticky header, hero, card grid, booking form, footer.',
        '- Accessibility: 4.5:1 contrast, visible focus, 44px touch targets.',
      ].join('\n');
    case 'jarvis':
      if (round > 1) {
        return [
          TAG,
          `Revision (round ${round}): fixed the problem the judge raised.`,
          '- PATCH /api/bookings/:id now loads the booking and returns 403 unless booking.userId matches the session user or the role is staff.',
          '- Data model, routes and auth approach are unchanged.',
          '- Added a test hook: every write route calls requireOwner(booking, session).',
        ].join('\n');
      }
      return [
        TAG,
        '- Data model: User, Item, Booking(userId, itemId, startsAt, status).',
        '- Routes: GET /api/items, POST /api/bookings, GET /api/bookings/:id, PATCH /api/bookings/:id.',
        '- Auth: email magic link, session cookie, role check on PATCH.',
        '- Key endpoint: POST /api/bookings validates input, checks the slot is free, inserts, returns 201.',
      ].join('\n');
    case 'dume':
      if (round > 1) {
        return [
          TAG,
          `Updated test plan (round ${round}).`,
          '- New: user A tries to PATCH user B\'s booking, expect 403.',
          '- New: staff user edits any booking, expect 200.',
          '- Kept: double-booking race, missing-field 400s.',
          '- Flag: cancellation rules are still not defined.',
        ].join('\n');
      }
      return [
        TAG,
        '- Happy path: create a booking for a free slot, expect 201 and a confirmation.',
        '- Edge: two people book the same slot at once, expect exactly one success.',
        '- Failure: missing fields return 400 with a readable message.',
        '- Flag: cancellation rules are not defined yet.',
      ].join('\n');
    case 'ultron':
      if (round > 1) {
        return [
          TAG,
          `Re-review (round ${round}).`,
          '- RESOLVED: the ownership check on PATCH /api/bookings/:id is in place.',
          '- MEDIUM: no rate limit on POST /api/bookings (still open, not blocking).',
          '- LOW: keep dependencies updated and secrets out of the repo.',
        ].join('\n');
      }
      return [
        TAG,
        '- HIGH: PATCH /api/bookings/:id must check ownership, or anyone can edit any booking.',
        '- MEDIUM: no rate limit on POST /api/bookings, so spam bookings are possible.',
        '- MEDIUM: validate and length-limit every text field before saving.',
        '- LOW: keep dependencies updated and secrets out of the repo.',
      ].join('\n');
    default:
      if (revise && round === 1) {
        return [
          TAG,
          'Solid: clear scope, sensible stack, good test plan.',
          'Blocking: ULTRON found a HIGH issue (anyone can edit any booking) and JARVIS\'s backend does not address it.',
          'VERDICT: REVISE (JARVIS)',
        ].join('\n');
      }
      return [
        TAG,
        'Solid: clear scope, sensible stack, good test coverage plan.',
        round > 1
          ? 'Blocking: none. The ownership problem is fixed and the tests now cover it.'
          : 'Blocking: none. The ownership check from ULTRON must be built before launch.',
        'VERDICT: SHIP',
      ].join('\n');
  }
}
