# 作業報告書システム — 村田鉄筋株式会社

紙の作業報告書をWeb上で入力・管理できるアプリです。

---

## 🌐 公開URL（Production）

- **本番URL**: https://sagyouhokokushosisutemu.pages.dev
- **最新デプロイURL**: https://f45a27fb.sagyouhokokushosisutemu.pages.dev
- **API ベースURL**: https://sagyouhokokushosisutemu.pages.dev/tables

---

## 🔑 ログイン情報

### 一般ユーザー（静的アカウント）
| 氏名 | ログインID | パスワード |
|------|-----------|-----------|
| 村田和志 | murata_kazushi | 1111 |

> 一般ユーザーは自分の日報のみ閲覧・作成・編集・削除できます。

### 管理者
- パスワード: `muratanippou`
- 全員の日報閲覧・編集・削除、PDF一括DL、日報一括削除、**ユーザー管理** が可能

---

## ✅ 実装済み機能

### 日報機能
- 報告書の新規作成、一覧表示（カード形式・日付降順）、詳細表示、編集・削除
- キーワード検索（現場名・職長・記入者）、曜日自動表示
- チェック項目（7項目〇×）、体調・変更有無・応援有無の選択
- KY活動テーマ、一口メモ、応援会社・人数入力
- `owner_id` による権限管理: 一般ユーザーは自分の日報のみ操作可能

### 管理者専用機能
- PDF一括ダウンロード（現場名・記入者・期間で絞り込み）
- 日報一括削除（確認チェック付き）
- ユーザー管理（新規追加・有効/無効切り替え、SHA-256ハッシュ化）

### スマホ対応（375px / 390px / 430px / 768px）
- ヘッダー: 上段（ロゴ・ユーザー情報）＋ 下段（ナビボタン 2列グリッド）
- iOS自動ズーム防止、tap可能保証

---

## 🌐 機能エントリーURI（API）

| Method | パス | 説明 |
|--------|-----|------|
| GET | `/` | メインページ（index.html） |
| GET | `/tables/:table` | 一覧取得（`?limit=&offset=&sort=&order=`） |
| POST | `/tables/:table` | 新規作成（JSONボディ） |
| GET | `/tables/:table/:id` | 単件取得 |
| PUT | `/tables/:table/:id` | 全フィールド更新 |
| PATCH | `/tables/:table/:id` | 部分更新 |
| DELETE | `/tables/:table/:id` | 論理削除（deleted=1） |

`:table` は `daily_reports` または `user_accounts`。

---

## 🗄️ データアーキテクチャ

### ストレージサービス
- **Cloudflare D1**（SQLite ベースのエッジ DB）
  - データベース名: `sagyouhokokushosisutemu-db`
  - データベースID: `7ae8e64b-1ae8-4677-97a4-a1b7bd4ed8ab`

### データモデル（汎用 JSON 形式）
両テーブルとも以下の構造で、`data` カラムに JSON として全フィールドを格納:
```sql
CREATE TABLE <table_name> (
  id          TEXT    NOT NULL PRIMARY KEY,
  data        TEXT    NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0,
  deleted     INTEGER NOT NULL DEFAULT 0
);
```

#### `daily_reports`（日報）
JSON 内の主要フィールド: `id`, `report_date`, `site_name`, `foreman`, `worker_names`, `worker_count`, `recorder`, `owner_id`, `check_*`（7項目）, `health`, `change_note`, `support`, `work_content`, `ky_theme_*`, `memo` ほか

#### `user_accounts`（ユーザー）
JSON 内の主要フィールド: `id`, `name`, `login_id`, `password_hash`(SHA-256), `role`, `is_active`, `created_at_label`

### データフロー
1. フロントエンド (`js/app.js`) → fetch で `/tables/*` を呼び出し
2. Cloudflare Pages Functions (`functions/tables/*`) が D1 にアクセス
3. レコードの `data` カラム（JSON）を展開し、`{...data, id, created_at, updated_at}` で返却

---

## 📁 ファイル構成

```
/home/user/webapp/
├── index.html                          メインページ
├── css/style.css                       スタイルシート
├── js/
│   ├── app.js                          メインロジック・認証・CRUD
│   └── pdf.js                          PDF一括ダウンロード
├── functions/
│   └── tables/
│       ├── [table].js                  GET一覧 / POST新規作成
│       └── [table]/
│           └── [id].js                 GET単件 / PUT / PATCH / DELETE
├── schema.sql                          D1テーブル初期化SQL
├── migrate_to_json_schema.sql          旧→新スキーマ移行用（初回のみ）
├── wrangler.jsonc                      Cloudflare設定（D1 binding）
├── package.json
├── ecosystem.config.cjs                PM2 設定（ローカル開発用）
└── README.md
```

---

## 👤 ユーザーガイド

1. https://sagyouhokokushosisutemu.pages.dev にアクセス
2. ログインタブで **一般ユーザー / 管理者** を選択
3. 一般ユーザー: 上記の表のID/PWでログイン → 自分の日報を作成・編集
4. 管理者: パスワード `muratanippou` でログイン → 全日報管理・PDF出力・ユーザー管理

---

## 🛠️ 開発・運用コマンド

### ローカル開発
```bash
# ポートクリーンアップ → PM2でローカル起動 → 動作確認
cd /home/user/webapp
fuser -k 3000/tcp 2>/dev/null || true
pm2 start ecosystem.config.cjs
curl http://localhost:3000

# ローカルD1にスキーマ適用
npm run db:migrate:local
```

### 本番デプロイ
```bash
cd /home/user/webapp
npx wrangler pages deploy . --project-name sagyouhokokushosisutemu --branch main
```

### D1 操作
```bash
# 本番D1にスキーマ適用（IF NOT EXISTSのため安全）
npm run db:migrate:prod

# D1コンソール
npm run db:console:local
npm run db:console:prod
```

---

## 🚧 未実装 / 次のステップ

- [ ] レスポンシブ動作の更なる改善（タブレット 768px 以上）
- [ ] 日報の CSV エクスポート機能
- [ ] 写真添付機能（Cloudflare R2 連携）
- [ ] パスワードリセット機能
- [ ] 監査ログ（誰がいつ何を編集したか）
- [ ] カスタムドメイン設定

---

## 📦 デプロイステータス

- **プラットフォーム**: Cloudflare Pages
- **ステータス**: ✅ Active
- **テックスタック**: Vanilla HTML/CSS/JS + Cloudflare Pages Functions + D1 (SQLite)
- **最終更新**: 2026-05-02
