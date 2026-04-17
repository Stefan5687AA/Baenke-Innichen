const ALLOWED_STATUSES = ['ok', 'to_check', 'repair', 'removed'];

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, 404);
    }

    try {
      if (url.pathname === '/api/benches' && request.method === 'GET') {
        return listBenches(url, env);
      }

      if (url.pathname === '/api/benches' && request.method === 'POST') {
        return createBench(request, env);
      }

      const benchIdMatch = url.pathname.match(/^\/api\/benches\/(\d+)$/);
      if (benchIdMatch && request.method === 'PUT') {
        return updateBench(Number(benchIdMatch[1]), request, env);
      }

      return json({ error: 'Not found' }, 404);
    } catch (error) {
      return json({ error: 'Server error', detail: error.message }, 500);
    }
  }
};

async function listBenches(url, env) {
  const includeInactive = url.searchParams.get('active') === 'all';
  const query = includeInactive
    ? `SELECT id, title, lat, lng, status, last_inspection, notes, active FROM benches ORDER BY id DESC`
    : `SELECT id, title, lat, lng, status, last_inspection, notes, active FROM benches WHERE active = 1 ORDER BY id DESC`;

  const { results } = await env.DB.prepare(query).all();
  return json(results.map(normalizeBench));
}

async function createBench(request, env) {
  const payload = validatePayload(await request.json(), true);

  const stmt = env.DB.prepare(`
    INSERT INTO benches (title, lat, lng, status, last_inspection, notes, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    payload.title,
    payload.lat,
    payload.lng,
    payload.status,
    payload.last_inspection,
    payload.notes,
    payload.active ? 1 : 0
  );

  const result = await stmt.run();
  return json({ id: result.meta.last_row_id, ...payload }, 201);
}

async function updateBench(id, request, env) {
  const payload = validatePayload(await request.json(), false);

  const stmt = env.DB.prepare(`
    UPDATE benches
    SET
      title = COALESCE(?, title),
      status = COALESCE(?, status),
      last_inspection = ?,
      notes = COALESCE(?, notes),
      active = COALESCE(?, active),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    payload.title ?? null,
    payload.status ?? null,
    payload.last_inspection ?? null,
    payload.notes ?? null,
    typeof payload.active === 'boolean' ? (payload.active ? 1 : 0) : null,
    id
  );

  const result = await stmt.run();
  if (result.meta.changes === 0) {
    return json({ error: 'Bench not found' }, 404);
  }

  const updated = await env.DB.prepare(`SELECT id, title, lat, lng, status, last_inspection, notes, active FROM benches WHERE id = ?`).bind(id).first();
  return json(normalizeBench(updated));
}

function validatePayload(payload, requireLocation) {
  const normalized = {
    title: payload.title?.trim(),
    lat: payload.lat,
    lng: payload.lng,
    status: payload.status,
    last_inspection: payload.last_inspection ?? null,
    notes: payload.notes ?? '',
    active: payload.active
  };

  if (requireLocation && (typeof normalized.lat !== 'number' || typeof normalized.lng !== 'number')) {
    throw new Error('lat and lng are required numbers');
  }

  if (normalized.title && normalized.title.length > 200) {
    throw new Error('title too long');
  }

  if (normalized.status && !ALLOWED_STATUSES.includes(normalized.status)) {
    throw new Error('invalid status');
  }

  return normalized;
}

function normalizeBench(row) {
  return {
    ...row,
    active: Boolean(row.active)
  };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders()
    }
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
