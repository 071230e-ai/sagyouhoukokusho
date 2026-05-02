/**
 * Cloudflare Pages Functions
 * /tables/:table/:id  →  GET / PUT / PATCH / DELETE
 *
 * D1 binding  : env.DB  (Variable name = "DB")
 * database    : sagyouhokokushosisutemu-db
 */

/* ── CORS ────────────────────────────────────────────────── */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/* ── レスポンスヘルパー ──────────────────────────────────── */
const jsonRes = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

const errRes = (msg, status = 500, detail = '') => {
  console.error(`[API Error ${status}]`, msg, detail);
  return jsonRes({ error: msg, detail }, status);
};

/* ── バリデーション ──────────────────────────────────────── */
const isValidTable = (n) =>
  typeof n === 'string' && /^[a-zA-Z0-9_]{1,64}$/.test(n);

/* ── 行 → レコード変換 ───────────────────────────────────── */
const rowToRecord = (row) => {
  let parsed = {};
  try { parsed = JSON.parse(row.data || '{}'); } catch (_) { /* ignore */ }
  return { ...parsed, id: row.id, created_at: row.created_at, updated_at: row.updated_at };
};

/* ── リクエストボディ読み込み ────────────────────────────── */
async function readBody(request) {
  const text = await request.text();
  if (!text || text.trim() === '') throw new Error('Empty request body');
  return JSON.parse(text);
}

// ============================================================
// OPTIONS  ─ CORS preflight
// ============================================================
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// ============================================================
// GET /tables/:table/:id  ─ 単件取得
// ============================================================
export async function onRequestGet({ params, env }) {
  const { table, id } = params;
  if (!isValidTable(table)) return errRes('Invalid table name', 400);
  if (!env.DB)              return errRes('D1 binding "DB" is not configured.', 500);

  try {
    const row = await env.DB
      .prepare(`SELECT * FROM "${table}" WHERE id=? AND deleted=0`)
      .bind(id).first();

    if (!row) return errRes('Record not found', 404);
    return jsonRes(rowToRecord(row));
  } catch (e) {
    return errRes('Database SELECT error: ' + e.message, 500, e.stack || '');
  }
}

// ============================================================
// PUT /tables/:table/:id  ─ 全フィールド更新
// ============================================================
export async function onRequestPut({ params, request, env }) {
  const { table, id } = params;
  if (!isValidTable(table)) return errRes('Invalid table name', 400);
  if (!env.DB)              return errRes('D1 binding "DB" is not configured.', 500);

  let body;
  try   { body = await readBody(request); }
  catch (e) { return errRes('Invalid request body: ' + e.message, 400); }

  const now = Date.now();

  try {
    // 存在確認
    const existing = await env.DB
      .prepare(`SELECT id, created_at, data FROM "${table}" WHERE id=? AND deleted=0`)
      .bind(id).first();
    if (!existing) return errRes('Record not found', 404);

    const dataJson = JSON.stringify({ ...body, id });
    const result   = await env.DB
      .prepare(`UPDATE "${table}" SET data=?, updated_at=? WHERE id=? AND deleted=0`)
      .bind(dataJson, now, id).run();

    const changed = result?.meta?.changes ?? result?.changes ?? null;
    console.log(`[PUT /tables/${table}/${id}] changes=${changed}`);
    if (changed !== null && changed === 0) {
      return errRes('UPDATE had no effect (changes=0). Record may not exist.', 500);
    }

    return jsonRes({ ...body, id, created_at: existing.created_at, updated_at: now });
  } catch (e) {
    return errRes('Database UPDATE error: ' + e.message, 500, e.stack || '');
  }
}

// ============================================================
// PATCH /tables/:table/:id  ─ 部分更新
// ============================================================
export async function onRequestPatch({ params, request, env }) {
  const { table, id } = params;
  if (!isValidTable(table)) return errRes('Invalid table name', 400);
  if (!env.DB)              return errRes('D1 binding "DB" is not configured.', 500);

  let body;
  try   { body = await readBody(request); }
  catch (e) { return errRes('Invalid request body: ' + e.message, 400); }

  const now = Date.now();

  try {
    const existing = await env.DB
      .prepare(`SELECT id, created_at, data FROM "${table}" WHERE id=? AND deleted=0`)
      .bind(id).first();
    if (!existing) return errRes('Record not found', 404);

    let existingData = {};
    try { existingData = JSON.parse(existing.data || '{}'); } catch (_) { /* ignore */ }

    const merged   = { ...existingData, ...body, id };
    const dataJson = JSON.stringify(merged);
    const result   = await env.DB
      .prepare(`UPDATE "${table}" SET data=?, updated_at=? WHERE id=? AND deleted=0`)
      .bind(dataJson, now, id).run();

    const changed = result?.meta?.changes ?? result?.changes ?? null;
    console.log(`[PATCH /tables/${table}/${id}] changes=${changed}`);
    if (changed !== null && changed === 0) {
      return errRes('UPDATE had no effect (changes=0). Record may not exist.', 500);
    }

    return jsonRes({ ...merged, id, created_at: existing.created_at, updated_at: now });
  } catch (e) {
    return errRes('Database PATCH error: ' + e.message, 500, e.stack || '');
  }
}

// ============================================================
// DELETE /tables/:table/:id  ─ 論理削除（deleted = 1）
// ============================================================
export async function onRequestDelete({ params, env }) {
  const { table, id } = params;
  if (!isValidTable(table)) return errRes('Invalid table name', 400);
  if (!env.DB)              return errRes('D1 binding "DB" is not configured.', 500);

  const now = Date.now();

  try {
    const existing = await env.DB
      .prepare(`SELECT id FROM "${table}" WHERE id=? AND deleted=0`)
      .bind(id).first();
    if (!existing) return errRes('Record not found', 404);

    const result = await env.DB
      .prepare(`UPDATE "${table}" SET deleted=1, updated_at=? WHERE id=? AND deleted=0`)
      .bind(now, id).run();

    const changed = result?.meta?.changes ?? result?.changes ?? null;
    console.log(`[DELETE /tables/${table}/${id}] changes=${changed}`);
    if (changed !== null && changed === 0) {
      return errRes('DELETE had no effect (changes=0)', 500);
    }

    return new Response(null, { status: 204, headers: CORS });
  } catch (e) {
    return errRes('Database DELETE error: ' + e.message, 500, e.stack || '');
  }
}
