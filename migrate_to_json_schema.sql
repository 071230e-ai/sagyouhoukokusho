-- ============================================================
-- 旧スキーマ（カラム別） → 新スキーマ（JSON data + deleted）への移行
-- ============================================================
-- 作業内容:
--   1. 旧テーブルを daily_reports_old / user_accounts_old にリネーム
--   2. 新スキーマでテーブルを再作成（schema.sql と同一）
--   3. user_accounts の既存1件を JSON 形式に変換して移行
--   4. 旧テーブルを削除
--
-- ★ daily_reports は 0 件のためデータ移行不要
-- ============================================================

-- ── 旧テーブルをリネーム（バックアップ） ───────────────────
ALTER TABLE daily_reports  RENAME TO daily_reports_old;
ALTER TABLE user_accounts  RENAME TO user_accounts_old;

-- ── 新スキーマでテーブル作成（schema.sql と同一） ────────────
CREATE TABLE IF NOT EXISTS daily_reports (
  id          TEXT    NOT NULL PRIMARY KEY,
  data        TEXT    NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0,
  deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_dr_created_at ON daily_reports (created_at);
CREATE INDEX IF NOT EXISTS idx_dr_updated_at ON daily_reports (updated_at);

CREATE TABLE IF NOT EXISTS user_accounts (
  id          TEXT    NOT NULL PRIMARY KEY,
  data        TEXT    NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0,
  deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ua_created_at ON user_accounts (created_at);

-- ── 既存 user_accounts データを JSON 形式に変換して移行 ─────
INSERT INTO user_accounts (id, data, created_at, updated_at, deleted)
SELECT
  id,
  json_object(
    'id',               id,
    'name',             name,
    'login_id',         login_id,
    'password_hash',    password_hash,
    'role',             role,
    'is_active',        is_active,
    'created_at_label', created_at_label
  ) AS data,
  CAST((julianday(created_at) - 2440587.5) * 86400000 AS INTEGER) AS created_at,
  CAST((julianday(updated_at) - 2440587.5) * 86400000 AS INTEGER) AS updated_at,
  0 AS deleted
FROM user_accounts_old;

-- ── 旧テーブルを削除 ───────────────────────────────────────
DROP TABLE daily_reports_old;
DROP TABLE user_accounts_old;
