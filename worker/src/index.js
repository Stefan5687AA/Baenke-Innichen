const ALLOWED_STATUSES = ['good', 'ok', 'to_check', 'repair', 'removed'];

class HttpError extends Error {
  constructor(status, message, detail = null) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, 404);
    }

    try {
      if (url.pathname === '/api/benches' && request.method === 'GET') {
        return await listBenches(url, env);
      }

      if (url.pathname === '/api/benches' && request.method === 'POST') {
        const response = await createBench(request, env);
        queueGithubBackup(ctx, env, 'create');
        return response;
      }

      if (url.pathname === '/api/upload' && request.method === 'POST') {
        return await uploadImage(request, env);
      }

      const benchIdMatch = url.pathname.match(/^\/api\/benches\/(\d+)$/);
      if (benchIdMatch && request.method === 'PUT') {
        const response = await updateBench(Number(benchIdMatch[1]), request, env);
        queueGithubBackup(ctx, env, 'update');
        return response;
      }

      if (benchIdMatch && request.method === 'DELETE') {
        const response = await deleteBench(Number(benchIdMatch[1]), env);
        queueGithubBackup(ctx, env, 'delete');
        return response;
      }

      return json({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('Worker error:', error);

      if (error instanceof HttpError) {
        return json(
          error.detail
            ? { error: error.message, detail: error.detail }
            : { error: error.message },
          error.status
        );
      }

      return json(
        {
          error: 'Server error',
          detail: error?.message || 'Unknown error'
        },
        500
      );
    }
  },

  async scheduled(controller, env, ctx) {
    queueGithubBackup(ctx, env, `scheduled:${controller.cron}`);
  }
};

async function listBenches(url, env) {
  const includeInactive = url.searchParams.get('active') === 'all';

  const query = includeInactive
    ? `
      SELECT id, title, lat, lng, status, last_inspection, notes, active, image_url, created_at, updated_at, deleted_at
      FROM benches
      ORDER BY id DESC
    `
    : `
      SELECT id, title, lat, lng, status, last_inspection, notes, active, image_url, created_at, updated_at, deleted_at
      FROM benches
      WHERE active = 1 AND deleted_at IS NULL
      ORDER BY id DESC
    `;

  const { results } = await env.DB.prepare(query).all();
  return json(results.map(normalizeBench));
}

async function createBench(request, env) {
  const body = await readJsonBody(request);
  const payload = validatePayload(body, true);
  const preparedPayload = applyBusinessRules(payload, true);

  const stmt = env.DB.prepare(`
    INSERT INTO benches (
      title,
      lat,
      lng,
      status,
      last_inspection,
      notes,
      active,
      image_url
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    preparedPayload.title,
    preparedPayload.lat,
    preparedPayload.lng,
    preparedPayload.status,
    preparedPayload.last_inspection,
    preparedPayload.notes,
    preparedPayload.active ? 1 : 0,
    preparedPayload.image_url ?? null
  );

  const result = await runStatement(stmt, preparedPayload.status);

  const created = await env.DB.prepare(`
    SELECT id, title, lat, lng, status, last_inspection, notes, active, image_url, created_at, updated_at, deleted_at
    FROM benches
    WHERE id = ?
  `)
    .bind(result.meta.last_row_id)
    .first();

  return json(normalizeBench(created), 201);
}

async function updateBench(id, request, env) {
  const existing = await env.DB.prepare(`
    SELECT id, title, lat, lng, status, last_inspection, notes, active, image_url, created_at, updated_at, deleted_at
    FROM benches
    WHERE id = ?
  `)
    .bind(id)
    .first();

  if (!existing) {
    return json({ error: 'Bench not found' }, 404);
  }

  const body = await readJsonBody(request);
  const payload = validatePayload(body, false);
  const preparedPayload = applyBusinessRules(payload, false);
  const hasImageUrlUpdate = typeof preparedPayload.image_url !== 'undefined';
  const shouldMarkDeleted = preparedPayload.status === 'removed';
  const shouldRestoreDeleted = preparedPayload.status
    && preparedPayload.status !== 'removed'
    && preparedPayload.active === true;

  const stmt = env.DB.prepare(`
    UPDATE benches
    SET
      title = COALESCE(?, title),
      lat = COALESCE(?, lat),
      lng = COALESCE(?, lng),
      status = COALESCE(?, status),
      last_inspection = ?,
      notes = COALESCE(?, notes),
      active = COALESCE(?, active),
      image_url = CASE WHEN ? THEN ? ELSE image_url END,
      deleted_at = CASE
        WHEN ? THEN COALESCE(deleted_at, CURRENT_TIMESTAMP)
        WHEN ? THEN NULL
        ELSE deleted_at
      END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    preparedPayload.title ?? null,
    Number.isFinite(preparedPayload.lat) ? preparedPayload.lat : null,
    Number.isFinite(preparedPayload.lng) ? preparedPayload.lng : null,
    preparedPayload.status ?? null,
    preparedPayload.last_inspection ?? existing.last_inspection ?? null,
    preparedPayload.notes ?? null,
    typeof preparedPayload.active === 'boolean'
      ? (preparedPayload.active ? 1 : 0)
      : null,
    hasImageUrlUpdate ? 1 : 0,
    hasImageUrlUpdate ? preparedPayload.image_url : null,
    shouldMarkDeleted ? 1 : 0,
    shouldRestoreDeleted ? 1 : 0,
    id
  );

  const result = await runStatement(stmt, preparedPayload.status);

  if (result.meta.changes === 0) {
    return json({ error: 'Bench not found' }, 404);
  }

  const updated = await env.DB.prepare(`
    SELECT id, title, lat, lng, status, last_inspection, notes, active, image_url, created_at, updated_at, deleted_at
    FROM benches
    WHERE id = ?
  `)
    .bind(id)
    .first();

  return json(normalizeBench(updated));
}

async function deleteBench(id, env) {
  const result = await env.DB.prepare(`
    UPDATE benches
    SET
      status = 'removed',
      active = 0,
      deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `)
    .bind(id)
    .run();

  if (result.meta.changes === 0) {
    return json({ error: 'Bench not found' }, 404);
  }

  const deleted = await env.DB.prepare(`
    SELECT id, title, lat, lng, status, last_inspection, notes, active, image_url, created_at, updated_at, deleted_at
    FROM benches
    WHERE id = ?
  `)
    .bind(id)
    .first();

  return json({ ok: true, bench: normalizeBench(deleted) });
}

async function uploadImage(request, env) {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    throw new HttpError(400, 'Invalid upload', 'No file received');
  }

  if (!file.type || !file.type.startsWith('image/')) {
    throw new HttpError(400, 'Invalid upload', 'Only image files are allowed');
  }

  const extension = file.name.includes('.')
    ? file.name.split('.').pop().toLowerCase()
    : 'jpg';

  const key = `bench-images/${crypto.randomUUID()}.${extension}`;

  await env.BUCKET.put(key, await file.arrayBuffer(), {
    httpMetadata: {
      contentType: file.type
    }
  });

const publicUrl = `https://pub-483266975888471db0d51fff35148e9d.r2.dev/${key}`;
  return json({ url: publicUrl, key }, 201);
}

function queueGithubBackup(ctx, env, reason) {
  if (!ctx?.waitUntil) return;

  ctx.waitUntil(
    createGithubBackup(env, reason).catch((error) => {
      console.error('GitHub backup failed:', error);
    })
  );
}

async function createGithubBackup(env, reason) {
  if (!env.GITHUB_BACKUP_TOKEN) {
    console.warn('GitHub backup skipped: GITHUB_BACKUP_TOKEN is not configured.');
    return;
  }

  const backup = await buildBackupPayload(env, reason);
  const content = JSON.stringify(backup, null, 2);
  const today = todayIsoDate();
  const directory = String(env.GITHUB_BACKUP_DIRECTORY || 'backups').replace(/^\/+|\/+$/g, '');

  await putGithubFile(
    env,
    `${directory}/benches-latest.json`,
    content,
    `Update benches backup (${reason})`
  );

  if (String(reason).startsWith('scheduled:')) {
    await putGithubFile(
      env,
      `${directory}/benches-${today}.json`,
      content,
      `Update benches backup ${today}`
    );
  }
}

async function buildBackupPayload(env, reason) {
  const { results } = await env.DB.prepare(`
    SELECT id, title, lat, lng, status, last_inspection, notes, active, image_url, created_at, updated_at, deleted_at
    FROM benches
    ORDER BY id ASC
  `).all();

  const benches = results.map(normalizeBench);

  return {
    app: 'Baenke-Innichen',
    generated_at: new Date().toISOString(),
    reason,
    source: 'cloudflare-d1:innichen-benches',
    count: benches.length,
    active_count: benches.filter((bench) => bench.active && !bench.deleted_at).length,
    deleted_count: benches.filter((bench) => Boolean(bench.deleted_at)).length,
    benches
  };
}

async function putGithubFile(env, path, content, message) {
  const owner = env.GITHUB_BACKUP_OWNER;
  const repo = env.GITHUB_BACKUP_REPO;
  const branch = env.GITHUB_BACKUP_BRANCH || 'main';

  if (!owner || !repo) {
    throw new Error('GitHub backup repository is not configured.');
  }

  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
  const currentSha = await getGithubFileSha(env, url, branch);
  const body = {
    message,
    branch,
    content: base64Encode(content)
  };

  if (currentSha) {
    body.sha = currentSha;
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: githubHeaders(env),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`GitHub backup write failed: HTTP ${response.status} ${await response.text()}`);
  }
}

async function getGithubFileSha(env, url, branch) {
  const response = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, {
    headers: githubHeaders(env)
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub backup lookup failed: HTTP ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.sha ?? null;
}

function githubHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_BACKUP_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'baenke-innichen-worker',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function base64Encode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function validatePayload(payload, requireLocation) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, 'Invalid payload');
  }

  const normalized = {
    title: typeof payload.title === 'string' ? payload.title.trim() : payload.title,
    lat: payload.lat,
    lng: payload.lng,
    status: payload.status,
    last_inspection: payload.last_inspection ?? undefined,
    notes: typeof payload.notes === 'string' ? payload.notes.trim() : payload.notes,
    active: payload.active,
    image_url:
      typeof payload.image_url === 'string'
        ? payload.image_url.trim()
        : payload.image_url
  };

  if (requireLocation) {
    if (!Number.isFinite(normalized.lat) || !Number.isFinite(normalized.lng)) {
      throw new HttpError(400, 'lat and lng are required numbers');
    }
  } else {
    if (typeof normalized.lat !== 'undefined' && !Number.isFinite(normalized.lat)) {
      throw new HttpError(400, 'lat must be a number');
    }
    if (typeof normalized.lng !== 'undefined' && !Number.isFinite(normalized.lng)) {
      throw new HttpError(400, 'lng must be a number');
    }
  }

  if (requireLocation && !normalized.title) {
    throw new HttpError(400, 'title is required');
  }

  if (typeof normalized.title !== 'undefined') {
    if (typeof normalized.title !== 'string' || !normalized.title.trim()) {
      throw new HttpError(400, 'title must be a non-empty string');
    }

    if (normalized.title.length > 200) {
      throw new HttpError(400, 'title too long');
    }
  }

  if (typeof normalized.status !== 'undefined' && !ALLOWED_STATUSES.includes(normalized.status)) {
    throw new HttpError(400, 'invalid status');
  }

  if (typeof normalized.last_inspection !== 'undefined' && normalized.last_inspection !== null) {
    if (
      typeof normalized.last_inspection !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(normalized.last_inspection)
    ) {
      throw new HttpError(400, 'invalid last_inspection date format');
    }
  }

  if (typeof normalized.notes !== 'undefined') {
    if (typeof normalized.notes !== 'string') {
      throw new HttpError(400, 'notes must be a string');
    }

    if (normalized.notes.length > 5000) {
      throw new HttpError(400, 'notes too long');
    }
  }

  if (typeof normalized.active !== 'undefined' && typeof normalized.active !== 'boolean') {
    throw new HttpError(400, 'active must be a boolean');
  }

  if (typeof normalized.image_url !== 'undefined' && normalized.image_url !== null) {
    if (typeof normalized.image_url !== 'string') {
      throw new HttpError(400, 'image_url must be a string');
    }

    if (normalized.image_url.length > 2000) {
      throw new HttpError(400, 'image_url too long');
    }
  }

  return normalized;
}

function applyBusinessRules(payload, isCreate) {
  const next = {
    ...payload
  };

  if (typeof next.notes === 'undefined') {
    next.notes = isCreate ? '' : undefined;
  }

  if (typeof next.active === 'undefined') {
    next.active = isCreate ? true : undefined;
  }

  if (typeof next.image_url === 'undefined') {
    next.image_url = isCreate ? null : undefined;
  }

  if (next.status === 'removed') {
    next.active = false;
  }

  if (next.status === 'ok' && typeof next.last_inspection === 'undefined') {
    next.last_inspection = todayIsoDate();
  }

  return next;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeBench(row) {
  if (!row) return null;

  return {
    ...row,
    lat: Number(row.lat),
    lng: Number(row.lng),
    active: Boolean(row.active),
    image_url: row.image_url ?? null
  };
}

async function runStatement(stmt, status) {
  try {
    return await stmt.run();
  } catch (error) {
    throw mapDatabaseError(error, status);
  }
}

function mapDatabaseError(error, status) {
  const message = String(error?.message || error);

  if (message.includes('CHECK constraint failed') && status === 'good') {
    return new HttpError(
      409,
      'Lokale Datenbank verwendet noch das alte Status-Schema.',
      'Bitte zuerst die Status-Migration ausführen.'
    );
  }

  if (message.includes('CHECK constraint failed')) {
    return new HttpError(400, 'Ungültige Daten für Datenbank-Constraints');
  }

  return error;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders()
    }
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
