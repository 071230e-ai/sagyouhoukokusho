-- ============================================================
-- 作業報告書システム  D1 スキーマ初期化
-- database_name: sagyouhokokushosisutemu-db
--
-- 適用コマンド（既存データは絶対に消えません）:
--   npx wrangler d1 execute sagyouhokokushosisutemu-db --file=schema.sql
--
-- ★ すべて CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
--   → 既存テーブル・既存データに影響ゼロ
--   → --rebuild-db は絶対に使わないこと
--   → DROP TABLE / DELETE は一切使用していない
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 日報テーブル
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_reports (
  id          TEXT    NOT NULL PRIMARY KEY,
  data        TEXT    NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0,
  deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_dr_created_at ON daily_reports (created_at);
CREATE INDEX IF NOT EXISTS idx_dr_updated_at ON daily_reports (updated_at);

-- ────────────────────────────────────────────────────────────
-- ユーザーアカウントテーブル
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_accounts (
  id          TEXT    NOT NULL PRIMARY KEY,
  data        TEXT    NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0,
  deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ua_created_at ON user_accounts (created_at);
