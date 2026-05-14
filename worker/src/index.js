const ALLOWED_STATUSES = ['good', 'ok', 'to_check', 'repair', 'removed'];
const MAX_NOTES_LENGTH = 5000;
const MAX_IMAGE_URL_LENGTH = 2000;
const MAX_TRAIL_SITE_NUMBER_LENGTH = 80;
const MAX_TRAIL_DIRECTION_LENGTH = 120;
const MAX_TRAIL_NUMBER_LENGTH = 80;
const MAX_TRAIL_LABEL_LENGTH = 200;
const MAX_TRAIL_DURATION_LENGTH = 80;
const MAX_GITHUB_IMAGE_BACKUP_BYTES = 750_000;
const MAX_REFERENCED_IMAGE_BACKUPS_PER_RUN = 20;
const DEFAULT_TRAIL_SITE_NUMBER = 'Ohne Nummer';

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
        return await createBench(request, env, ctx);
      }

      if (url.pathname === '/api/trail-poles' && request.method === 'GET') {
        return await listTrailPoles(url, env);
      }

      if (url.pathname === '/api/trail-poles' && request.method === 'POST') {
        return await createTrailPole(request, env, ctx);
      }

      if (url.pathname === '/api/upload' && request.method === 'POST') {
        return await uploadImage(request, env, ctx);
      }

      if (url.pathname === '/api/backups/github' && request.method === 'POST') {
        return await createManualGithubBackup(request, env, ctx);
      }

      if (url.pathname === '/api/backups/github/images' && request.method === 'POST') {
        return await createManualGithubImageBackup(request, env);
      }

      if (url.pathname === '/api/history' && request.method === 'GET') {
        return await listAllBenchHistory(url, env);
      }

      const benchHistoryMatch = url.pathname.match(/^\/api\/benches\/(\d+)\/history$/);
      if (benchHistoryMatch && request.method === 'GET') {
        return await listBenchHistory(Number(benchHistoryMatch[1]), env);
      }

      const benchIdMatch = url.pathname.match(/^\/api\/benches\/(\d+)$/);
      if (benchIdMatch && request.method === 'PUT') {
        return await updateBench(Number(benchIdMatch[1]), request, env);
      }

      if (benchIdMatch && request.method === 'DELETE') {
        return await deleteBench(Number(benchIdMatch[1]), env);
      }

      const trailPoleIdMatch = url.pathname.match(/^\/api\/trail-poles\/(\d+)$/);
      if (trailPoleIdMatch && request.method === 'GET') {
        return await getTrailPole(Number(trailPoleIdMatch[1]), env);
      }

      if (trailPoleIdMatch && request.method === 'PUT') {
        return await updateTrailPole(Number(trailPoleIdMatch[1]), request, env);
      }

      if (trailPoleIdMatch && request.method === 'DELETE') {
        return await deleteTrailPole(Number(trailPoleIdMatch[1]), env);
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
    queueGithubBackup(ctx, env, `scheduled:${controller.cron}`, {
      backupReferencedImages: true
    });
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

async function createBench(request, env, ctx) {
  const body = await readJsonBody(request);
  const payload = validateBenchPayload(body, true);
  const preparedPayload = applyBenchBusinessRules(payload, true);

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

  await recordBenchHistory(env, created.id, 'created', [
    changeDetail('title', null, created.title),
    changeDetail('status', null, created.status),
    changeDetail('last_inspection', null, created.last_inspection),
    changeDetail('lat', null, created.lat),
    changeDetail('lng', null, created.lng),
    changeDetail('image_url', null, created.image_url)
  ].filter(Boolean));

  queueGithubBackup(ctx, env, `bench-created:${created.id}`);

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
  const payload = validateBenchPayload(body, false);
  const preparedPayload = applyBenchBusinessRules(payload, false);
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

  const changes = buildBenchChanges(existing, updated);
  if (changes.length) {
    await recordBenchHistory(env, id, inferHistoryAction(changes), changes);
  }

  return json(normalizeBench(updated));
}

async function deleteBench(id, env) {
  const existing = await env.DB.prepare(`
    SELECT id, title, lat, lng, status, last_inspection, notes, active, image_url, created_at, updated_at, deleted_at
    FROM benches
    WHERE id = ?
  `)
    .bind(id)
    .first();

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

  await recordBenchHistory(env, id, 'deleted', buildBenchChanges(existing, deleted));

  return json({ ok: true, bench: normalizeBench(deleted) });
}

async function listBenchHistory(id, env) {
  const { results } = await env.DB.prepare(`
    SELECT id, bench_id, action, actor, details, created_at
    FROM bench_history
    WHERE bench_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 80
  `)
    .bind(id)
    .all();

  return json(results.map(normalizeHistoryEntry));
}

async function listAllBenchHistory(url, env) {
  const requestedLimit = Number(url.searchParams.get('limit') || 120);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 120, 1), 250);

  const { results } = await env.DB.prepare(`
    SELECT
      bench_history.id,
      bench_history.bench_id,
      bench_history.action,
      bench_history.actor,
      bench_history.details,
      bench_history.created_at,
      benches.title AS bench_title,
      benches.status AS bench_status,
      benches.active AS bench_active,
      benches.deleted_at AS bench_deleted_at
    FROM bench_history
    LEFT JOIN benches ON benches.id = bench_history.bench_id
    ORDER BY bench_history.created_at DESC, bench_history.id DESC
    LIMIT ?
  `)
    .bind(limit)
    .all();

  return json(results.map(normalizeHistoryEntry));
}

async function listTrailPoles(url, env) {
  const includeInactive = url.searchParams.get('active') === 'all';

  const query = includeInactive
    ? `
      SELECT id, site_number, lat, lng, active, notes, image_url, created_at, updated_at
      FROM trail_poles
      ORDER BY id DESC
    `
    : `
      SELECT id, site_number, lat, lng, active, notes, image_url, created_at, updated_at
      FROM trail_poles
      WHERE active = 1
      ORDER BY id DESC
    `;

  const { results } = await env.DB.prepare(query).all();
  return json(await hydrateTrailPoles(env, results));
}

async function getTrailPole(id, env) {
  const pole = await fetchTrailPoleAggregate(env, id);

  if (!pole) {
    return json({ error: 'Trail pole not found' }, 404);
  }

  return json(pole);
}

async function createTrailPole(request, env, ctx) {
  const body = await readJsonBody(request);
  const payload = validateTrailPolePayload(body, true);

  const result = await runStatement(
    env.DB.prepare(`
      INSERT INTO trail_poles (
        site_number,
        lat,
        lng,
        active,
        notes,
        image_url
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      payload.site_number,
      payload.lat,
      payload.lng,
      payload.active ? 1 : 0,
      payload.notes ?? null,
      payload.image_url ?? null
    )
  );

  const poleId = result.meta.last_row_id;

  try {
    await replaceTrailPoleSignboards(env, poleId, payload.signboards);
  } catch (error) {
    await env.DB.prepare(`DELETE FROM trail_poles WHERE id = ?`)
      .bind(poleId)
      .run()
      .catch(() => {});
    throw error;
  }

  const created = await fetchTrailPoleAggregate(env, poleId);
  queueGithubBackup(ctx, env, `trail-pole-created:${created.id}`);

  return json(created, 201);
}

async function updateTrailPole(id, request, env) {
  const existing = await fetchTrailPoleRow(env, id);

  if (!existing) {
    return json({ error: 'Trail pole not found' }, 404);
  }

  const body = await readJsonBody(request);
  const payload = validateTrailPolePayload(body, false);
  const hasScalarUpdates =
    typeof payload.site_number !== 'undefined'
    || Number.isFinite(payload.lat)
    || Number.isFinite(payload.lng)
    || typeof payload.active === 'boolean'
    || hasOwn(payload, 'notes')
    || hasOwn(payload, 'image_url');
  const shouldReplaceSignboards = hasOwn(payload, 'signboards');

  if (hasScalarUpdates) {
    const result = await runStatement(
      env.DB.prepare(`
        UPDATE trail_poles
        SET
          site_number = COALESCE(?, site_number),
          lat = COALESCE(?, lat),
          lng = COALESCE(?, lng),
          active = COALESCE(?, active),
          notes = CASE WHEN ? THEN ? ELSE notes END,
          image_url = CASE WHEN ? THEN ? ELSE image_url END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        dbValue(payload.site_number),
        Number.isFinite(payload.lat) ? payload.lat : null,
        Number.isFinite(payload.lng) ? payload.lng : null,
        typeof payload.active === 'boolean'
          ? (payload.active ? 1 : 0)
          : null,
        hasOwn(payload, 'notes') ? 1 : 0,
        hasOwn(payload, 'notes') ? dbValue(payload.notes) : null,
        hasOwn(payload, 'image_url') ? 1 : 0,
        hasOwn(payload, 'image_url') ? dbValue(payload.image_url) : null,
        id
      )
    );

    if (result.meta.changes === 0) {
      return json({ error: 'Trail pole not found' }, 404);
    }
  }

  if (shouldReplaceSignboards) {
    await replaceTrailPoleSignboards(env, id, payload.signboards);
    if (!hasScalarUpdates) {
      await touchTrailPole(env, id);
    }
  }

  const updated = await fetchTrailPoleAggregate(env, id);
  return json(updated);
}

async function deleteTrailPole(id, env) {
  const existing = await fetchTrailPoleAggregate(env, id);

  if (!existing) {
    return json({ error: 'Trail pole not found' }, 404);
  }

  const result = await env.DB.prepare(`
    DELETE FROM trail_poles
    WHERE id = ?
  `)
    .bind(id)
    .run();

  if (result.meta.changes === 0) {
    return json({ error: 'Trail pole not found' }, 404);
  }

  return json({
    ok: true,
    trail_pole: existing
  });
}

async function fetchTrailPoleRow(env, id) {
  return env.DB.prepare(`
    SELECT id, site_number, lat, lng, active, notes, image_url, created_at, updated_at
    FROM trail_poles
    WHERE id = ?
  `)
    .bind(id)
    .first();
}

async function fetchTrailPoleAggregate(env, id) {
  const row = await fetchTrailPoleRow(env, id);
  if (!row) return null;

  const [pole] = await hydrateTrailPoles(env, [row]);
  return pole ?? null;
}

async function hydrateTrailPoles(env, poleRows) {
  const poles = poleRows.map(normalizeTrailPole);

  if (!poles.length) {
    return [];
  }

  const poleIds = poles.map((pole) => pole.id);
  const { results: signboardRows } = await env.DB.prepare(`
    SELECT id, pole_id, direction, trail_number, sort_order
    FROM trail_signboards
    WHERE pole_id IN (${buildInClausePlaceholders(poleIds.length)})
    ORDER BY pole_id ASC, sort_order ASC, id ASC
  `)
    .bind(...poleIds)
    .all();

  const signboards = signboardRows.map(normalizeTrailSignboard);
  const signboardIds = signboards.map((signboard) => signboard.id);
  let entries = [];

  if (signboardIds.length) {
    const { results: entryRows } = await env.DB.prepare(`
      SELECT id, signboard_id, label, duration, sort_order
      FROM trail_sign_entries
      WHERE signboard_id IN (${buildInClausePlaceholders(signboardIds.length)})
      ORDER BY signboard_id ASC, sort_order ASC, id ASC
    `)
      .bind(...signboardIds)
      .all();

    entries = entryRows.map(normalizeTrailSignEntry);
  }

  const entriesBySignboard = new Map();
  for (const entry of entries) {
    const signboardEntries = entriesBySignboard.get(entry.signboard_id) ?? [];
    signboardEntries.push(entry);
    entriesBySignboard.set(entry.signboard_id, signboardEntries);
  }

  const signboardsByPole = new Map();
  for (const signboard of signboards) {
    const poleSignboards = signboardsByPole.get(signboard.pole_id) ?? [];
    poleSignboards.push({
      ...signboard,
      entries: entriesBySignboard.get(signboard.id) ?? []
    });
    signboardsByPole.set(signboard.pole_id, poleSignboards);
  }

  return poles.map((pole) => ({
    ...pole,
    signboards: signboardsByPole.get(pole.id) ?? []
  }));
}

async function replaceTrailPoleSignboards(env, poleId, signboards) {
  await runStatement(
    env.DB.prepare(`
      DELETE FROM trail_signboards
      WHERE pole_id = ?
    `).bind(poleId)
  );

  for (const signboard of signboards) {
    const signboardResult = await runStatement(
      env.DB.prepare(`
        INSERT INTO trail_signboards (
          pole_id,
          direction,
          trail_number,
          sort_order
        )
        VALUES (?, ?, ?, ?)
      `).bind(
        poleId,
        signboard.direction,
        signboard.trail_number,
        signboard.sort_order
      )
    );

    const signboardId = signboardResult.meta.last_row_id;
    await env.DB.batch(
      signboard.entries.map((entry) => env.DB.prepare(`
        INSERT INTO trail_sign_entries (
          signboard_id,
          label,
          duration,
          sort_order
        )
        VALUES (?, ?, ?, ?)
      `).bind(
        signboardId,
        entry.label,
        entry.duration ?? null,
        entry.sort_order
      ))
    );
  }
}

async function touchTrailPole(env, poleId) {
  await env.DB.prepare(`
    UPDATE trail_poles
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `)
    .bind(poleId)
    .run();
}

async function uploadImage(request, env, ctx) {
  const formData = await request.formData();
  const file = formData.get('file');
  const uploadType = String(formData.get('type') || 'bench');

  if (!(file instanceof File)) {
    throw new HttpError(400, 'Invalid upload', 'No file received');
  }

  if (!file.type || !file.type.startsWith('image/')) {
    throw new HttpError(400, 'Invalid upload', 'Only image files are allowed');
  }

  const extension = file.name.includes('.')
    ? file.name.split('.').pop().toLowerCase()
    : 'jpg';

  const folder = uploadType === 'wanderbeschilderungen'
    ? 'wanderbeschilderungen'
    : 'bench-images';
  const key = `${folder}/${crypto.randomUUID()}.${extension}`;
  const bytes = await file.arrayBuffer();

  await env.BUCKET.put(key, bytes, {
    httpMetadata: {
      contentType: file.type
    }
  });

  queueGithubImageBackup(ctx, env, {
    key,
    bytes,
    contentType: file.type
  });

  const publicUrl = `https://pub-483266975888471db0d51fff35148e9d.r2.dev/${key}`;
  return json({ url: publicUrl, key }, 201);
}

function queueGithubBackup(ctx, env, reason, options = {}) {
  if (!ctx?.waitUntil) return;

  ctx.waitUntil(
    createGithubBackup(env, reason, options).catch((error) => {
      console.error('GitHub backup failed:', error);
    })
  );
}

function queueGithubImageBackup(ctx, env, image) {
  if (!ctx?.waitUntil) return;

  ctx.waitUntil(
    backupUploadedImage(env, image).catch((error) => {
      console.error('GitHub image backup failed:', error);
    })
  );
}

async function createGithubBackup(env, reason, options = {}) {
  if (!env.GITHUB_BACKUP_TOKEN) {
    throw new Error('GitHub backup skipped: GITHUB_BACKUP_TOKEN is not configured.');
  }

  const benchesBackup = await buildBenchBackupPayload(env, reason);
  const trailPolesBackup = await buildTrailPolesBackupPayload(env, reason);
  const directory = String(env.GITHUB_BACKUP_DIRECTORY || 'backups').replace(/^\/+|\/+$/g, '');

  const benchesLatest = await putGithubFile(
    env,
    `${directory}/benches-latest.json`,
    JSON.stringify(benchesBackup, null, 2),
    `Update benches backup (${reason})`
  );
  const trailPolesLatest = await putGithubFile(
    env,
    `${directory}/trail-poles-latest.json`,
    JSON.stringify(trailPolesBackup, null, 2),
    `Update trail poles backup (${reason})`
  );
  const imageBackup = options.backupReferencedImages
    ? await backupReferencedImages(
      env,
      directory,
      [
        ...benchesBackup.benches.map((bench) => bench.image_url),
        ...trailPolesBackup.trail_poles.map((pole) => pole.image_url)
      ],
      reason
    )
    : { queued: false };

  return {
    benches: {
      count: benchesBackup.count,
      active_count: benchesBackup.active_count,
      deleted_count: benchesBackup.deleted_count
    },
    trail_poles: {
      count: trailPolesBackup.count,
      active_count: trailPolesBackup.active_count,
      signboard_count: trailPolesBackup.signboard_count,
      entry_count: trailPolesBackup.entry_count
    },
    images: imageBackup,
    written: [benchesLatest, trailPolesLatest]
  };
}

async function backupUploadedImage(env, image) {
  if (!env.GITHUB_BACKUP_TOKEN) {
    throw new Error('GitHub image backup skipped: GITHUB_BACKUP_TOKEN is not configured.');
  }

  if (image.bytes.byteLength > MAX_GITHUB_IMAGE_BACKUP_BYTES) {
    console.warn(
      `GitHub image backup skipped: ${image.key} is ${image.bytes.byteLength} bytes.`
    );
    return null;
  }

  const directory = String(env.GITHUB_BACKUP_DIRECTORY || 'backups').replace(/^\/+|\/+$/g, '');
  return putGithubBinaryFile(
    env,
    `${directory}/images/${image.key}`,
    image.bytes,
    `Backup uploaded image ${image.key}`
  );
}

async function backupReferencedImages(env, directory, imageUrls, reason) {
  const refs = uniqueImageBackupRefs(imageUrls, directory);
  const existingPaths = await getGithubTreePaths(env, `${directory}/images/`);
  const treeElements = [];
  const result = {
    checked: refs.length,
    backed_up: 0,
    skipped_existing: 0,
    skipped_large: 0,
    skipped_failed: 0,
    remaining: 0
  };

  for (const ref of refs) {
    if (result.backed_up >= MAX_REFERENCED_IMAGE_BACKUPS_PER_RUN) {
      result.remaining += 1;
      continue;
    }

    if (existingPaths.has(ref.path)) {
      result.skipped_existing += 1;
      continue;
    }

    try {
      const image = await fetchBackupImage(ref.url);
      if (!image) {
        result.skipped_failed += 1;
        continue;
      }

      if (image.tooLarge || image.bytes.byteLength > MAX_GITHUB_IMAGE_BACKUP_BYTES) {
        result.skipped_large += 1;
        continue;
      }

      const blobSha = await createGithubBlob(env, arrayBufferToBase64(image.bytes));
      treeElements.push({
        path: ref.path,
        mode: '100644',
        type: 'blob',
        sha: blobSha
      });
      result.backed_up += 1;
    } catch (error) {
      console.error('Referenced image backup failed:', ref.url, error);
      result.skipped_failed += 1;
    }
  }

  if (treeElements.length) {
    const branch = env.GITHUB_BACKUP_BRANCH || 'main';
    const headSha = await getGithubBranchHeadSha(env, branch);
    const headCommit = await getGithubCommit(env, headSha);
    const treeSha = await createGithubTree(env, headCommit.tree.sha, treeElements);
    const commitSha = await createGithubCommit(
      env,
      `Backup ${treeElements.length} referenced image(s) (${reason})`,
      treeSha,
      headSha
    );
    await updateGithubBranchHead(env, branch, commitSha);
    result.commit = commitSha;
  }

  return result;
}

function uniqueImageBackupRefs(imageUrls, directory) {
  const refsByPath = new Map();

  for (const imageUrl of imageUrls) {
    const ref = imageBackupRefFromUrl(imageUrl, directory);
    if (ref && !refsByPath.has(ref.path)) {
      refsByPath.set(ref.path, ref);
    }
  }

  return Array.from(refsByPath.values());
}

function imageBackupRefFromUrl(imageUrl, directory) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;

  let url;
  try {
    url = new URL(imageUrl);
  } catch {
    return null;
  }

  const path = url.pathname.replace(/^\/+/, '');
  const imageIndex = path.indexOf('bench-images/') >= 0
    ? path.indexOf('bench-images/')
    : path.indexOf('wanderbeschilderungen/');
  if (imageIndex === -1) return null;

  const key = path.slice(imageIndex);
  if (!/^[a-z0-9/_\-.]+$/i.test(key)) return null;

  return {
    url: imageUrl,
    key,
    path: `${directory}/images/${key}`
  };
}

async function fetchBackupImage(url) {
  const response = await fetch(url);
  if (!response.ok) return null;

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) return null;

  const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_GITHUB_IMAGE_BACKUP_BYTES) {
    return {
      bytes: new ArrayBuffer(0),
      tooLarge: true
    };
  }

  return {
    bytes: await response.arrayBuffer()
  };
}

async function createManualGithubBackup(request, env, ctx) {
  const body = await readJsonBody(request);

  if (body?.confirm !== 'backup') {
    throw new HttpError(400, 'Backup confirmation is required');
  }

  const result = await createGithubBackup(env, 'manual');
  queueReferencedImageBackup(ctx, env, 'manual');
  return json({
    ok: true,
    image_backfill_queued: true,
    ...result
  });
}

async function createManualGithubImageBackup(request, env) {
  const body = await readJsonBody(request);

  if (body?.confirm !== 'backup') {
    throw new HttpError(400, 'Backup confirmation is required');
  }

  const result = await backupAllReferencedImages(env, 'manual-images');
  return json({
    ok: true,
    images: result
  });
}

function queueReferencedImageBackup(ctx, env, reason) {
  if (!ctx?.waitUntil) return;

  ctx.waitUntil(
    backupAllReferencedImages(env, reason).catch((error) => {
      console.error('GitHub referenced image backup failed:', error);
    })
  );
}

async function backupAllReferencedImages(env, reason) {
  if (!env.GITHUB_BACKUP_TOKEN) {
    throw new Error('GitHub image backup skipped: GITHUB_BACKUP_TOKEN is not configured.');
  }

  const benchesBackup = await buildBenchBackupPayload(env, reason);
  const trailPolesBackup = await buildTrailPolesBackupPayload(env, reason);
  const directory = String(env.GITHUB_BACKUP_DIRECTORY || 'backups').replace(/^\/+|\/+$/g, '');

  return backupReferencedImages(
    env,
    directory,
    [
      ...benchesBackup.benches.map((bench) => bench.image_url),
      ...trailPolesBackup.trail_poles.map((pole) => pole.image_url)
    ],
    reason
  );
}

async function buildBenchBackupPayload(env, reason) {
  const { results } = await env.DB.prepare(`
    SELECT id, title, lat, lng, status, last_inspection, notes, active, image_url, created_at, updated_at, deleted_at
    FROM benches
    ORDER BY id ASC
  `).all();

  const benches = results.map(normalizeBench);
  const { results: historyResults } = await env.DB.prepare(`
    SELECT id, bench_id, action, actor, details, created_at
    FROM bench_history
    ORDER BY id ASC
  `).all();

  return {
    app: 'Baenke-Innichen',
    generated_at: new Date().toISOString(),
    reason,
    source: 'cloudflare-d1:innichen-benches',
    count: benches.length,
    active_count: benches.filter((bench) => bench.active && !bench.deleted_at).length,
    deleted_count: benches.filter((bench) => Boolean(bench.deleted_at)).length,
    benches,
    history: historyResults.map(normalizeHistoryEntry)
  };
}

async function buildTrailPolesBackupPayload(env, reason) {
  const { results } = await env.DB.prepare(`
    SELECT id, site_number, lat, lng, active, notes, image_url, created_at, updated_at
    FROM trail_poles
    ORDER BY id ASC
  `).all();

  const trailPoles = await hydrateTrailPoles(env, results);
  const signboardCount = trailPoles.reduce(
    (count, pole) => count + pole.signboards.length,
    0
  );
  const entryCount = trailPoles.reduce(
    (count, pole) => count + pole.signboards.reduce(
      (entryTotal, signboard) => entryTotal + signboard.entries.length,
      0
    ),
    0
  );

  return {
    app: 'Baenke-Innichen',
    generated_at: new Date().toISOString(),
    reason,
    source: 'cloudflare-d1:innichen-benches',
    count: trailPoles.length,
    active_count: trailPoles.filter((pole) => pole.active).length,
    signboard_count: signboardCount,
    entry_count: entryCount,
    trail_poles: trailPoles
  };
}

async function putGithubFile(env, path, content, message) {
  return putGithubContent(
    env,
    path,
    base64Encode(content),
    message
  );
}

async function putGithubBinaryFile(env, path, arrayBuffer, message) {
  return putGithubContent(
    env,
    path,
    arrayBufferToBase64(arrayBuffer),
    message
  );
}

async function putGithubContent(env, path, encodedContent, message) {
  const owner = env.GITHUB_BACKUP_OWNER;
  const repo = env.GITHUB_BACKUP_REPO;
  const branch = env.GITHUB_BACKUP_BRANCH || 'main';

  if (!owner || !repo) {
    throw new Error('GitHub backup repository is not configured.');
  }

  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentSha = await getGithubFileSha(env, url, branch);
    const body = {
      message,
      branch,
      content: encodedContent
    };

    if (currentSha) {
      body.sha = currentSha;
    }

    const response = await fetch(url, {
      method: 'PUT',
      headers: githubHeaders(env),
      body: JSON.stringify(body)
    });

    if (response.status === 409 && attempt < 2) {
      await sleep(250 * (attempt + 1));
      continue;
    }

    if (!response.ok) {
      throw new Error(`GitHub backup write failed: HTTP ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return {
      path,
      commit: data.commit?.sha ?? null,
      url: data.content?.html_url ?? null
    };
  }

  throw new Error('GitHub backup write failed after retries.');
}

async function githubFileExists(env, path) {
  const owner = env.GITHUB_BACKUP_OWNER;
  const repo = env.GITHUB_BACKUP_REPO;
  const branch = env.GITHUB_BACKUP_BRANCH || 'main';

  if (!owner || !repo) {
    throw new Error('GitHub backup repository is not configured.');
  }

  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
  return Boolean(await getGithubFileSha(env, url, branch));
}

async function getGithubTreePaths(env, prefix) {
  const branch = env.GITHUB_BACKUP_BRANCH || 'main';
  const headSha = await getGithubBranchHeadSha(env, branch);
  const commit = await getGithubCommit(env, headSha);
  const owner = env.GITHUB_BACKUP_OWNER;
  const repo = env.GITHUB_BACKUP_REPO;
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${commit.tree.sha}?recursive=1`;
  const response = await fetch(url, {
    headers: githubHeaders(env)
  });

  if (!response.ok) {
    throw new Error(`GitHub tree lookup failed: HTTP ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return new Set(
    (data.tree || [])
      .filter((entry) => entry.type === 'blob' && entry.path?.startsWith(prefix))
      .map((entry) => entry.path)
  );
}

async function getGithubBranchHeadSha(env, branch) {
  const owner = env.GITHUB_BACKUP_OWNER;
  const repo = env.GITHUB_BACKUP_REPO;
  const url = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
  const response = await fetch(url, {
    headers: githubHeaders(env)
  });

  if (!response.ok) {
    throw new Error(`GitHub ref lookup failed: HTTP ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.object?.sha;
}

async function getGithubCommit(env, commitSha) {
  const owner = env.GITHUB_BACKUP_OWNER;
  const repo = env.GITHUB_BACKUP_REPO;
  const url = `https://api.github.com/repos/${owner}/${repo}/git/commits/${commitSha}`;
  const response = await fetch(url, {
    headers: githubHeaders(env)
  });

  if (!response.ok) {
    throw new Error(`GitHub commit lookup failed: HTTP ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function createGithubBlob(env, encodedContent) {
  const owner = env.GITHUB_BACKUP_OWNER;
  const repo = env.GITHUB_BACKUP_REPO;
  const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs`;
  const response = await fetch(url, {
    method: 'POST',
    headers: githubHeaders(env),
    body: JSON.stringify({
      content: encodedContent,
      encoding: 'base64'
    })
  });

  if (!response.ok) {
    throw new Error(`GitHub blob create failed: HTTP ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.sha;
}

async function createGithubTree(env, baseTreeSha, treeElements) {
  const owner = env.GITHUB_BACKUP_OWNER;
  const repo = env.GITHUB_BACKUP_REPO;
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees`;
  const response = await fetch(url, {
    method: 'POST',
    headers: githubHeaders(env),
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeElements
    })
  });

  if (!response.ok) {
    throw new Error(`GitHub tree create failed: HTTP ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.sha;
}

async function createGithubCommit(env, message, treeSha, parentSha) {
  const owner = env.GITHUB_BACKUP_OWNER;
  const repo = env.GITHUB_BACKUP_REPO;
  const url = `https://api.github.com/repos/${owner}/${repo}/git/commits`;
  const response = await fetch(url, {
    method: 'POST',
    headers: githubHeaders(env),
    body: JSON.stringify({
      message,
      tree: treeSha,
      parents: [parentSha]
    })
  });

  if (!response.ok) {
    throw new Error(`GitHub commit create failed: HTTP ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.sha;
}

async function updateGithubBranchHead(env, branch, commitSha) {
  const owner = env.GITHUB_BACKUP_OWNER;
  const repo = env.GITHUB_BACKUP_REPO;
  const url = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: githubHeaders(env),
    body: JSON.stringify({
      sha: commitSha,
      force: false
    })
  });

  if (!response.ok) {
    throw new Error(`GitHub ref update failed: HTTP ${response.status} ${await response.text()}`);
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

function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function validateBenchPayload(payload, requireLocation) {
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

    if (normalized.notes.length > MAX_NOTES_LENGTH) {
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

    if (normalized.image_url.length > MAX_IMAGE_URL_LENGTH) {
      throw new HttpError(400, 'image_url too long');
    }
  }

  return normalized;
}

function applyBenchBusinessRules(payload, isCreate) {
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

function validateTrailPolePayload(payload, isCreate) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, 'Invalid payload');
  }

  const normalized = {
    site_number: normalizeStringField(payload.site_number, 'site_number', {
      allowNumber: true,
      maxLength: MAX_TRAIL_SITE_NUMBER_LENGTH
    }),
    lat: payload.lat,
    lng: payload.lng,
    active: payload.active,
    image_url:
      typeof payload.image_url === 'string'
        ? payload.image_url.trim()
        : payload.image_url
  };

  if (isCreate) {
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

  if (typeof normalized.active !== 'undefined' && typeof normalized.active !== 'boolean') {
    throw new HttpError(400, 'active must be a boolean');
  }

  if (isCreate && !normalized.site_number) {
    normalized.site_number = DEFAULT_TRAIL_SITE_NUMBER;
  }

  if (typeof normalized.image_url !== 'undefined' && normalized.image_url !== null) {
    if (typeof normalized.image_url !== 'string') {
      throw new HttpError(400, 'image_url must be a string');
    }

    if (normalized.image_url.length > MAX_IMAGE_URL_LENGTH) {
      throw new HttpError(400, 'image_url too long');
    }
  } else if (isCreate) {
    normalized.image_url = null;
  }

  if (hasOwn(payload, 'notes')) {
    normalized.notes = normalizeStringField(payload.notes, 'notes', {
      allowNull: true,
      emptyAsNull: true,
      maxLength: MAX_NOTES_LENGTH
    });
  } else if (isCreate) {
    normalized.notes = null;
  }

  if (hasOwn(payload, 'signboards')) {
    if (!Array.isArray(payload.signboards)) {
      throw new HttpError(400, 'signboards must be an array');
    }

    normalized.signboards = payload.signboards.map((signboard, index) =>
      validateTrailSignboardPayload(signboard, index)
    );
  } else if (isCreate) {
    normalized.signboards = [];
  }

  return normalized;
}

function validateTrailSignboardPayload(payload, index) {
  const fieldPrefix = `signboards[${index}]`;

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, `${fieldPrefix} must be an object`);
  }

  if (!Array.isArray(payload.entries)) {
    throw new HttpError(400, `${fieldPrefix}.entries must be an array`);
  }

  if (payload.entries.length < 1 || payload.entries.length > 2) {
    throw new HttpError(400, `${fieldPrefix}.entries must contain 1 or 2 items`);
  }

  const normalized = {
    direction: normalizeStringField(payload.direction, `${fieldPrefix}.direction`, {
      required: true,
      maxLength: MAX_TRAIL_DIRECTION_LENGTH
    }),
    trail_number: normalizeStringField(payload.trail_number, `${fieldPrefix}.trail_number`, {
      required: true,
      allowNumber: true,
      maxLength: MAX_TRAIL_NUMBER_LENGTH
    }),
    sort_order: validateSortOrder(payload.sort_order, index, `${fieldPrefix}.sort_order`),
    entries: payload.entries.map((entry, entryIndex) =>
      validateTrailSignEntryPayload(entry, entryIndex, `${fieldPrefix}.entries[${entryIndex}]`)
    )
  };

  return normalized;
}

function validateTrailSignEntryPayload(payload, index, fieldPrefix) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, `${fieldPrefix} must be an object`);
  }

  return {
    label: normalizeStringField(payload.label, `${fieldPrefix}.label`, {
      required: true,
      maxLength: MAX_TRAIL_LABEL_LENGTH
    }),
    duration: hasOwn(payload, 'duration')
      ? normalizeStringField(payload.duration, `${fieldPrefix}.duration`, {
        allowNull: true,
        emptyAsNull: true,
        maxLength: MAX_TRAIL_DURATION_LENGTH
      })
      : null,
    sort_order: validateSortOrder(payload.sort_order, index, `${fieldPrefix}.sort_order`)
  };
}

function normalizeStringField(value, field, options = {}) {
  const {
    required = false,
    allowNull = false,
    emptyAsNull = false,
    allowNumber = false,
    maxLength = 200
  } = options;

  if (typeof value === 'undefined') {
    if (required) {
      throw new HttpError(400, `${field} is required`);
    }

    return undefined;
  }

  if (value === null) {
    if (allowNull || emptyAsNull) {
      return null;
    }

    throw new HttpError(400, `${field} must be a string`);
  }

  let normalized = value;
  if (allowNumber && typeof normalized === 'number' && Number.isFinite(normalized)) {
    normalized = String(normalized);
  }

  if (typeof normalized !== 'string') {
    throw new HttpError(400, `${field} must be a string`);
  }

  normalized = normalized.trim();

  if (!normalized) {
    if (required) {
      throw new HttpError(400, `${field} must be a non-empty string`);
    }

    if (allowNull || emptyAsNull) {
      return null;
    }

    return normalized;
  }

  if (normalized.length > maxLength) {
    throw new HttpError(400, `${field} too long`);
  }

  return normalized;
}

function validateSortOrder(value, fallback, field) {
  if (typeof value === 'undefined') {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new HttpError(400, `${field} must be a non-negative integer`);
  }

  return value;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildInClausePlaceholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function dbValue(value) {
  return typeof value === 'undefined' ? null : value;
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

function normalizeTrailPole(row) {
  if (!row) return null;

  return {
    ...row,
    id: Number(row.id),
    lat: Number(row.lat),
    lng: Number(row.lng),
    active: Boolean(row.active),
    notes: row.notes ?? null,
    image_url: row.image_url ?? null
  };
}

function normalizeTrailSignboard(row) {
  return {
    ...row,
    id: Number(row.id),
    pole_id: Number(row.pole_id),
    sort_order: Number(row.sort_order)
  };
}

function normalizeTrailSignEntry(row) {
  return {
    ...row,
    id: Number(row.id),
    signboard_id: Number(row.signboard_id),
    duration: row.duration ?? null,
    sort_order: Number(row.sort_order)
  };
}

function normalizeHistoryEntry(row) {
  return {
    ...row,
    bench_id: Number(row.bench_id),
    details: parseJsonDetails(row.details)
  };
}

function parseJsonDetails(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function recordBenchHistory(env, benchId, action, changes) {
  const filteredChanges = changes.filter(Boolean);
  const details = filteredChanges.length
    ? JSON.stringify({ changes: filteredChanges })
    : null;

  await env.DB.prepare(`
    INSERT INTO bench_history (bench_id, action, actor, details)
    VALUES (?, ?, ?, ?)
  `)
    .bind(benchId, action, 'Admin', details)
    .run();
}

function buildBenchChanges(before, after) {
  if (!before || !after) return [];

  return [
    changeDetail('title', before.title, after.title),
    changeDetail('status', before.status, after.status),
    changeDetail('last_inspection', before.last_inspection, after.last_inspection),
    changeDetail('notes', before.notes, after.notes),
    changeDetail('active', Boolean(before.active), Boolean(after.active)),
    changeDetail('image_url', before.image_url, after.image_url),
    changeDetail('lat', before.lat, after.lat),
    changeDetail('lng', before.lng, after.lng),
    changeDetail('deleted_at', before.deleted_at, after.deleted_at)
  ].filter(Boolean);
}

function changeDetail(field, beforeValue, afterValue) {
  const before = normalizeComparableValue(beforeValue);
  const after = normalizeComparableValue(afterValue);

  if (before === after) return null;

  return {
    field,
    label: historyFieldLabel(field),
    from: before,
    to: after
  };
}

function normalizeComparableValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number(value.toFixed(6));
  if (typeof value === 'boolean') return value;
  return String(value);
}

function inferHistoryAction(changes) {
  const fields = new Set(changes.map((change) => change.field));

  if (fields.has('deleted_at')) return 'deleted';
  if (fields.has('image_url')) return 'photo_updated';
  if (fields.has('last_inspection')) return 'inspection_updated';
  if (fields.has('lat') || fields.has('lng')) return 'position_updated';
  if (fields.has('status')) return 'status_updated';

  return 'updated';
}

function historyFieldLabel(field) {
  const labels = {
    title: 'Name',
    status: 'Status',
    last_inspection: 'Letzte Kontrolle',
    notes: 'Notiz',
    active: 'Aktiv',
    image_url: 'Foto',
    lat: 'Breite',
    lng: 'Länge',
    deleted_at: 'Gelöscht'
  };

  return labels[field] || field;
}

async function runStatement(stmt, status) {
  try {
    return await stmt.run();
  } catch (error) {
    throw mapDatabaseWriteError(error, status);
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

function mapDatabaseWriteError(error, status) {
  const message = String(error?.message || error);

  if (message.includes('NOT NULL constraint failed')) {
    return new HttpError(400, 'Pflichtfelder fehlen f\u00FCr den Datenbankeintrag');
  }

  if (message.includes('FOREIGN KEY constraint failed')) {
    return new HttpError(400, 'Verkn\u00FCpfte Wandertafel-Daten sind ung\u00FCltig');
  }

  if (message.includes('UNIQUE constraint failed')) {
    return new HttpError(409, 'Daten stehen im Konflikt mit einem bestehenden Eintrag');
  }

  return mapDatabaseError(error, status);
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
