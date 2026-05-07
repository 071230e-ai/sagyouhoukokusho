/* ===========================
   村田鉄筋株式会社 作業報告書 - app.js
=========================== */
console.log('[app.js] loaded v2');

/* ===========================
   認証・権限管理
=========================== */
const ADMIN_PASSWORD = 'muratanippou';
const SESSION_KEY    = 'murata_auth';
const USER_TABLE     = 'user_accounts'; // DBユーザー管理テーブル
// auth = { role: 'admin' | 'user', id: string, name: string, db_id: string }

// ============================================================
// ★ 一般アカウントは Cloudflare D1 (`user_accounts`) を
//   唯一の真実源 (Single Source of Truth) として管理する。
//   ローカル固定配列・localStorage には一切持たない。
//
// 初回起動時に DB にレコードが1件もない場合のみ、
// 村田和志アカウントを seed として自動投入する
// （この処理は ensureSeedAccount() で行う）。
// ============================================================
const SEED_ACCOUNT = {
  login_id: 'murata_kazushi',
  name:     '村田和志',
  password: '1111',
};

// ============================================================
// fetch 共通ユーティリティ
//   - 末尾に cache-buster (_t=...) を付与し、CDN/ブラウザの
//     古い結果を返さないようにする
//   - 同時に Cache-Control: no-cache を明示
// ============================================================
function _withCacheBuster(url) {
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + '_t=' + Date.now();
}
async function apiFetch(url, options = {}) {
  const finalUrl = _withCacheBuster(url);
  const headers  = Object.assign(
    { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
    options.headers || {}
  );
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(finalUrl, { ...options, headers, cache: 'no-store' });
}

// is_active の判定: DB から戻ってくる値は boolean (true/false) または
// integer (1/0) の両方ありうる。明示的に「無効=false/0」と判定する。
function isUserActive(u) {
  if (!u) return false;
  const v = u.is_active;
  if (v === undefined || v === null) return true; // 既定は有効
  if (v === false || v === 0 || v === '0' || v === 'false') return false;
  return true;
}

// セッションから認証情報を取得
function getAuth() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function isAdmin() { const a = getAuth(); return a && a.role === 'admin'; }
function isLoggedIn() { return !!getAuth(); }

// ログイン後の共通処理
function enterApp() {
  const loginScreen = document.getElementById('login-screen');
  const appWrapper  = document.getElementById('app-wrapper');
  if (loginScreen) loginScreen.classList.add('fade-out');
  setTimeout(() => {
    if (loginScreen) loginScreen.style.display = 'none';
    if (appWrapper)  appWrapper.style.display  = 'block';
    updateHeaderUser();
    // ログイン完了後、権限に応じて一覧を再読み込み
    // ※ loadReports が失敗してもログイン画面には戻らない
    try { loadReports(); } catch(e) { console.warn('loadReports 初回エラー:', e); }
  }, 400);
}

// ヘッダーのユーザー情報を更新
function updateHeaderUser() {
  const auth          = getAuth();
  if (!auth) return;
  const badge         = document.getElementById('header-user-badge');
  const name          = document.getElementById('header-user-name');
  const pdfBtn        = document.getElementById('btn-pdf-download');
  const bulkDeleteBtn = document.getElementById('btn-bulk-delete');
  const usersBtn      = document.getElementById('btn-users');

  if (auth.role === 'admin') {
    badge.textContent = '管理者';
    badge.className   = 'header-user-badge admin';
    name.textContent  = '';
    // 管理者のみ表示するボタン
    if (pdfBtn)        pdfBtn.style.display        = 'inline-flex';
    if (bulkDeleteBtn) bulkDeleteBtn.style.display = 'inline-flex';
    if (usersBtn)      usersBtn.style.display      = 'inline-flex';
  } else {
    badge.textContent = '一般';
    badge.className   = 'header-user-badge user';
    name.textContent  = auth.name;
    // 一般ユーザーには非表示
    if (pdfBtn)        pdfBtn.style.display        = 'none';
    if (bulkDeleteBtn) bulkDeleteBtn.style.display = 'none';
    if (usersBtn)      usersBtn.style.display      = 'none';
  }
}

// ログアウト
function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  location.reload();
}

// ログインタブ切り替え
function switchLoginTab(tab) {
  document.getElementById('tab-user').classList.toggle('active',  tab === 'user');
  document.getElementById('tab-admin').classList.toggle('active', tab === 'admin');
  document.getElementById('form-user').style.display  = tab === 'user'  ? 'flex' : 'none';
  document.getElementById('form-admin').style.display = tab === 'admin' ? 'flex' : 'none';
  // フォームリセット
  document.getElementById('user-error').style.display  = 'none';
  document.getElementById('login-error').style.display = 'none';
  if (tab === 'user')  { const b = document.getElementById('user-select-btn'); if (b) b.focus(); }
  if (tab === 'admin') document.getElementById('password-input').focus();
}

// 一般ユーザーログイン（ユーザー選択 + 個人パスワード）
async function loginAsUser(event) {
  event.preventDefault();

  // ===== userId の取得: カスタムピッカー hidden input → fallback select の順で取得 =====
  const customVal   = (document.getElementById('user-account-select')?.value   || '').trim();
  const fallbackVal = (document.getElementById('user-account-select-fallback')?.value || '').trim();
  const userId = customVal || fallbackVal;

  const pw       = (document.getElementById('user-password-input')?.value || '').trim();
  const errorEl  = document.getElementById('user-error');
  const loginBtn = document.querySelector('#form-user .login-btn');

  // デバッグログ（パスワード本文は出力しない）
  console.log('[login] userId:', userId);
  console.log('[login] password length:', pw.length);

  // 未選択ガード
  if (!userId) {
    _showLoginError(errorEl, '氏名を選択してください');
    // カスタムボタンをシェイク
    const btnEl = document.getElementById('user-select-btn');
    if (btnEl) { btnEl.classList.add('shake'); setTimeout(() => btnEl.classList.remove('shake'), 500); }
    // fallbackをフォーカス
    const fbEl = document.getElementById('user-account-select-fallback');
    if (fbEl) fbEl.focus();
    return;
  }
  if (!pw) {
    _showLoginError(errorEl, 'パスワードを入力してください');
    document.getElementById('user-password-input')?.focus();
    return;
  }

  // ローディング表示
  if (loginBtn) { loginBtn.disabled = true; loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 確認中...'; }
  if (errorEl) errorEl.style.display = 'none';

  // =================================================================
  // ★ 認証は DB (user_accounts) のみで行う（Single Source of Truth）
  //   1. DB から最新の user_accounts を取得（キャッシュ無効化）
  //   2. login_id でレコードを検索
  //   3. is_active = false なら拒否
  //   4. password_hash を SHA-256 で照合
  // =================================================================

  // crypto.subtle が使えないとハッシュ照合できない（HTTPS必須）
  if (!window.crypto || !window.crypto.subtle) {
    console.error('crypto.subtle が使えません。HTTPS環境で開いてください。');
    _loginError(errorEl, loginBtn, 'この環境ではログインできません（HTTPS環境で開いてください）', false);
    return;
  }

  let dbUsers = [];
  try {
    const res  = await apiFetch(`/tables/${USER_TABLE}?limit=500`);
    const json = await res.json();
    dbUsers = json.data || [];
  } catch (fetchErr) {
    console.error('DBユーザー取得失敗:', fetchErr);
    _loginError(errorEl, loginBtn, 'サーバーに接続できません。時間を置いて再度お試しください。', false);
    return;
  }

  const dbUser = dbUsers.find(u => u.login_id === userId);
  if (!dbUser) {
    _loginError(errorEl, loginBtn, 'IDまたはパスワードが違います');
    return;
  }

  if (!isUserActive(dbUser)) {
    _loginError(errorEl, loginBtn, 'このアカウントは無効化されています。管理者にお問い合わせください。', false);
    return;
  }

  try {
    const pwHash = await sha256(pw);
    if (dbUser.password_hash !== pwHash) {
      _loginError(errorEl, loginBtn, 'パスワードが違います');
      return;
    }
  } catch (hashErr) {
    console.error('SHA-256ハッシュ計算失敗:', hashErr);
    _loginError(errorEl, loginBtn, 'IDまたはパスワードが違います');
    return;
  }

  // ログイン成功
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    role:  'user',
    id:    dbUser.login_id,  // owner_id 用（既存日報の互換性のため login_id を使用）
    name:  dbUser.name,
    db_id: dbUser.id,
  }));
  enterApp();
}

// エラーメッセージ表示（ボタン状態変更なし）
function _showLoginError(errorEl, msg) {
  if (!errorEl) return;
  errorEl.textContent = msg;
  errorEl.style.display = 'flex';
}

// ログインエラー表示ヘルパー
function _loginError(errorEl, loginBtn, msg, shakePw = true) {
  errorEl.textContent = msg;
  errorEl.style.display = 'flex';
  if (loginBtn) { loginBtn.disabled = false; loginBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> ログイン'; }
  if (shakePw) {
    const pwEl = document.getElementById('user-password-input');
    if (pwEl) {
      pwEl.value = '';
      pwEl.classList.add('shake');
      setTimeout(() => pwEl.classList.remove('shake'), 500);
      pwEl.focus();
    }
  }
}

// 管理者ログイン（パスワード）
function loginAsAdmin(event) {
  event.preventDefault();
  const pw      = document.getElementById('password-input').value;
  const errorEl = document.getElementById('login-error');
  if (pw === ADMIN_PASSWORD) {
    errorEl.style.display = 'none';
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role: 'admin', name: '管理者' }));
    enterApp();
  } else {
    errorEl.style.display = 'flex';
    const pwInput = document.getElementById('password-input');
    pwInput.value = '';
    pwInput.classList.add('shake');
    setTimeout(() => pwInput.classList.remove('shake'), 500);
    pwInput.focus();
  }
}

function togglePasswordVisibility() {
  const input = document.getElementById('password-input');
  const icon  = document.getElementById('pw-eye-icon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'fa-solid fa-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'fa-solid fa-eye';
  }
}

function toggleUserPasswordVisibility() {
  const input = document.getElementById('user-password-input');
  const icon  = document.getElementById('user-pw-eye-icon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'fa-solid fa-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'fa-solid fa-eye';
  }
}

// ユーザーピッカーに表示するアカウント一覧（キャッシュ）
let _pickerAccounts = [];

// ============================================================
// 初回ブートストラップ:
// DB にユーザーが1件もない場合のみ村田和志アカウントを投入する。
// （既に存在する環境では何もしない）
// ============================================================
let _seedChecked = false;
async function ensureSeedAccount() {
  if (_seedChecked) return;
  _seedChecked = true;
  try {
    const res  = await apiFetch(`/tables/${USER_TABLE}?limit=1`);
    const json = await res.json();
    const total = json.total ?? (json.data || []).length;
    if (total > 0) return; // 既にアカウントがあるなら何もしない

    // crypto.subtle が使えない環境では seed しない（HTTPSが必要）
    if (!window.crypto || !window.crypto.subtle) return;

    const pwHash = await sha256(SEED_ACCOUNT.password);
    const now = new Date();
    const label = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;
    await apiFetch(`/tables/${USER_TABLE}`, {
      method: 'POST',
      body: JSON.stringify({
        name:             SEED_ACCOUNT.name,
        login_id:         SEED_ACCOUNT.login_id,
        password_hash:    pwHash,
        role:             'user',
        is_active:        true,
        created_at_label: '（初期設定）',
      }),
    });
    console.log('[seed] 初期アカウントを投入しました:', SEED_ACCOUNT.login_id);
  } catch (e) {
    console.warn('[seed] 初期アカウント投入チェック失敗:', e);
  }
}

async function initAuth() {
  // ★ 起動時に 1度だけ、DBが空なら初期アカウントを投入
  await ensureSeedAccount();

  // カスタムユーザーピッカーの候補を構築（DBのみから取得）
  await buildUserPicker();

  if (isLoggedIn()) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-wrapper').style.display  = 'block';
    updateHeaderUser();
  }
}

// ===================================================
// カスタムユーザーピッカー
// ===================================================

// ============================================================
// 候補リストを構築 ─ ★ DB (user_accounts) のみから取得
//   - is_active = false / 0 のユーザーは除外
//   - 削除済み（deleted=1）は API 側で既にフィルタされて返らない
//   - 一覧表示順は氏名の50音順（読みやすさ重視）
//   - PC向けカスタムピッカー(#user-picker-list)とスマホ向けネイティブ
//     <select id="user-account-select-fallback"> の両方を同じデータで同期する
// ============================================================
async function buildUserPicker() {
  const listEl       = document.getElementById('user-picker-list');
  const fallbackSel  = document.getElementById('user-account-select-fallback');
  if (!listEl && !fallbackSel) return;

  // ローディング表示（カスタムピッカー）
  if (listEl) {
    listEl.innerHTML = '<div class="user-picker-empty"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中...</div>';
  }

  try {
    const res  = await apiFetch(`/tables/${USER_TABLE}?limit=500`);
    const json = await res.json();
    const dbUsers = (json.data || [])
      .filter(u => isUserActive(u))
      .filter(u => u.login_id);

    // 氏名の50音順
    dbUsers.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));

    _pickerAccounts = dbUsers.map(u => ({
      id:     u.login_id,
      name:   u.name,
      source: 'db',
    }));

    // ── PC向けカスタムピッカーを描画 ─────────────────────
    if (listEl) renderPickerList(listEl);

    // ── スマホ向けネイティブ <select> を再構築（同じデータ） ──
    if (fallbackSel) renderFallbackSelect(fallbackSel);

    console.log(`[buildUserPicker] DBから ${dbUsers.length} 件のユーザーを読み込みました`);
  } catch (e) {
    console.error('ユーザー一覧取得失敗:', e);
    _pickerAccounts = [];
    if (listEl) {
      listEl.innerHTML = '<div class="user-picker-empty">ユーザー一覧の取得に失敗しました</div>';
    }
    if (fallbackSel) {
      // フォールバックは placeholder のみ
      fallbackSel.innerHTML = '<option value="">ユーザー一覧の取得に失敗しました</option>';
    }
  }
}

// スマホ向けネイティブ <select> を _pickerAccounts から再構築
function renderFallbackSelect(selectEl) {
  if (!selectEl) return;
  // 現在の選択値を保持して再構築後に復元
  const prevValue = selectEl.value;
  const opts = ['<option value="">氏名を選択してください</option>'];
  for (const u of _pickerAccounts) {
    opts.push(
      `<option value="${escHtml(u.id)}">${escHtml(u.name)}</option>`
    );
  }
  selectEl.innerHTML = opts.join('');
  // 元の選択がまだリストにあれば復元（無ければ未選択）
  if (prevValue && _pickerAccounts.some(u => u.id === prevValue)) {
    selectEl.value = prevValue;
  } else {
    selectEl.value = '';
  }
}

// ピッカーのリスト項目をレンダリング
function renderPickerList(listEl) {
  if (!listEl) return;
  if (_pickerAccounts.length === 0) {
    listEl.innerHTML = '<div class="user-picker-empty">ユーザーが登録されていません</div>';
    return;
  }
  listEl.innerHTML = _pickerAccounts.map(u => `
    <button type="button" class="user-picker-item" role="option"
            data-id="${escHtml(u.id)}" data-name="${escHtml(u.name)}"
            onclick="selectUserFromPicker(this)">
      <i class="fa-solid fa-user user-picker-item-icon"></i>
      <span>${escHtml(u.name)}</span>
    </button>
  `).join('');

  // pointerup リスナーを追加（iOS Safari の onclick 遅延を回避）
  listEl.querySelectorAll('.user-picker-item').forEach(btn => {
    btn.addEventListener('pointerup', function(e) {
      e.preventDefault();
      e.stopPropagation();
      selectUserFromPicker(this);
    });
  });
}

// ピッカーを開く
function openUserPicker() {
  const panel    = document.getElementById('user-picker-panel');
  const backdrop = document.getElementById('user-picker-backdrop');
  const btn      = document.getElementById('user-select-btn');
  if (!panel || !backdrop) return;

  panel.classList.add('open');
  backdrop.classList.add('open');
  if (btn) btn.setAttribute('aria-expanded', 'true');

  // 現在選択中の項目にフォーカスクラス付与
  const hiddenInput = document.getElementById('user-account-select');
  const currentId = hiddenInput ? hiddenInput.value : '';
  panel.querySelectorAll('.user-picker-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === currentId);
  });
}

// ピッカーを閉じる
function closeUserPicker() {
  const panel    = document.getElementById('user-picker-panel');
  const backdrop = document.getElementById('user-picker-backdrop');
  const btn      = document.getElementById('user-select-btn');
  if (!panel || !backdrop) return;
  panel.classList.remove('open');
  backdrop.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

// 候補をタップ／クリックして選択（重複発火防止付き）
let _pickerSelectLock = false;
function selectUserFromPicker(itemEl) {
  if (_pickerSelectLock) return;
  _pickerSelectLock = true;
  setTimeout(() => { _pickerSelectLock = false; }, 300);

  const id   = itemEl.dataset.id;
  const name = itemEl.dataset.name;
  if (!id || !name) return;

  // hidden input に値を保存
  const hiddenInput = document.getElementById('user-account-select');
  if (hiddenInput) hiddenInput.value = id;

  // フォールバックselectも同期
  const fallbackSelect = document.getElementById('user-account-select-fallback');
  if (fallbackSelect) fallbackSelect.value = id;

  // ボタンのラベルを更新
  const label = document.getElementById('user-select-label');
  if (label) {
    label.textContent = name;
    label.classList.add('selected');
  }

  // ピッカーを閉じる
  closeUserPicker();

  // エラー表示をリセット
  const errEl = document.getElementById('user-error');
  if (errEl) errEl.style.display = 'none';

  // パスワード欄にフォーカス
  setTimeout(() => {
    const pwEl = document.getElementById('user-password-input');
    if (pwEl) pwEl.focus();
  }, 150);
}

const TABLE = 'daily_reports';
const PAGE_SIZE = 10;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const state = {
  reports: [],
  filteredReports: [],
  currentPage: 1,
  currentReportId: null,
  isEditing: false,
};

/* ===========================
   初期化
=========================== */
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  setTodayDate();
  // ログイン済みの場合のみ一覧を読み込む（未ログイン時は読み込まない）
  if (isLoggedIn()) {
    loadReports();
  }

  // ===== フォールバックselect → hidden input / カスタムボタンを同期 =====
  const fallbackSelect = document.getElementById('user-account-select-fallback');
  if (fallbackSelect) {
    fallbackSelect.addEventListener('change', function() {
      const id = this.value;
      // hidden input を更新
      const hiddenInput = document.getElementById('user-account-select');
      if (hiddenInput) hiddenInput.value = id;
      // カスタムボタンのラベルを更新
      const account = _pickerAccounts.find(u => u.id === id);
      const label = document.getElementById('user-select-label');
      if (label) {
        if (id && account) {
          label.textContent = account.name;
          label.classList.add('selected');
        } else {
          label.textContent = '氏名を選択してください';
          label.classList.remove('selected');
        }
      }
      // エラーをリセット
      const errEl = document.getElementById('user-error');
      if (errEl) errEl.style.display = 'none';
    });
  }

  // ===== モバイル向け: ユーザーピッカーの pointerup リスナー =====
  const userSelectBtn = document.getElementById('user-select-btn');
  if (userSelectBtn) {
    userSelectBtn.addEventListener('pointerup', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const panel = document.getElementById('user-picker-panel');
      if (panel && panel.classList.contains('open')) {
        closeUserPicker();
      } else {
        openUserPicker();
      }
    });
  }

  // backdrop: pointerup で閉じる
  const pickerBackdrop = document.getElementById('user-picker-backdrop');
  if (pickerBackdrop) {
    pickerBackdrop.addEventListener('pointerup', function(e) {
      e.preventDefault();
      e.stopPropagation();
      closeUserPicker();
    });
  }
});

function setTodayDate() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm   = String(today.getMonth() + 1).padStart(2, '0');
  const dd   = String(today.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const dateInput = document.getElementById('report-date');
  if (dateInput) {
    dateInput.value = dateStr;
    updateDayLabel(dateStr);
    dateInput.addEventListener('change', () => updateDayLabel(dateInput.value));
  }
}

function updateDayLabel(dateStr) {
  const label = document.getElementById('day-label');
  if (!label || !dateStr) return;
  const d = new Date(dateStr + 'T00:00:00');
  label.textContent = WEEKDAYS[d.getDay()] + '曜日';
}

/* ===========================
   ビュー切り替え
=========================== */
function showView(viewName) {
  // ユーザー管理画面は管理者のみアクセス可能
  if (viewName === 'users' && !isAdmin()) {
    showToast('管理者のみアクセスできます', 'error');
    showView('list');
    return;
  }

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  document.getElementById(`view-${viewName}`).classList.add('active');

  if (viewName === 'list') {
    document.getElementById('btn-list').classList.add('active');
    loadReports();
  } else if (viewName === 'form') {
    document.getElementById('btn-new').classList.add('active');
    if (!state.isEditing) resetForm();
  } else if (viewName === 'users') {
    const btn = document.getElementById('btn-users');
    if (btn) btn.classList.add('active');
    loadUsers();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ===========================
   応援人数トグル
=========================== */
function toggleSupportCount(show) {
  const el = document.getElementById('support-count');
  if (el) el.style.display = show ? 'flex' : 'none';
}

/* ===========================
   フォームリセット
=========================== */
function resetForm() {
  state.isEditing = false;
  state.currentReportId = null;

  document.getElementById('edit-id').value = '';
  document.getElementById('form-title').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> 新規作成';
  document.getElementById('submit-btn').innerHTML = '<i class="fa-solid fa-paper-plane"></i> 報告書を提出する';

  setTodayDate();
  ['site-name','foreman','worker-names','recorder','work-content','ky-theme-danger','ky-theme-action','memo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  // 一般ユーザーは記入者欄をログインユーザー名で自動入力してロック
  const auth = getAuth();
  const recorderEl = document.getElementById('recorder');
  if (recorderEl) {
    if (auth && auth.role === 'user') {
      recorderEl.value    = auth.name;
      recorderEl.readOnly = true;
      recorderEl.style.background = '#f0f3f8';
      recorderEl.style.color      = 'var(--text-secondary)';
    } else {
      // 管理者・未ログインはロック解除
      recorderEl.readOnly = false;
      recorderEl.style.background = '';
      recorderEl.style.color      = '';
    }
  }
  const wc = document.getElementById('worker-count');
  if (wc) wc.value = '';
  const c1 = document.getElementById('support-company1');
  const c2 = document.getElementById('support-company2');
  const r1 = document.getElementById('support-rebar1');
  const r2 = document.getElementById('support-rebar2');
  if (c1) c1.value = '';
  if (c2) c2.value = '';
  if (r1) r1.value = '';
  if (r2) r2.value = '';

  document.querySelectorAll('input[type="radio"]').forEach(r => r.checked = false);
  toggleSupportCount(false);

  // 勤務区分を初期値「出勤」に戻す
  const ws = document.getElementById('work-status');
  if (ws) ws.value = 'work';
  applyWorkStatusUI('work');
}

/* ===========================
   勤務区分（出勤／休み）UI制御
=========================== */
// 勤務区分セレクター変更時のイベントハンドラ（HTMLからonchangeで呼ばれる）
function onWorkStatusChange() {
  const workStatus = document.getElementById('work-status')?.value || 'work';
  applyWorkStatusUI(workStatus);
}

// 勤務区分に応じてフォーム入力欄の必須属性 / 視覚をトグルする。
// 「休み」のときは required を外し、ブラウザのHTML5検証で送信が止まらないようにする。
//
// 念のためフォームには novalidate を付けているが、二重対策として
// JS側でも required を除去する（出勤に戻したときは元に戻す）。
function applyWorkStatusUI(status) {
  const isHoliday = (status === 'holiday');

  // テキスト系の必須欄
  const textRequiredIds = ['site-name', 'foreman', 'worker-names', 'work-content', 'memo'];
  textRequiredIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (isHoliday) el.removeAttribute('required');
    else           el.setAttribute('required', 'required');
  });

  // ラジオ系の必須欄（チェック項目・体調・加工帳・応援）
  // これらにも required が付いており、HTML5検証で送信が止まる可能性があるため
  // 休み時は必ず外し、出勤時は戻す。
  const radioNames = [
    'check_greeting', 'check_ky', 'check_foreman_support', 'check_foreman_ability',
    'check_meeting', 'check_cleanup', 'check_tools',
    'health', 'change_note', 'support'
  ];
  radioNames.forEach(name => {
    document.querySelectorAll(`input[type="radio"][name="${name}"]`).forEach(el => {
      if (isHoliday) el.removeAttribute('required');
      else           el.setAttribute('required', 'required');
    });
  });

  // 視覚的に「休み」中であることを示すクラスを付与
  const ws = document.getElementById('work-status');
  if (ws) ws.classList.toggle('is-holiday', isHoliday);

  const sheet = document.querySelector('.form-sheet');
  if (sheet) sheet.classList.toggle('is-holiday', isHoliday);
}

/* ===========================
   フォームデータ取得
=========================== */
function getFormData() {
  const getRadio = name => {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : '';
  };

  const auth = getAuth();

  // 一般ユーザーは recorder をログインユーザー名で固定（自由入力不可）
  const recorderValue = (auth && auth.role === 'user')
    ? auth.name
    : (document.getElementById('recorder')?.value.trim() || '');

  // 勤務区分（出勤=work／休み=holiday）。
  // 既存の保存値が空（"" / null / undefined）の場合は後方互換で "work" として扱う。
  const workStatusRaw = document.getElementById('work-status')?.value || 'work';
  const workStatus = (workStatusRaw === 'holiday') ? 'holiday' : 'work';

  return {
    owner_id:              (auth && auth.role === 'user') ? auth.id : '',
    report_date:           document.getElementById('report-date')?.value || '',
    work_status:           workStatus,
    site_name:             document.getElementById('site-name')?.value.trim() || '',
    foreman:               document.getElementById('foreman')?.value.trim() || '',
    worker_names:          document.getElementById('worker-names')?.value.trim() || '',
    worker_count:          parseInt(document.getElementById('worker-count')?.value || '0', 10),
    recorder:              recorderValue,
    check_greeting:        getRadio('check_greeting'),
    check_ky:              getRadio('check_ky'),
    check_foreman_support: getRadio('check_foreman_support'),
    check_foreman_ability: getRadio('check_foreman_ability'),
    check_meeting:         getRadio('check_meeting'),
    check_cleanup:         getRadio('check_cleanup'),
    check_tools:           getRadio('check_tools'),
    health:                getRadio('health'),
    change_note:           getRadio('change_note'),
    support:               getRadio('support'),
    support_company1:      document.getElementById('support-company1')?.value.trim() || '',
    support_rebar1_count:  parseInt(document.getElementById('support-rebar1')?.value || '0', 10),
    support_company2:      document.getElementById('support-company2')?.value.trim() || '',
    support_rebar2_count:  parseInt(document.getElementById('support-rebar2')?.value || '0', 10),
    work_content:          document.getElementById('work-content')?.value.trim() || '',
    ky_theme_danger:       document.getElementById('ky-theme-danger')?.value.trim() || '',
    ky_theme_action:       document.getElementById('ky-theme-action')?.value.trim() || '',
    memo:                  document.getElementById('memo')?.value.trim() || '',
  };
}

/* ===========================
   報告書の提出（作成・更新）
=========================== */
async function submitReport(event) {
  event.preventDefault();

  const data = getFormData();

  // ── 共通バリデーション（出勤・休みどちらも必須） ──
  if (!data.report_date) { showToast('日付を入力してください', 'error'); return; }
  if (!data.recorder)    { showToast('記入者名を入力してください', 'error'); return; }

  // ── 「休み」の場合は他の入力チェックをすべてスキップして保存可能 ──
  // （現場名・作業内容・人数・応援・材料・備考などすべて空欄でOK）
  if (data.work_status === 'holiday') {
    // 休み時は不要な値をリセットして保存（混在データ防止）
    data.site_name             = '';
    data.foreman               = '';
    data.worker_names          = '';
    data.worker_count          = 0;
    data.work_content          = '';
    data.ky_theme_danger       = '';
    data.ky_theme_action       = '';
    data.memo                  = '';
    data.support               = '';
    data.support_company1      = '';
    data.support_company2      = '';
    data.support_rebar1_count  = 0;
    data.support_rebar2_count  = 0;
    data.check_greeting        = '';
    data.check_ky              = '';
    data.check_foreman_support = '';
    data.check_foreman_ability = '';
    data.check_meeting         = '';
    data.check_cleanup         = '';
    data.check_tools           = '';
    data.health                = '';
    data.change_note           = '';
  } else {
    // ── 出勤の場合は従来通りの必須チェック ──
    if (!data.site_name)   { showToast('現場名を入力してください', 'error'); return; }
    if (!data.foreman)     { showToast('職長名を入力してください', 'error'); return; }
    if (!data.work_content){ showToast('作業内容を入力してください', 'error'); return; }
    if (!data.memo)        { showToast('一口メモを必ず記入してください', 'error'); return; }

    const checkFields = ['check_greeting','check_ky','check_foreman_support','check_foreman_ability','check_meeting','check_cleanup','check_tools'];
    for (const f of checkFields) {
      if (!data[f]) { showToast('チェック項目をすべて選択してください', 'error'); return; }
    }
    if (!data.health)       { showToast('体調を選択してください', 'error'); return; }
    if (!data.change_note)  { showToast('加工帳・ミスの有無を選択してください', 'error'); return; }
    if (!data.support)      { showToast('応援の有無を選択してください', 'error'); return; }
  }

  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 送信中...';

  try {
    let res;
    if (state.isEditing && state.currentReportId) {
      res = await fetch(`/tables/${TABLE}/${state.currentReportId}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      });
    } else {
      res = await fetch(`/tables/${TABLE}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      });
    }

    // ★ HTTPステータスを必ず確認する（2xx 以外は失敗）
    if (!res.ok) {
      let detail = '';
      try {
        const errJson = await res.json();
        detail = errJson.error || JSON.stringify(errJson);
      } catch { detail = `HTTP ${res.status}`; }
      console.error('保存APIエラー:', res.status, detail);
      showToast(`保存に失敗しました（${detail}）`, 'error');
      return;
    }

    if (state.isEditing) {
      showToast('報告書を更新しました ✅', 'success');
    } else {
      showToast('報告書を提出しました 🎉', 'success');
    }
    state.isEditing = false;
    showView('list');
  } catch (err) {
    console.error('保存例外:', err);
    showToast('保存に失敗しました。ネットワークを確認してください。', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 報告書を提出する';
  }
}

/* ===========================
   一覧の読み込み
=========================== */
async function loadReports() {
  // 未ログイン時は処理しない（セキュリティガード）
  if (!isLoggedIn()) return;

  const listEl = document.getElementById('report-list');
  listEl.innerHTML = `<div class="loading-state"><i class="fa-solid fa-spinner fa-spin"></i><p>読み込み中...</p></div>`;

  try {
    const res = await fetch(`/tables/${TABLE}?limit=500`);

    // ★ HTTPステータスを必ず確認する
    if (!res.ok) {
      let detail = '';
      try { const e = await res.json(); detail = e.error || `HTTP ${res.status}`; }
      catch { detail = `HTTP ${res.status}`; }
      console.error('一覧取得APIエラー:', res.status, detail);
      listEl.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><h3>読み込みエラー</h3><p>${detail}</p></div>`;
      return;
    }

    const data = await res.json();
    state.reports = (data.data || []).sort((a, b) => {
      if (b.report_date !== a.report_date) return b.report_date.localeCompare(a.report_date);
      return b.created_at - a.created_at;
    });
    state.currentPage = 1;
    filterReports();
  } catch (err) {
    console.error('一覧取得例外:', err);
    listEl.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><h3>読み込みエラー</h3><p>データの取得に失敗しました</p></div>`;
  }
}

/* ===========================
   フィルタリング
=========================== */
function filterReports() {
  const kw   = document.getElementById('search-input')?.value.trim().toLowerCase() || '';
  const auth = getAuth();

  state.filteredReports = state.reports.filter(r => {
    // 一般ユーザーは自分の owner_id が一致する日報のみ表示
    // owner_id が空の古い日報は一般ユーザーには非表示（管理者のみ確認可）
    if (auth && auth.role === 'user') {
      if ((r.owner_id || '') !== auth.id) return false;
    }
    // キーワード検索
    if (!kw) return true;
    return (
      (r.site_name || '').toLowerCase().includes(kw) ||
      (r.foreman   || '').toLowerCase().includes(kw) ||
      (r.recorder  || '').toLowerCase().includes(kw)
    );
  });
  state.currentPage = 1;
  renderReportList();
}

/* ===========================
   一覧レンダリング
=========================== */
function renderReportList() {
  const listEl = document.getElementById('report-list');

  if (state.filteredReports.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-file-circle-plus" style="color:var(--primary);"></i>
        <h3>報告書がまだありません</h3>
        <p>「新規作成」から最初の報告書を作成しましょう。</p>
        <button class="btn btn-primary" onclick="showView('form')">
          <i class="fa-solid fa-plus"></i> 新規作成
        </button>
      </div>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  const start     = (state.currentPage - 1) * PAGE_SIZE;
  const paginated = state.filteredReports.slice(start, start + PAGE_SIZE);
  listEl.innerHTML = paginated.map(r => renderCard(r)).join('');
  renderPagination();
}

function renderCard(r) {
  const dateStr = formatDate(r.report_date);
  const isHoliday = (r.work_status === 'holiday');
  const hasChange = !isHoliday && r.change_note === '有';
  const checkIssues = isHoliday ? 0 : ['check_greeting','check_ky','check_foreman_support',
    'check_foreman_ability','check_meeting','check_cleanup','check_tools']
    .filter(k => r[k] === '×').length;

  // 休みの場合は現場名欄に「休み」と表示し、他バッジは抑制
  const siteText = isHoliday
    ? '休み'
    : (r.site_name || '（現場名未記入）');

  return `
    <article class="report-card${isHoliday ? ' is-holiday' : ''}" onclick="showDetail('${r.id}')">
      <div class="rc-top">
        <span class="rc-date"><i class="fa-regular fa-calendar"></i>${escHtml(dateStr)}</span>
        <span class="rc-site">${escHtml(siteText)}</span>
        ${isHoliday ? `<span class="rc-tag holiday"><i class="fa-solid fa-mug-hot"></i> 休み</span>` : ''}
        ${hasChange ? `<span class="rc-tag danger"><i class="fa-solid fa-triangle-exclamation"></i> 変更あり</span>` : ''}
        ${checkIssues > 0 ? `<span class="rc-tag danger">×が${checkIssues}件</span>` : ''}
        ${(!isHoliday && r.support === '有') ? `<span class="rc-tag"><i class="fa-solid fa-users"></i> 応援あり</span>` : ''}
      </div>
      <div class="rc-mid">
        ${isHoliday
          ? `<span><i class="fa-solid fa-pen"></i> 記入者：${escHtml(r.recorder || '―')}</span>`
          : `<span><i class="fa-solid fa-user-tie"></i> 職長：${escHtml(r.foreman || '―')}</span>
             <span><i class="fa-solid fa-users"></i> ${r.worker_count || 0}名</span>
             <span><i class="fa-solid fa-pen"></i> 記入者：${escHtml(r.recorder || '―')}</span>
             <span>${healthBadgeInline(r.health)}</span>`}
      </div>
      <div class="rc-bottom">${escHtml(isHoliday ? '（休み）' : (r.work_content || ''))}</div>
    </article>`;
}

function healthBadgeInline(h) {
  const map = { '良好': '😊 良好', '普通': '😐 普通', '不調': '😔 不調' };
  return map[h] || h || '';
}


/* ===========================
   ページネーション
=========================== */
function renderPagination() {
  const total      = state.filteredReports.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const paginEl    = document.getElementById('pagination');

  if (totalPages <= 1) { paginEl.innerHTML = ''; return; }

  let html = `<button class="page-btn" onclick="changePage(${state.currentPage - 1})" ${state.currentPage === 1 ? 'disabled' : ''}>
    <i class="fa-solid fa-chevron-left"></i></button>`;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - state.currentPage) <= 1) {
      html += `<button class="page-btn ${i === state.currentPage ? 'active' : ''}" onclick="changePage(${i})">${i}</button>`;
    } else if (Math.abs(i - state.currentPage) === 2) {
      html += `<button class="page-btn" disabled>…</button>`;
    }
  }

  html += `<button class="page-btn" onclick="changePage(${state.currentPage + 1})" ${state.currentPage === totalPages ? 'disabled' : ''}>
    <i class="fa-solid fa-chevron-right"></i></button>`;

  paginEl.innerHTML = html;
}

function changePage(page) {
  const totalPages = Math.ceil(state.filteredReports.length / PAGE_SIZE);
  if (page < 1 || page > totalPages) return;
  state.currentPage = page;
  renderReportList();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ===========================
   詳細表示
=========================== */
async function showDetail(id) {
  state.currentReportId = id;

  try {
    const res = await fetch(`/tables/${TABLE}/${id}`);
    const r   = await res.json();

    // ========== 権限ガード ==========
    const auth = getAuth();
    // 一般ユーザーが他人の日報を開こうとした場合はブロック
    // owner_id が空の古い日報も一般ユーザーには非表示
    if (auth && auth.role === 'user' && (r.owner_id || '') !== auth.id) {
      showToast('他の人の日報は閲覧できません', 'error');
      showView('list');
      return;
    }
    // ================================

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-detail').classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    // 権限制御：一般ユーザーは自分の日報のみ編集・削除可能
    const canEdit = isAdmin() || (auth && auth.role === 'user' && (r.owner_id || '') === auth.id);
    document.getElementById('detail-edit-btn').style.display   = canEdit ? 'inline-flex' : 'none';
    document.getElementById('detail-delete-btn').style.display = canEdit ? 'inline-flex' : 'none';

    const dateStr = formatDate(r.report_date);
    const dow     = r.report_date ? WEEKDAYS[new Date(r.report_date + 'T00:00:00').getDay()] + '曜日' : '';
    const isHoliday = (r.work_status === 'holiday');
    const workStatusBadge = isHoliday
      ? '<span class="detail-holiday-banner"><i class="fa-solid fa-mug-hot"></i> 休み</span>'
      : '';

    const checks = [
      { label: 'あいさつは出来ていましたか？',             key: 'check_greeting'        },
      { label: 'KY活動は行いましたか？',                   key: 'check_ky'              },
      { label: '職長の指示は、的確になされていましたか？', key: 'check_foreman_support' },
      { label: '職長の方は、思うように指示を出せましたか？', key: 'check_foreman_ability' },
      { label: '打ち合わせはうまく進みましたか？',         key: 'check_meeting'         },
      { label: '現場の整理・整頓は終わりましたか？',       key: 'check_cleanup'         },
      { label: '道具類の片付けは終わりましたか？',         key: 'check_tools'           },
    ];

    const checkRows = checks.map(c => {
      const val = r[c.key] || '';
      const cls = val === '〇' ? 'maru' : val === '×' ? 'batsu' : '';
      return `
        <div class="detail-check-row">
          <div class="detail-check-q">${escHtml(c.label)}</div>
          <div class="detail-check-a">
            <span class="check-result ${cls}">${escHtml(val)}</span>
          </div>
        </div>`;
    }).join('');

    const healthClass = { '良好': 'health-good', '普通': 'health-normal', '不調': 'health-bad' }[r.health] || 'health-normal';
    const changeClass = r.change_note === '有' ? 'has' : 'none';
    const supportClass = r.support === '有' ? 'support-yes' : 'none';

    let supportDetail = '';
    if (r.support === '有') {
      const c1 = r.support_company1 || '―';
      const c2 = r.support_company2 || '―';
      supportDetail = `${escHtml(c1)} ${r.support_rebar1_count || 0}名 / ${escHtml(c2)} ${r.support_rebar2_count || 0}名`;
    }

    document.getElementById('detail-content').innerHTML = `
      <div class="detail-sheet">

        <!-- タイトル行 -->
        <div class="detail-title-row">
          <div class="detail-title-box">作　業　報　告　書</div>
          <div class="detail-company-box">
            <div class="detail-company-name">村田鉄筋株式会社</div>
            <div class="detail-date">${escHtml(dateStr)}　${escHtml(dow)}${workStatusBadge}</div>
          </div>
        </div>

        <!-- 現場名・職長 -->
        <div class="detail-row">
          <div class="detail-label-cell">現場名：</div>
          <div class="detail-value-cell">${escHtml(isHoliday ? '休み' : (r.site_name || ''))}</div>
          <div class="detail-label-cell narrow">職　長：</div>
          <div class="detail-value-cell">${escHtml(r.foreman || '')}</div>
        </div>

        <!-- 人員名・合計・記入者 -->
        <div class="detail-row">
          <div class="detail-label-cell">人員名：</div>
          <div class="detail-value-cell">${escHtml(r.worker_names || '')}</div>
          <div class="detail-label-cell narrow" style="white-space:nowrap;">合計</div>
          <div class="detail-value-cell" style="max-width:80px;">${r.worker_count || 0}名</div>
          <div class="detail-label-cell narrow">記入者：</div>
          <div class="detail-value-cell">${escHtml(r.recorder || '')}</div>
        </div>

        <!-- チェック項目ヘッダー -->
        <div class="check-header-row">
          <div class="check-question-col"></div>
          <div class="check-choice-col">〇</div>
          <div class="check-choice-col">×</div>
        </div>
        ${checkRows}

        <!-- 体調 -->
        <div class="detail-check-row">
          <div class="detail-check-q">本日の体調はどうでしたか？</div>
          <div class="detail-check-a" style="width:auto; padding: 8px 14px; border-left: 1.5px solid var(--border);">
            <span class="detail-badge ${healthClass}">${escHtml(r.health || '―')}</span>
          </div>
        </div>

        <!-- 加工帳・ミス -->
        <div class="detail-check-row">
          <div class="detail-check-q">加工帳・ミス・現場での変更・などの有無</div>
          <div class="detail-check-a" style="width:auto; padding: 8px 14px; border-left: 1.5px solid var(--border);">
            <span class="detail-badge ${changeClass}">${escHtml(r.change_note || '―')}</span>
          </div>
        </div>

        <!-- 応援の有無 -->
        <div class="detail-check-row">
          <div class="detail-check-q">応援の有無</div>
          <div class="detail-check-a" style="width:auto; padding: 8px 14px; border-left: 1.5px solid var(--border); display:flex; align-items:center; gap:12px;">
            <span class="detail-badge ${supportClass}">${escHtml(r.support || '―')}</span>
            ${r.support === '有' ? `<span style="font-size:13px; color:var(--text-secondary);">${escHtml(supportDetail)}</span>` : ''}
          </div>
        </div>

        <!-- 作業内容 -->
        <div class="detail-row" style="align-items:stretch;">
          <div class="detail-label-cell" style="align-items:flex-start; padding-top:12px;">作業内容</div>
          <div class="detail-text-cell">${escHtml(r.work_content || '（未記入）')}</div>
        </div>

        <!-- KY活動テーマ -->
        <div class="detail-ky-row">
          <div class="detail-label-cell" style="align-items:flex-start; padding-top:12px; border-right: 1.5px solid var(--border);">KY活動テーマ</div>
          <div class="detail-ky-cell">
            <div class="detail-ky-hint">例）〜がどうなって、〜になる</div>
            <div class="detail-ky-val">${escHtml(r.ky_theme_danger || '（未記入）')}</div>
          </div>
          <div class="detail-ky-cell">
            <div class="detail-ky-hint">だから、私達はこうします！</div>
            <div class="detail-ky-val">${escHtml(r.ky_theme_action || '（未記入）')}</div>
          </div>
        </div>

        <!-- 一口メモ -->
        <div class="detail-row" style="align-items:stretch; border-bottom:none;">
          <div class="detail-memo-label">
            <i class="fa-solid fa-pencil"></i> 一口メモ（感想）必ず記入の事!!
          </div>
          <div class="detail-text-cell">${escHtml(r.memo || '（未記入）')}</div>
        </div>

      </div>

      <div class="detail-meta">
        提出日時：${formatDateTime(r.created_at)}
        ${r.updated_at && r.updated_at !== r.created_at ? `　最終更新：${formatDateTime(r.updated_at)}` : ''}
      </div>`;

    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    console.error(err);
    showToast('詳細の読み込みに失敗しました', 'error');
  }
}

/* ===========================
   報告書の編集
=========================== */
async function editReport() {
  if (!state.currentReportId) return;

  try {
    const res = await fetch(`/tables/${TABLE}/${state.currentReportId}`);
    const r   = await res.json();

    // 権限ガード：一般ユーザーは自分の日報のみ編集可能
    const auth = getAuth();
    if (!isAdmin() && auth && auth.role === 'user' && (r.owner_id || '') !== auth.id) {
      showToast('他の人の日報は編集できません', 'error');
      showView('list');
      return;
    }

    state.isEditing = true;
    document.getElementById('edit-id').value = r.id;
    document.getElementById('form-title').innerHTML = '<i class="fa-solid fa-pen"></i> 報告書を編集';
    document.getElementById('submit-btn').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> 更新する';

    // 勤務区分（後方互換: 既存データで未設定の場合は「出勤」として扱う）
    const wsEl = document.getElementById('work-status');
    const wsVal = (r.work_status === 'holiday') ? 'holiday' : 'work';
    if (wsEl) wsEl.value = wsVal;
    applyWorkStatusUI(wsVal);

    // テキスト系
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('report-date',       r.report_date);
    setVal('site-name',         r.site_name);
    setVal('foreman',           r.foreman);
    setVal('worker-names',      r.worker_names);
    setVal('worker-count',      r.worker_count);
    setVal('recorder',          r.recorder);
    setVal('work-content',      r.work_content);
    setVal('ky-theme-danger',   r.ky_theme_danger);
    setVal('ky-theme-action',   r.ky_theme_action);
    setVal('memo',              r.memo);

    updateDayLabel(r.report_date);

    // 応援人数・会社名
    setVal('support-company1', r.support_company1);
    setVal('support-rebar1',   r.support_rebar1_count);
    setVal('support-company2', r.support_company2);
    setVal('support-rebar2',   r.support_rebar2_count);

    // ラジオボタン
    const setRadio = (name, val) => {
      const el = document.querySelector(`input[name="${name}"][value="${val}"]`);
      if (el) el.checked = true;
    };
    setRadio('check_greeting',        r.check_greeting);
    setRadio('check_ky',              r.check_ky);
    setRadio('check_foreman_support', r.check_foreman_support);
    setRadio('check_foreman_ability', r.check_foreman_ability);
    setRadio('check_meeting',         r.check_meeting);
    setRadio('check_cleanup',         r.check_cleanup);
    setRadio('check_tools',           r.check_tools);
    setRadio('health',                r.health);
    setRadio('change_note',           r.change_note);
    setRadio('support',               r.support);

    toggleSupportCount(r.support === '有');

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-form').classList.add('active');
    document.getElementById('btn-new').classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    console.error(err);
    showToast('データの読み込みに失敗しました', 'error');
  }
}

/* ===========================
   報告書の削除
=========================== */
function deleteReport() {
  if (!state.currentReportId) return;

  document.getElementById('modal-overlay').classList.add('show');

  document.getElementById('confirm-delete-btn').onclick = async () => {
    try {
      // 権限ガード：削除直前にAPIから最新データを取得して owner_id を確認
      const checkRes = await fetch(`/tables/${TABLE}/${state.currentReportId}`);
      const target   = await checkRes.json();
      const auth     = getAuth();

      if (!isAdmin() && auth && auth.role === 'user' && (target.owner_id || '') !== auth.id) {
        closeModal();
        showToast('他の人の日報は削除できません', 'error');
        showView('list');
        return;
      }

      await fetch(`/tables/${TABLE}/${state.currentReportId}`, { method: 'DELETE' });
      closeModal();
      showToast('報告書を削除しました', 'info');
      state.currentReportId = null;
      showView('list');
    } catch (err) {
      console.error(err);
      showToast('削除に失敗しました', 'error');
      closeModal();
    }
  };
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('show');
}

/* ===========================
   トースト通知
=========================== */
let toastTimer = null;
function showToast(msg, type = 'info') {
  const toast   = document.getElementById('toast');
  const icons   = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> ${msg}`;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

/* ===========================
   ヘルパー関数
=========================== */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d   = new Date(dateStr + 'T00:00:00');
  const y   = d.getFullYear();
  const m   = d.getMonth() + 1;
  const day = d.getDate();
  const w   = WEEKDAYS[d.getDay()];
  return `${y}年${m}月${day}日（${w}）`;
}

function formatDateTime(ms) {
  if (!ms) return '';
  const d   = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ===========================
   パスワードハッシュ（SHA-256 / Web Crypto API）
=========================== */
async function sha256(str) {
  const buf    = new TextEncoder().encode(str);
  const hash   = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ===========================
   ユーザー管理（管理者専用）
=========================== */

// ------------------------------------------------
// ユーザー一覧を読み込んで表示（管理者専用）
//   ★ DB から取得した結果のみで描画。静的配列・localStorage は一切参照しない。
//   ★ 並び順: 新しく追加された順（created_at 降順）
// ------------------------------------------------
async function loadUsers() {
  if (!isAdmin()) { showView('list'); return; }
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="users-loading"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中...</td></tr>';

  try {
    // 万一 DB が空ならブートストラップ（村田和志を投入）
    await ensureSeedAccount();

    const res   = await apiFetch(`/tables/${USER_TABLE}?limit=500`);
    const json  = await res.json();
    const dbUsers = json.data || [];

    if (dbUsers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="users-empty">ユーザーがいません</td></tr>';
      return;
    }

    // 新しく追加された順（created_at 降順）で表示
    dbUsers.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    tbody.innerHTML = dbUsers.map(u => renderUserRow(u)).join('');
  } catch (err) {
    console.error('loadUsers error:', err);
    tbody.innerHTML = '<tr><td colspan="6" class="users-empty">読み込みに失敗しました</td></tr>';
  }
}

function renderUserRow(u) {
  const isActive   = isUserActive(u);
  const statusBadge = isActive
    ? '<span class="user-status-badge active"><i class="fa-solid fa-circle-check"></i> 有効</span>'
    : '<span class="user-status-badge inactive"><i class="fa-solid fa-circle-xmark"></i> 無効</span>';

  const createdLabel = u.created_at_label || (u.created_at ? formatDateTime(u.created_at) : '―');

  // 操作ボタン群（全ユーザー共通）
  const toggleLabel = isActive
    ? '<i class="fa-solid fa-ban"></i> 無効化'
    : '<i class="fa-solid fa-circle-check"></i> 有効化';
  const toggleClass = isActive ? 'btn-user-action btn-user-disable' : 'btn-user-action btn-user-enable';

  const actions = `
    <div class="user-action-group">
      <button class="btn-user-action btn-user-edit"
        onclick="openEditUserModal('${escHtml(u.id)}','${escHtml(u.name)}','${escHtml(u.login_id)}')">
        <i class="fa-solid fa-pen"></i> 編集
      </button>
      <button class="btn-user-action btn-user-pw"
        onclick="openChangePwModal('${escHtml(u.id)}','${escHtml(u.name)}')">
        <i class="fa-solid fa-key"></i> PW変更
      </button>
      <button class="${toggleClass}"
        onclick="confirmToggleUser('${escHtml(u.id)}','${escHtml(u.name)}',${isActive})">
        ${toggleLabel}
      </button>
      <button class="btn-user-action btn-user-delete"
        onclick="confirmDeleteUser('${escHtml(u.id)}','${escHtml(u.name)}')">
        <i class="fa-solid fa-trash"></i> 削除
      </button>
    </div>`;

  return `<tr>
    <td>${escHtml(u.name)}</td>
    <td><code class="login-id-code">${escHtml(u.login_id || u.id)}</code></td>
    <td><span class="user-role-badge"><i class="fa-solid fa-user"></i> 一般</span></td>
    <td>${statusBadge}</td>
    <td class="created-at-cell">${escHtml(createdLabel)}</td>
    <td>${actions}</td>
  </tr>`;
}

// ------------------------------------------------
// ユーザー追加
// ------------------------------------------------
function openAddUserModal() {
  if (!isAdmin()) return;
  document.getElementById('add-user-form').reset();
  _setInputType('new-user-password',         'password', 'new-user-pw-icon');
  _setInputType('new-user-password-confirm', 'password', 'new-user-pw-confirm-icon');
  _hideErr('add-user-error');
  document.getElementById('add-user-modal-overlay').classList.add('show');
  setTimeout(() => document.getElementById('new-user-name').focus(), 100);
}
function closeAddUserModal() {
  document.getElementById('add-user-modal-overlay').classList.remove('show');
}
function toggleNewUserPw() {
  _togglePw('new-user-password', 'new-user-pw-icon');
}
function toggleNewUserPwConfirm() {
  _togglePw('new-user-password-confirm', 'new-user-pw-confirm-icon');
}

async function submitAddUser(event) {
  event.preventDefault();
  if (!isAdmin()) return;

  const nameVal   = document.getElementById('new-user-name').value.trim();
  const loginId   = document.getElementById('new-user-login-id').value.trim();
  const pw        = document.getElementById('new-user-password').value;
  const pwConfirm = document.getElementById('new-user-password-confirm').value;
  const errEl     = document.getElementById('add-user-error');
  const submitBtn = document.getElementById('add-user-submit-btn');

  _hideErr('add-user-error');
  if (!nameVal)  { _showErr(errEl, '氏名を入力してください'); return; }
  if (!loginId)  { _showErr(errEl, 'ログインIDを入力してください'); return; }
  if (!/^[a-zA-Z0-9_@.\-]+$/.test(loginId)) { _showErr(errEl, 'ログインIDは半角英数字・記号（@._-）のみ使用できます'); return; }
  if (!pw)       { _showErr(errEl, 'パスワードを入力してください'); return; }
  if (pw.length < 4) { _showErr(errEl, 'パスワードは4文字以上で設定してください'); return; }
  if (pw !== pwConfirm) { _showErr(errEl, 'パスワードと確認が一致しません'); return; }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 追加中...';
  try {
    // 重複チェック（DBから最新データを取得）
    const listRes  = await apiFetch(`/tables/${USER_TABLE}?limit=500`);
    const listJson = await listRes.json();
    if ((listJson.data || []).find(u => u.login_id === loginId)) {
      _showErr(errEl, 'このログインIDはすでに登録されています');
      return;
    }
    const pwHash = await sha256(pw);
    const now    = new Date();
    const label  = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;

    // ★ DB に INSERT（POST /tables/user_accounts）
    const postRes = await apiFetch(`/tables/${USER_TABLE}`, {
      method: 'POST',
      body: JSON.stringify({
        name:             nameVal,
        login_id:         loginId,
        password_hash:    pwHash,
        role:             'user',
        is_active:        true,
        created_at_label: label,
      }),
    });
    if (!postRes.ok) {
      const errBody = await postRes.text().catch(() => '');
      throw new Error(`POST failed: HTTP ${postRes.status} ${errBody}`);
    }

    closeAddUserModal();
    showToast(`ユーザー「${nameVal}」を追加しました ✅`, 'success');

    // ★ 一覧 + ログイン画面ピッカーを DB から再取得して即時反映
    await loadUsers();
    await buildUserPicker();
  } catch (err) {
    console.error('submitAddUser error:', err);
    _showErr(errEl, '保存に失敗しました。もう一度お試しください。');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> 追加する';
  }
}

// ------------------------------------------------
// ユーザー編集（氏名・ログインID）
// ------------------------------------------------
function openEditUserModal(dbId, name, loginId) {
  if (!isAdmin()) return;
  document.getElementById('edit-user-db-id').value   = dbId;
  document.getElementById('edit-user-name').value    = name;
  document.getElementById('edit-user-login-id').value = loginId;
  _hideErr('edit-user-error');
  document.getElementById('edit-user-modal-overlay').classList.add('show');
  setTimeout(() => document.getElementById('edit-user-name').focus(), 100);
}
function closeEditUserModal() {
  document.getElementById('edit-user-modal-overlay').classList.remove('show');
}

async function submitEditUser(event) {
  event.preventDefault();
  if (!isAdmin()) return;

  const dbId    = document.getElementById('edit-user-db-id').value;
  const nameVal = document.getElementById('edit-user-name').value.trim();
  const loginId = document.getElementById('edit-user-login-id').value.trim();
  const errEl   = document.getElementById('edit-user-error');
  const submitBtn = document.getElementById('edit-user-submit-btn');

  _hideErr('edit-user-error');
  if (!nameVal)  { _showErr(errEl, '氏名を入力してください'); return; }
  if (!loginId)  { _showErr(errEl, 'ログインIDを入力してください'); return; }
  if (!/^[a-zA-Z0-9_@.\-]+$/.test(loginId)) { _showErr(errEl, 'ログインIDは半角英数字・記号（@._-）のみ使用できます'); return; }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 保存中...';
  try {
    // 重複チェック（自分自身は除外）
    const listRes  = await apiFetch(`/tables/${USER_TABLE}?limit=500`);
    const listJson = await listRes.json();
    const dup = (listJson.data || []).find(u => u.login_id === loginId && u.id !== dbId);
    if (dup) { _showErr(errEl, 'このログインIDはすでに使用されています'); return; }

    const patchRes = await apiFetch(`/tables/${USER_TABLE}/${dbId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: nameVal, login_id: loginId }),
    });
    if (!patchRes.ok) {
      throw new Error(`PATCH failed: HTTP ${patchRes.status}`);
    }
    closeEditUserModal();
    showToast(`「${nameVal}」の情報を更新しました ✅`, 'success');
    await loadUsers();
    await buildUserPicker();
  } catch (err) {
    console.error(err);
    _showErr(errEl, '保存に失敗しました。もう一度お試しください。');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> 保存する';
  }
}

// ------------------------------------------------
// パスワード変更
// ------------------------------------------------
function openChangePwModal(dbId, name) {
  if (!isAdmin()) return;
  document.getElementById('change-pw-db-id').value = dbId;
  document.getElementById('change-pw-target-name').textContent = `対象：${name}`;
  document.getElementById('change-pw-form').reset();
  _setInputType('change-pw-new',     'password', 'change-pw-icon');
  _setInputType('change-pw-confirm', 'password', 'change-pw-confirm-icon');
  _hideErr('change-pw-error');
  document.getElementById('change-pw-modal-overlay').classList.add('show');
  setTimeout(() => document.getElementById('change-pw-new').focus(), 100);
}
function closeChangePwModal() {
  document.getElementById('change-pw-modal-overlay').classList.remove('show');
}
function toggleChangePw() {
  _togglePw('change-pw-new', 'change-pw-icon');
}
function toggleChangePwConfirm() {
  _togglePw('change-pw-confirm', 'change-pw-confirm-icon');
}

async function submitChangePw(event) {
  event.preventDefault();
  if (!isAdmin()) return;

  const dbId      = document.getElementById('change-pw-db-id').value;
  const pw        = document.getElementById('change-pw-new').value;
  const pwConfirm = document.getElementById('change-pw-confirm').value;
  const errEl     = document.getElementById('change-pw-error');
  const submitBtn = document.getElementById('change-pw-submit-btn');

  _hideErr('change-pw-error');
  if (!pw)           { _showErr(errEl, 'パスワードを入力してください'); return; }
  if (pw.length < 4) { _showErr(errEl, 'パスワードは4文字以上で設定してください'); return; }
  if (pw !== pwConfirm) { _showErr(errEl, 'パスワードと確認が一致しません'); return; }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 変更中...';
  try {
    const pwHash = await sha256(pw);
    const patchRes = await apiFetch(`/tables/${USER_TABLE}/${dbId}`, {
      method: 'PATCH',
      body: JSON.stringify({ password_hash: pwHash }),
    });
    if (!patchRes.ok) {
      throw new Error(`PATCH failed: HTTP ${patchRes.status}`);
    }
    closeChangePwModal();
    showToast('パスワードを変更しました ✅', 'success');
  } catch (err) {
    console.error(err);
    _showErr(errEl, '変更に失敗しました。もう一度お試しください。');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-key"></i> 変更する';
  }
}

// ------------------------------------------------
// 有効 / 無効切り替え
// ------------------------------------------------
let _toggleTargetId   = null;
let _toggleTargetName = null;
let _toggleToActive   = null;

function confirmToggleUser(dbId, name, currentlyActive) {
  if (!isAdmin()) return;
  _toggleTargetId   = dbId;
  _toggleTargetName = name;
  _toggleToActive   = !currentlyActive;

  const iconEl     = document.getElementById('toggle-user-icon');
  const titleEl    = document.getElementById('toggle-user-title');
  const msgEl      = document.getElementById('toggle-user-message');
  const confirmBtn = document.getElementById('toggle-user-confirm-btn');

  if (_toggleToActive) {
    iconEl.innerHTML    = '<i class="fa-solid fa-circle-check" style="color:#16a34a;"></i>';
    titleEl.textContent = 'アカウントを有効化';
    msgEl.textContent   = `「${name}」のアカウントを有効化します。このユーザーはログインできるようになります。`;
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> 有効化する';
  } else {
    iconEl.innerHTML    = '<i class="fa-solid fa-ban" style="color:#dc2626;"></i>';
    titleEl.textContent = 'アカウントを無効化';
    msgEl.textContent   = `「${name}」のアカウントを無効化します。このユーザーはログインできなくなります。`;
    confirmBtn.className = 'btn btn-danger';
    confirmBtn.innerHTML = '<i class="fa-solid fa-ban"></i> 無効化する';
  }
  confirmBtn.onclick = executeToggleUser;
  document.getElementById('toggle-user-modal-overlay').classList.add('show');
}
function closeToggleUserModal() {
  document.getElementById('toggle-user-modal-overlay').classList.remove('show');
}
async function executeToggleUser() {
  if (!isAdmin() || !_toggleTargetId) return;
  const confirmBtn = document.getElementById('toggle-user-confirm-btn');
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 変更中...';
  try {
    const patchRes = await apiFetch(`/tables/${USER_TABLE}/${_toggleTargetId}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: _toggleToActive }),
    });
    if (!patchRes.ok) {
      throw new Error(`PATCH failed: HTTP ${patchRes.status}`);
    }
    closeToggleUserModal();
    showToast(`「${_toggleTargetName}」を${_toggleToActive ? '有効化' : '無効化'}しました`, 'info');
    await loadUsers();
    await buildUserPicker();
  } catch (err) {
    console.error(err);
    showToast('変更に失敗しました', 'error');
  } finally {
    confirmBtn.disabled = false;
    closeToggleUserModal();
  }
}

// ------------------------------------------------
// ユーザー削除（物理削除 ― 日報データは owner_id で残る）
// ------------------------------------------------
let _deleteTargetId   = null;
let _deleteTargetName = null;

function confirmDeleteUser(dbId, name) {
  if (!isAdmin()) return;
  _deleteTargetId   = dbId;
  _deleteTargetName = name;
  document.getElementById('delete-user-message').textContent =
    `「${name}」を削除します。この操作は取り消せません。`;
  document.getElementById('delete-user-confirm-btn').onclick = executeDeleteUser;
  document.getElementById('delete-user-modal-overlay').classList.add('show');
}
function closeDeleteUserModal() {
  document.getElementById('delete-user-modal-overlay').classList.remove('show');
}
async function executeDeleteUser() {
  if (!isAdmin() || !_deleteTargetId) return;
  const confirmBtn = document.getElementById('delete-user-confirm-btn');
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 削除中...';
  try {
    const delRes = await apiFetch(`/tables/${USER_TABLE}/${_deleteTargetId}`, { method: 'DELETE' });
    if (!delRes.ok && delRes.status !== 204) {
      throw new Error(`DELETE failed: HTTP ${delRes.status}`);
    }
    closeDeleteUserModal();
    showToast(`「${_deleteTargetName}」を削除しました`, 'info');
    await loadUsers();
    await buildUserPicker();
  } catch (err) {
    console.error(err);
    showToast('削除に失敗しました', 'error');
  } finally {
    confirmBtn.disabled = false;
    closeDeleteUserModal();
  }
}

// ------------------------------------------------
// 共通ユーティリティ（ユーザー管理フォーム用）
// ------------------------------------------------
function _togglePw(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon  = document.getElementById(iconId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  icon.className = input.type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
}
function _setInputType(inputId, type, iconId) {
  const input = document.getElementById(inputId);
  const icon  = document.getElementById(iconId);
  if (input) input.type = type;
  if (icon)  icon.className = 'fa-solid fa-eye';
}
function _showErr(el, msg) {
  el.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${msg}`;
  el.style.display = 'flex';
}
function _hideErr(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

/* ===========================
   日報一括削除（管理者専用）
=========================== */
function openBulkDeleteModal() {
  if (!isAdmin()) return;

  const reports = state.reports;

  // 現場名プルダウン生成
  const siteSelect = document.getElementById('bulk-filter-site');
  const sites = [...new Set(reports.map(r => r.site_name).filter(Boolean))].sort();
  siteSelect.innerHTML = '<option value="">すべての現場</option>';
  sites.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    siteSelect.appendChild(opt);
  });

  // 記入者プルダウン生成
  const recSelect = document.getElementById('bulk-filter-recorder');
  const recorders = [...new Set(reports.map(r => r.recorder).filter(Boolean))].sort();
  recSelect.innerHTML = '<option value="">全員</option>';
  recorders.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r; opt.textContent = r;
    recSelect.appendChild(opt);
  });

  // 期間の初期値（今月1日〜今日）
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  document.getElementById('bulk-date-from').value = bulkFormatDate(firstOfMonth);
  document.getElementById('bulk-date-to').value   = bulkFormatDate(today);

  // 確認チェックをリセット
  const check = document.getElementById('bulk-confirm-check');
  if (check) check.checked = false;

  // プログレスリセット
  const prog = document.getElementById('bulk-progress');
  if (prog) prog.textContent = '';

  updateBulkCount();

  // フィルター変更時に件数更新
  ['bulk-filter-site', 'bulk-filter-recorder', 'bulk-date-from', 'bulk-date-to'].forEach(id => {
    const el = document.getElementById(id);
    el.onchange = () => { updateBulkCount(); updateBulkDeleteBtn(); };
    el.oninput  = () => { updateBulkCount(); updateBulkDeleteBtn(); };
  });

  document.getElementById('bulk-delete-modal-overlay').classList.add('show');
}

function closeBulkDeleteModal() {
  const btn = document.getElementById('bulk-exec-btn');
  if (btn && btn.disabled && document.getElementById('bulk-progress')?.textContent !== '') return;
  document.getElementById('bulk-delete-modal-overlay').classList.remove('show');
}

function bulkFormatDate(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function getFilteredBulkReports() {
  const site     = document.getElementById('bulk-filter-site').value;
  const recorder = document.getElementById('bulk-filter-recorder').value;
  const dateFrom = document.getElementById('bulk-date-from').value;
  const dateTo   = document.getElementById('bulk-date-to').value;

  return state.reports.filter(r => {
    if (site     && r.site_name  !== site)     return false;
    if (recorder && r.recorder   !== recorder) return false;
    if (dateFrom && r.report_date < dateFrom)  return false;
    if (dateTo   && r.report_date > dateTo)    return false;
    return true;
  });
}

function updateBulkCount() {
  const count = getFilteredBulkReports().length;
  const label = document.getElementById('bulk-count-label');
  if (label) {
    label.textContent = `対象：${count} 件`;
    label.style.color = count === 0 ? '#dc2626' : '#16a34a';
  }
}

function updateBulkDeleteBtn() {
  const count   = getFilteredBulkReports().length;
  const checked = document.getElementById('bulk-confirm-check')?.checked;
  const btn     = document.getElementById('bulk-exec-btn');
  if (btn) btn.disabled = !(count > 0 && checked);
}

async function executeBulkDelete() {
  if (!isAdmin()) return;

  const targets = getFilteredBulkReports();
  if (targets.length === 0) return;

  // 確認チェック
  if (!document.getElementById('bulk-confirm-check')?.checked) {
    showToast('確認チェックを入れてください', 'error');
    return;
  }

  // 最終確認ダイアログ
  const ok = window.confirm(
    `${targets.length}件の日報を一括削除します。\nこの操作は取り消せません。\n本当に削除しますか？`
  );
  if (!ok) return;

  const execBtn   = document.getElementById('bulk-exec-btn');
  const cancelBtn = document.getElementById('bulk-cancel-btn');
  const progEl    = document.getElementById('bulk-progress');

  execBtn.disabled  = true;
  execBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 削除中...';
  if (cancelBtn) cancelBtn.disabled = true;

  let successCount = 0;
  let failCount    = 0;

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    if (progEl) progEl.textContent = `削除中... ${i + 1} / ${targets.length} 件`;

    try {
      const res = await fetch(`/tables/${TABLE}/${r.id}`, { method: 'DELETE' });
      if (res.ok || res.status === 204) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (e) {
      console.error('削除失敗:', r.id, e);
      failCount++;
    }
  }

  if (progEl) progEl.textContent = '';
  execBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> 一括削除する';
  if (cancelBtn) cancelBtn.disabled = false;

  // モーダルを閉じて一覧を再読み込み
  document.getElementById('bulk-delete-modal-overlay').classList.remove('show');
  await loadReports();

  if (failCount === 0) {
    showToast(`${successCount} 件の日報を削除しました`, 'info');
  } else {
    showToast(`${successCount} 件削除、${failCount} 件失敗しました`, 'error');
  }
}
