/**
 * Cloudflare Pages Functions
 * /tables/:table  →  GET（一覧）/ POST（新規作成）
 *
 * D1 binding  : env.DB  (Variable name = "DB")
 * database    : sagyouhokokushosisutemu-db
 *
 * ★ テーブルは schema.sql で事前作成済み前提。
 *   DDL（CREATE TABLE / CREATE INDEX）は INSERT/SELECT と
 *   同一リクエスト内で混在させない。
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

/* ── ID 生成 ─────────────────────────────────────────────── */
const genId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);

// ============================================================
// OPTIONS  ─ CORS preflight
// ============================================================
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// ============================================================
// GET /tables/:table  ─ 一覧取得
// クエリパラメータ:
//   limit  : 取得件数 (default 1000, max 10000)
//   offset : オフセット (default 0)
//   sort   : 並び順 ('created_at' | 'updated_at') default 'created_at'
//   order  : 'asc' | 'desc' default 'desc'
// ============================================================
export async function onRequestGet({ params, request, env }) {
  const { table } = params;
  if (!isValidTable(table)) return errRes('Invalid table name', 400);
  if (!env.DB)              return errRes('D1 binding "DB" is not configured.', 500);

  const url    = new URL(request.url);
  let   limit  = parseInt(url.searchParams.get('limit')  || '1000', 10);
  let   offset = parseInt(url.searchParams.get('offset') || '0',    10);
  const sort   = url.searchParams.get('sort')  === 'updated_at' ? 'updated_at' : 'created_at';
  const order  = url.searchParams.get('order') === 'asc'        ? 'ASC'        : 'DESC';

  if (isNaN(limit)  || limit  < 1)     limit  = 1000;
  if (limit > 10000)                   limit  = 10000;
  if (isNaN(offset) || offset < 0)     offset = 0;

  try {
    const totalRes = await env.DB
      .prepare(`SELECT COUNT(*) AS c FROM "${table}" WHERE deleted=0`)
      .first();
    const total = totalRes?.c ?? 0;

    const rs = await env.DB
      .prepare(`SELECT * FROM "${table}" WHERE deleted=0 ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`)
      .bind(limit, offset).all();

    const data = (rs.results || []).map(rowToRecord);
    return jsonRes({ data, total, limit, offset, table });
  } catch (e) {
    return errRes('Database SELECT error: ' + e.message, 500, e.stack || '');
  }
}

// ============================================================
// POST /tables/:table  ─ 新規作成
// ============================================================
export async function onRequestPost({ params, request, env }) {
  const { table } = params;
  if (!isValidTable(table)) return errRes('Invalid table name', 400);
  if (!env.DB)              return errRes('D1 binding "DB" is not configured.', 500);

  let body;
  try   { body = await readBody(request); }
  catch (e) { return errRes('Invalid request body: ' + e.message, 400); }

  const id  = (body && typeof body.id === 'string' && body.id) ? body.id : genId();
  const now = Date.now();

  try {
    // 既存IDがあれば衝突回避（論理削除されたレコードも含めて確認）
    const existing = await env.DB
      .prepare(`SELECT id FROM "${table}" WHERE id=?`)
      .bind(id).first();
    if (existing) return errRes('Record with this id already exists', 409);

    const dataJson = JSON.stringify({ ...body, id });
    const result   = await env.DB
      .prepare(`INSERT INTO "${table}" (id, data, created_at, updated_at, deleted) VALUES (?, ?, ?, ?, 0)`)
      .bind(id, dataJson, now, now).run();

    const changed = result?.meta?.changes ?? result?.changes ?? null;
    console.log(`[POST /tables/${table}] id=${id} changes=${changed}`);
    if (changed !== null && changed === 0) {
      return errRes('INSERT had no effect (changes=0).', 500);
    }

    return jsonRes({ ...body, id, created_at: now, updated_at: now }, 201);
  } catch (e) {
    return errRes('Database INSERT error: ' + e.message, 500, e.stack || '');
  }
}
