/* ===========================
   村田鉄筋株式会社 - PDF一括ダウンロード
=========================== */

const WEEKDAYS_PDF = ['日', '月', '火', '水', '木', '金', '土'];

/* ===========================
   モーダル開閉
=========================== */
function openPdfModal() {
  // 管理者のみ
  if (!isAdmin()) return;

  const reports = state.reports;

  // 現場名プルダウンを生成
  const siteSelect = document.getElementById('pdf-filter-site');
  const sites = [...new Set(reports.map(r => r.site_name).filter(Boolean))].sort();
  siteSelect.innerHTML = '<option value="">すべての現場</option>';
  sites.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    siteSelect.appendChild(opt);
  });

  // 記入者プルダウンを生成
  const recSelect = document.getElementById('pdf-filter-recorder');
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
  document.getElementById('pdf-date-from').value = formatDateValue(firstOfMonth);
  document.getElementById('pdf-date-to').value   = formatDateValue(today);

  // プログレスリセット
  const prog = document.getElementById('pdf-progress');
  if (prog) prog.textContent = '';

  updatePdfCount();

  // フィルター変更時に件数更新
  ['pdf-filter-site', 'pdf-filter-recorder', 'pdf-date-from', 'pdf-date-to'].forEach(id => {
    const el = document.getElementById(id);
    el.onchange = updatePdfCount;
    el.oninput  = updatePdfCount;
  });

  document.getElementById('pdf-modal-overlay').classList.add('show');
}

function closePdfModal() {
  // 生成中は閉じない
  const btn = document.getElementById('pdf-exec-btn');
  if (btn && btn.disabled) return;
  document.getElementById('pdf-modal-overlay').classList.remove('show');
}

function formatDateValue(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/* ===========================
   絞り込み件数の更新
=========================== */
function getFilteredPdfReports() {
  const site     = document.getElementById('pdf-filter-site').value;
  const recorder = document.getElementById('pdf-filter-recorder').value;
  const dateFrom = document.getElementById('pdf-date-from').value;
  const dateTo   = document.getElementById('pdf-date-to').value;

  return state.reports.filter(r => {
    if (site     && r.site_name !== site)     return false;
    if (recorder && r.recorder  !== recorder) return false;
    if (dateFrom && r.report_date < dateFrom) return false;
    if (dateTo   && r.report_date > dateTo)   return false;
    return true;
  });
}

function updatePdfCount() {
  const count = getFilteredPdfReports().length;
  const label = document.getElementById('pdf-count-label');
  label.textContent = `対象：${count} 件`;
  label.style.color = count === 0 ? '#dc2626' : '#16a34a';
  document.getElementById('pdf-exec-btn').disabled = count === 0;
}

/* ===========================
   PDF実行
=========================== */
async function executePdfDownload() {
  const targets = getFilteredPdfReports();
  if (targets.length === 0) return;

  const execBtn   = document.getElementById('pdf-exec-btn');
  const cancelBtn = document.getElementById('pdf-cancel-btn');
  const progEl    = document.getElementById('pdf-progress');

  execBtn.disabled   = true;
  execBtn.innerHTML  = '<i class="fa-solid fa-spinner fa-spin"></i> 生成中...';
  if (cancelBtn) cancelBtn.disabled = true;

  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW   = 210;
    const pageH   = 297;
    const margin  = 8;
    const contentW = pageW - margin * 2;
    const maxH     = pageH - margin * 2;

    for (let i = 0; i < targets.length; i++) {
      const r = targets[i];

      // プログレス表示
      if (progEl) {
        progEl.textContent = `処理中... ${i + 1} / ${targets.length} 件`;
      }

      // HTMLをレンダリングエリアに展開
      const area = document.getElementById('pdf-render-area');
      area.innerHTML = buildReportHtml(r);

      // 描画が完了するまで少し待機
      await new Promise(resolve => setTimeout(resolve, 150));

      // html2canvas でキャプチャ
      const canvas = await html2canvas(area, {
        scale: 2.5,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        allowTaint: true,
        imageTimeout: 0,
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const imgW    = contentW;
      const imgH    = (canvas.height * imgW) / canvas.width;

      if (i > 0) pdf.addPage();

      if (imgH <= maxH) {
        // 1ページに収まる場合：上部基準で配置
        pdf.addImage(imgData, 'JPEG', margin, margin, imgW, imgH);
      } else {
        // 縦長の場合：ページに合わせて縮小
        const scale   = maxH / imgH;
        const scaledW = imgW * scale;
        const scaledH = maxH;
        const offsetX = margin + (contentW - scaledW) / 2;
        pdf.addImage(imgData, 'JPEG', offsetX, margin, scaledW, scaledH);
      }
    }

    // ファイル名：村田鉄筋_作業報告書_YYYYMMDD.pdf
    const now   = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    pdf.save(`村田鉄筋_作業報告書_${stamp}.pdf`);

    if (progEl) progEl.textContent = '';
    closePdfModal();
    showToast(`${targets.length} 件のPDFを生成しました 📄`, 'success');

  } catch (err) {
    console.error('PDF生成エラー:', err);
    if (progEl) progEl.textContent = '';
    showToast('PDF生成に失敗しました。再度お試しください。', 'error');
  } finally {
    execBtn.disabled   = false;
    execBtn.innerHTML  = '<i class="fa-solid fa-download"></i> ダウンロード';
    if (cancelBtn) cancelBtn.disabled = false;
    document.getElementById('pdf-render-area').innerHTML = '';
  }
}

/* ===========================
   報告書HTML生成（帳票レイアウト）
=========================== */
function buildReportHtml(r) {
  const dateStr = pdfFormatDate(r.report_date);
  const dow     = r.report_date
    ? WEEKDAYS_PDF[new Date(r.report_date + 'T00:00:00').getDay()] + '曜日'
    : '';

  const checks = [
    { label: 'あいさつは出来ていましたか？',               key: 'check_greeting'        },
    { label: 'KY活動は行いましたか？',                     key: 'check_ky'              },
    { label: '職長の指示は、的確になされていましたか？',   key: 'check_foreman_support' },
    { label: '職長の方は、思うように指示を出せましたか？', key: 'check_foreman_ability' },
    { label: '打ち合わせはうまく進みましたか？',           key: 'check_meeting'         },
    { label: '現場の整理・整頓は終わりましたか？',         key: 'check_cleanup'         },
    { label: '道具類の片付けは終わりましたか？',           key: 'check_tools'           },
  ];

  const checkRows = checks.map(c => {
    const val     = r[c.key] || '';
    const isMaru  = val === '〇';
    const isBatsu = val === '×';
    return `
      <tr>
        <td style="padding:5px 10px;font-size:12px;border-bottom:1px solid #bbb;border-right:1px solid #bbb;word-break:break-word;vertical-align:middle;">${escPdf(c.label)}</td>
        <td style="text-align:center;vertical-align:middle;border-bottom:1px solid #bbb;border-right:1px solid #bbb;font-size:17px;font-weight:bold;">
          ${isMaru ? '<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;border:2.5px solid #1a56a0;color:#1a56a0;line-height:1;">〇</span>' : ''}
        </td>
        <td style="text-align:center;vertical-align:middle;border-bottom:1px solid #bbb;font-size:17px;font-weight:bold;">
          ${isBatsu ? '<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;border:2.5px solid #dc2626;color:#dc2626;line-height:1;">×</span>' : ''}
        </td>
      </tr>`;
  }).join('');

  // 体調
  const healthOpts = ['良好', '普通', '不調'];
  const healthCells = healthOpts.map(h => {
    const sel = r.health === h;
    const col = h === '良好' ? '#16a34a' : h === '不調' ? '#dc2626' : '#64748b';
    return `<td style="padding:5px 18px;border-left:1px solid #bbb;font-size:13px;font-weight:bold;color:${col};border-bottom:1px solid #bbb;">${sel ? h : ''}</td>`;
  }).join('');

  // 加工帳・ミス
  const changeOpts = ['有', '無'];
  const changeCells = changeOpts.map(v => {
    const sel = r.change_note === v;
    const col = v === '有' ? '#d97706' : '#16a34a';
    return `<td style="padding:5px 24px;border-left:1px solid #bbb;font-size:13px;font-weight:bold;color:${col};border-bottom:1px solid #bbb;">${sel ? v : ''}</td>`;
  }).join('');

  // 応援の有無：選択値のみ表示
  const supportVal    = r.support || '';
  const supportColor  = supportVal === '有' ? '#1a56a0' : '#64748b';

  // 応援詳細テキスト（「有」のときのみ）
  let supportDetailText = '';
  if (r.support === '有') {
    const c1 = escPdf(r.support_company1 || '');
    const n1 = r.support_rebar1_count || 0;
    const c2 = escPdf(r.support_company2 || '');
    const n2 = r.support_rebar2_count || 0;
    const lines = [];
    if (c1 || n1) lines.push(`${c1}　${n1}名`);
    if (c2 || n2) lines.push(`${c2}　${n2}名`);
    supportDetailText = lines.join('<br>');
  }

  return `
  <div style="font-family:'Noto Sans JP',sans-serif;background:#fff;color:#1a1f2e;padding:12px 16px;width:868px;">

    <!-- タイトル行 -->
    <table style="width:100%;border:2px solid #333;border-collapse:collapse;margin-bottom:0;">
      <tr>
        <td style="width:55%;text-align:center;font-size:22px;font-weight:bold;letter-spacing:0.25em;padding:12px 10px;border-right:2px solid #333;vertical-align:middle;">
          作　業　報　告　書
        </td>
        <td style="padding:10px 16px;vertical-align:middle;">
          <div style="font-size:15px;font-weight:bold;margin-bottom:5px;color:#1a2540;">村田鉄筋株式会社</div>
          <div style="font-size:14px;font-weight:bold;color:#1a2540;">${escPdf(dateStr)}　${escPdf(dow)}</div>
        </td>
      </tr>
    </table>

    <!-- 現場名・職長 -->
    <table style="width:100%;border:2px solid #333;border-top:0;border-collapse:collapse;">
      <tr>
        <td style="background:#e8edf5;font-weight:bold;font-size:12px;padding:6px 10px;white-space:nowrap;border-right:1px solid #bbb;border-bottom:1px solid #bbb;width:76px;color:#2a3a5c;">現場名：</td>
        <td style="padding:6px 10px;font-size:13px;border-right:1px solid #bbb;border-bottom:1px solid #bbb;">${escPdf(r.site_name || '')}</td>
        <td style="background:#e8edf5;font-weight:bold;font-size:12px;padding:6px 10px;white-space:nowrap;border-right:1px solid #bbb;border-bottom:1px solid #bbb;width:56px;color:#2a3a5c;">職　長：</td>
        <td style="padding:6px 10px;font-size:13px;border-bottom:1px solid #bbb;">${escPdf(r.foreman || '')}</td>
      </tr>
      <tr>
        <td style="background:#e8edf5;font-weight:bold;font-size:12px;padding:6px 10px;white-space:nowrap;border-right:1px solid #bbb;border-bottom:1px solid #bbb;color:#2a3a5c;">人員名：</td>
        <td style="padding:6px 10px;font-size:13px;border-right:1px solid #bbb;border-bottom:1px solid #bbb;" colspan="3">
          ${escPdf(r.worker_names || '')}
          <span style="margin-left:20px;font-weight:bold;">合計 ${r.worker_count || 0} 名</span>
          <span style="margin-left:20px;">記入者：${escPdf(r.recorder || '')}</span>
        </td>
      </tr>

    </table>

    <!-- チェック項目（ヘッダー＋本体を同一テーブルで統合・table-layout:fixed で列幅固定） -->
    <table style="width:100%;border:2px solid #333;border-top:0;border-collapse:collapse;table-layout:fixed;">
      <colgroup>
        <col style="width:auto;">
        <col style="width:56px;">
        <col style="width:56px;">
      </colgroup>

      <!-- チェックヘッダー -->
      <tr style="background:#dce3ee;">
        <td style="padding:5px 10px;font-size:11px;font-weight:bold;color:#555;border-right:1px solid #bbb;border-bottom:1px solid #bbb;vertical-align:middle;"></td>
        <td style="text-align:center;border-right:1px solid #bbb;border-bottom:1px solid #bbb;font-size:16px;font-weight:bold;color:#1a56a0;vertical-align:middle;">〇</td>
        <td style="text-align:center;border-bottom:1px solid #bbb;font-size:16px;font-weight:bold;color:#dc2626;vertical-align:middle;">×</td>
      </tr>

      ${checkRows}

      <!-- 体調 -->
      <tr>
        <td style="padding:5px 10px;font-size:12px;border-right:1px solid #bbb;border-bottom:1px solid #bbb;vertical-align:middle;">本日の体調はどうでしたか？</td>
        <td colspan="2" style="padding:0;border-bottom:1px solid #bbb;vertical-align:middle;">
          <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
            <tr>${healthCells}</tr>
          </table>
        </td>
      </tr>

      <!-- 加工帳 -->
      <tr>
        <td style="padding:5px 10px;font-size:12px;border-right:1px solid #bbb;border-bottom:1px solid #bbb;vertical-align:middle;">加工帳・ミス・現場での変更・などの有無</td>
        <td colspan="2" style="padding:0;border-bottom:1px solid #bbb;vertical-align:middle;">
          <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
            <tr>${changeCells}</tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- 応援の有無（チェックテーブルから独立・3列構成で会社名折り返し対応） -->
    <table style="width:100%;border:2px solid #333;border-top:0;border-collapse:collapse;">
      <tr>
        <td style="padding:5px 10px;font-size:12px;border-right:1px solid #bbb;border-bottom:1px solid #bbb;vertical-align:middle;width:260px;">応援の有無</td>
        <td style="width:70px;text-align:center;border-right:1px solid #bbb;border-bottom:1px solid #bbb;font-size:13px;font-weight:bold;color:${supportColor};vertical-align:middle;">${escPdf(supportVal)}</td>
        <td style="padding:5px 10px;font-size:12px;border-bottom:1px solid #bbb;vertical-align:middle;line-height:1.7;white-space:normal;word-break:break-word;overflow-wrap:anywhere;">${supportDetailText}</td>
      </tr>
    </table>

    <!-- 作業内容 -->
    <table style="width:100%;border:2px solid #333;border-top:0;border-collapse:collapse;">
      <tr>
        <td style="background:#e8edf5;font-weight:bold;font-size:12px;padding:8px 10px;border-right:1px solid #bbb;border-bottom:1px solid #bbb;white-space:nowrap;vertical-align:top;color:#2a3a5c;width:76px;">作業内容</td>
        <td style="padding:8px 12px;font-size:13px;min-height:70px;white-space:pre-wrap;line-height:1.75;border-bottom:1px solid #bbb;">${escPdf(r.work_content || '')}</td>
      </tr>

      <!-- KY活動テーマ -->
      <tr>
        <td style="background:#e8edf5;font-weight:bold;font-size:12px;padding:8px 10px;border-right:1px solid #bbb;border-bottom:1px solid #bbb;white-space:nowrap;vertical-align:top;color:#2a3a5c;">KY活動テーマ</td>
        <td style="padding:0;border-bottom:1px solid #bbb;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="width:50%;border-right:1px solid #bbb;vertical-align:top;">
                <div style="background:#dce3ee;font-size:11px;font-weight:bold;color:#555;padding:3px 8px;border-bottom:1px solid #bbb;">例）〜がどうなって、〜になる</div>
                <div style="padding:7px 10px;font-size:12px;min-height:44px;white-space:pre-wrap;line-height:1.7;">${escPdf(r.ky_theme_danger || '')}</div>
              </td>
              <td style="vertical-align:top;">
                <div style="background:#dce3ee;font-size:11px;font-weight:bold;color:#555;padding:3px 8px;border-bottom:1px solid #bbb;">だから、私達はこうします！</div>
                <div style="padding:7px 10px;font-size:12px;min-height:44px;white-space:pre-wrap;line-height:1.7;">${escPdf(r.ky_theme_action || '')}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- 一口メモ -->
      <tr>
        <td style="background:#fff8e1;font-weight:bold;font-size:12px;padding:8px 10px;border-right:1px solid #bbb;white-space:nowrap;vertical-align:top;color:#7c4f00;">
          ✏ 一口メモ（感想）<br>必ず記入の事!!
        </td>
        <td style="padding:8px 12px;font-size:13px;min-height:60px;white-space:pre-wrap;line-height:1.75;">${escPdf(r.memo || '')}</td>
      </tr>
    </table>

    <!-- フッター（提出日時） -->
    <div style="margin-top:6px;text-align:right;font-size:11px;color:#888;">
      提出日時：${pdfFormatDateTime(r.created_at)}
    </div>

  </div>`;
}

/* ===========================
   ヘルパー
=========================== */
function pdfFormatDate(dateStr) {
  if (!dateStr) return '';
  const d   = new Date(dateStr + 'T00:00:00');
  const y   = d.getFullYear();
  const m   = d.getMonth() + 1;
  const day = d.getDate();
  const w   = WEEKDAYS_PDF[d.getDay()];
  return `${y}年${m}月${day}日（${w}）`;
}

function pdfFormatDateTime(ms) {
  if (!ms) return '';
  const d   = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escPdf(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
