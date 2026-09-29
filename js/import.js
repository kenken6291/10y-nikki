// ===== 日記の取り込み（ファイル / 貼り付け / 写真） =====
// ・CSV / JSON / テキスト（10年日記サイトのタイムラインのコピー等）から一括取り込み
// ・写真（手書きの日記・紙の10年日記・画面のスクリーンショット）をGeminiで読み取って取り込み
// ・取り込み前に一覧で確認・修正でき、写真の添付もできる
// ※サーバー側は Code.gs の importDiaries / parseDiaryImage を使う

const IM_MOODS = ['😊', '😢', '😤', '😴', '🤔'];
const IM_MAX_ITEMS = 500;
const IM_MAX_PHOTOS = 5; // 1件あたりの写真枚数（投稿画面と同じ）
let imItems = [];      // 取り込み候補
let imBusy = false;

// ---------- 通信（取り込みは時間がかかるため、タイムアウトを長めにした専用版） ----------
function imXhr_(params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', GAS_URL, true);
    xhr.timeout = timeoutMs;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) { reject(new Error('レスポンスの解析に失敗しました')); }
      } else reject(new Error('HTTP ' + xhr.status));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.ontimeout = () => reject(new Error('Timeout'));
    xhr.send(JSON.stringify(params));
  });
}
// 取り込みはdiaryIdをこちらで決めて送るため、再送されてもサーバー側で二重登録されない
async function imPost_(params, timeoutMs = 90000, retries = 2) {
  const res = await requestWithRetry_(() => imXhr_(params, timeoutMs), retries);
  if (res && (res.code === 401 || res.error === 'Unauthorized')) {
    throw new Error('ログインの有効期限が切れました。もう一度ログインしてください');
  }
  if (res && !res.success && res.error && !res.results) throw new Error(res.error);
  return res;
}

// ---------- 共通ユーティリティ ----------
function imNewId_() {
  return 'imp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}
function imPad_(n) { return String(n).padStart(2, '0'); }

function imValidYmd_(y, m, d) {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 && dt.getDate() === d;
}

// いろいろな日付表記 → { date:'YYYY-MM-DD', time:'HH:mm' }（読めなければ null）
function imParseDate_(str, defaultYear) {
  if (str === null || str === undefined) return null;
  let s = String(str).trim()
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[／]/g, '/').replace(/[－―ー]/g, '-').replace(/[：]/g, ':');
  if (!s) return null;
  let y, m, d, time = '';
  const tm = s.match(/(\d{1,2}):(\d{2})/);
  if (tm) time = `${imPad_(tm[1])}:${tm[2]}`;
  let mm = s.match(/(\d{4})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/);
  if (mm) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
  else if ((mm = s.match(/^(\d{4})(\d{2})(\d{2})/))) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
  else if ((mm = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/)) && defaultYear) { y = +defaultYear; m = +mm[1]; d = +mm[2]; }
  else {
    const t = Date.parse(s); // ISO形式など
    if (isNaN(t)) return null;
    const dt = new Date(t);
    y = dt.getFullYear(); m = dt.getMonth() + 1; d = dt.getDate();
    if (!time && /T\d{2}:\d{2}/.test(s)) time = `${imPad_(dt.getHours())}:${imPad_(dt.getMinutes())}`;
  }
  if (!imValidYmd_(y, m, d)) return null;
  return { date: `${y}-${imPad_(m)}-${imPad_(d)}`, time };
}

// ファイル名に含まれる日付（IMG_20260809_123456.jpg / 2026-08-09.jpg 等）
function imDateFromFilename_(name) {
  const mm = String(name || '').match(/(20\d{2}|19\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
  if (!mm) return '';
  const y = +mm[1], m = +mm[2], d = +mm[3];
  return imValidYmd_(y, m, d) ? `${y}-${imPad_(m)}-${imPad_(d)}` : '';
}

function imMakeTitle_(content) {
  const first = String(content || '').split('\n').map(l => l.trim()).find(l => l) || '';
  if (!first) return '';
  return first.length > 30 ? first.slice(0, 30) + '…' : first;
}

function imNormalizeMood_(v) {
  const s = String(v || '').trim();
  if (IM_MOODS.includes(s)) return s;
  if (/悲|泣|かなし|sad/i.test(s)) return '😢';
  if (/怒|いら|angry/i.test(s)) return '😤';
  if (/眠|疲|ねむ|tired|sleep/i.test(s)) return '😴';
  if (/考|悩|なや|think/i.test(s)) return '🤔';
  return '😊';
}

function imParseBool_(v, def) {
  if (v === undefined || v === null || String(v).trim() === '') return def;
  return /^(true|1|yes|公開|○|◯|はい)$/i.test(String(v).trim());
}

function imMakeItem_(o) {
  const content = String(o.content || '').replace(/\r\n?/g, '\n').trim();
  return {
    uid: imNewId_(),
    include: true,
    date: o.date || '',
    time: o.time || '',
    title: String(o.title || '').trim().slice(0, 100) || imMakeTitle_(content),
    content,
    mood: imNormalizeMood_(o.mood),
    tags: Array.isArray(o.tags) ? o.tags.join(', ') : String(o.tags || '').trim(),
    isPublic: !!o.isPublic,
    photos: o.photos || [],
    source: o.source || ''
  };
}

// ---------- ファイル読み込み（UTF-8 / Shift_JIS 自動判定） ----------
async function imReadText_(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, ''); }
  catch (e) { return new TextDecoder('shift_jis').decode(buf); } // Excelで保存したCSV
}

// CSVパーサー（""で囲まれた改行・カンマ・""エスケープに対応）
function imParseCsv_(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim() !== ''));
}

const IM_HEADER_MAP = {
  date:     ['date', 'createdat', '日付', '日時', '年月日', '日'],
  time:     ['time', '時刻', '時間'],
  title:    ['title', 'タイトル', '件名', '題名'],
  content:  ['content', 'body', 'text', '本文', '内容', '日記', 'メモ'],
  mood:     ['mood', '気分', '天気', '顔'],
  tags:     ['tags', 'tag', 'タグ'],
  isPublic: ['ispublic', 'public', '公開']
};
function imMapRecord_(obj, defaultYear) {
  const norm = {};
  Object.keys(obj).forEach(k => { norm[String(k).trim().toLowerCase()] = obj[k]; });
  const pick = key => {
    for (const name of IM_HEADER_MAP[key]) if (norm[name] !== undefined) return norm[name];
    return undefined;
  };
  const dt = imParseDate_(pick('date'), defaultYear);
  const t = pick('time');
  return imMakeItem_({
    date: dt ? dt.date : '',
    time: (t && /^\d{1,2}:\d{2}/.test(String(t).trim())) ? String(t).trim().replace(/^(\d):/, '0$1:').slice(0, 5) : (dt ? dt.time : ''),
    title: pick('title'),
    content: pick('content'),
    mood: pick('mood'),
    tags: pick('tags'),
    isPublic: imParseBool_(pick('isPublic'), false),
    source: 'ファイル'
  });
}

function imItemsFromCsv_(text, defaultYear) {
  const rows = imParseCsv_(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => String(h).trim());
  return rows.slice(1).map(r => {
    const o = {};
    headers.forEach((h, i) => { o[h] = r[i] !== undefined ? r[i] : ''; });
    return imMapRecord_(o, defaultYear);
  }).filter(it => it.content || it.title);
}

function imItemsFromJson_(text, defaultYear) {
  let data = JSON.parse(text);
  if (!Array.isArray(data)) data = data.diaries || data.entries || data.items || [];
  return data.filter(o => o && typeof o === 'object')
    .map(o => imMapRecord_(o, defaultYear))
    .filter(it => it.content || it.title);
}

// テキスト：日付の行で区切る（10年日記サイトのタイムラインをコピーした文章にも対応）
const IM_DATE_LINE = /^\s*(?:(\d{4})\s*[年\/\-.]\s*)?(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})\s*日?\s*(?:[（(]\s*[日月火水木金土]\s*(?:曜日?)?\s*[)）])?\s*(\d{1,2}:\d{2})?\s*$/;
const IM_WEEKDAY_LINE = /^\s*[日月火水木金土]曜日\s*\S{0,6}\s*$/;
const IM_PLACE_LINE = /^\s*\S.{0,30}[都道府県].{0,30}-?\d+(?:\.\d+)?\s*°C\s*$/;

function imItemsFromText_(text, defaultYear) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const items = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    while (cur.body.length && !cur.body[cur.body.length - 1].trim()) cur.body.pop();
    while (cur.body.length && !cur.body[0].trim()) cur.body.shift();
    let content = cur.body.join('\n').trim();
    if (cur.place) content += (content ? '\n\n' : '') + '📍 ' + cur.place;
    if (content) items.push(imMakeItem_({ date: cur.date, time: cur.time, content, source: '貼り付け' }));
    cur = null;
  };
  for (const line of lines) {
    const m = line.match(IM_DATE_LINE);
    if (m && (m[1] || defaultYear)) {
      const y = m[1] ? +m[1] : +defaultYear, mo = +m[2], d = +m[3];
      if (imValidYmd_(y, mo, d)) {
        flush();
        cur = { date: `${y}-${imPad_(mo)}-${imPad_(d)}`, time: m[4] ? m[4].padStart(5, '0') : '', body: [], place: '' };
        continue;
      }
    }
    if (!cur) continue; // 最初の日付行より前の文章は無視
    if (IM_WEEKDAY_LINE.test(line)) continue;          // 「火曜日」だけの行
    if (!cur.place && !cur.body.some(l => l.trim()) && IM_PLACE_LINE.test(line)) { // 「神奈川県 川崎市 26°C」
      cur.place = line.trim();
      continue;
    }
    cur.body.push(line.replace(/\s+$/, ''));
  }
  flush();
  return items;
}

function imDefaultYear_() {
  const v = parseInt(document.getElementById('im-default-year')?.value, 10);
  return v >= 1900 && v <= 2100 ? v : new Date().getFullYear();
}

// ---------- 取り込み方法1：ファイル ----------
async function imHandleFile(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  const dy = imDefaultYear_();
  let added = 0;
  for (const file of files) {
    try {
      const text = await imReadText_(file);
      const name = file.name.toLowerCase();
      let items;
      if (name.endsWith('.json') || /^\s*[\[{]/.test(text)) items = imItemsFromJson_(text, dy);
      else if (name.endsWith('.csv') || name.endsWith('.tsv')) items = imItemsFromCsv_(name.endsWith('.tsv') ? text.replace(/\t/g, ',') : text, dy);
      else items = imItemsFromText_(text, dy);
      added += imAddItems_(items);
    } catch (err) {
      showToast(`${file.name} を読み込めませんでした`, 'error');
    }
  }
  imAfterAdd_(added);
}

// ---------- 取り込み方法2：貼り付け ----------
function imHandlePaste() {
  const ta = document.getElementById('im-paste');
  const text = ta.value;
  if (!text.trim()) { showToast('文章を貼り付けてください', 'error'); return; }
  let items;
  const trimmed = text.trim();
  if (/^[\[{]/.test(trimmed)) { try { items = imItemsFromJson_(trimmed, imDefaultYear_()); } catch (e) { items = []; } }
  else items = imItemsFromText_(text, imDefaultYear_());
  if (!items.length) {
    // 日付行が無い文章は、1件の日記として扱う（日付は後で入力）
    items = [imMakeItem_({ content: text, source: '貼り付け' })];
  }
  const added = imAddItems_(items);
  if (added) ta.value = '';
  imAfterAdd_(added);
}

// ---------- 取り込み方法3：写真（Geminiで読み取り） ----------
async function imHandleImages(e) {
  const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
  e.target.value = '';
  if (!files.length) return;
  if (imBusy) { showToast('処理中です。しばらくお待ちください', 'error'); return; }
  const attach = document.getElementById('im-attach-original').checked;
  const status = document.getElementById('im-photo-status');
  imBusy = true;
  let added = 0, failed = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    status.innerHTML = `<span class="loading-spinner"></span> 写真を読み取っています（${i + 1} / ${files.length}）… ${escHtml(file.name)}`;
    try {
      const img = await resizeImageFile(file);
      const res = await imPost_({
        action: 'parseDiaryImage', token: Auth.getToken(),
        image: img.data, mimeType: img.mimeType,
        defaultYear: imDefaultYear_(),
        hintDate: imDateFromFilename_(file.name)
      }, 120000, 1);
      if (!res.success) throw new Error(res.error || '読み取りに失敗しました');
      const entries = (res.entries || []).map(en => {
        const dt = imParseDate_(en.date, imDefaultYear_());
        return imMakeItem_({
          date: dt ? dt.date : '', time: dt ? dt.time : '',
          title: en.title, content: en.content, mood: en.mood, tags: en.tags,
          source: '写真',
          photos: attach ? [img] : []
        });
      }).filter(it => it.content || it.title);
      if (!entries.length) { failed++; showToast(`${file.name}：日記の文章が見つかりませんでした`, 'error'); continue; }
      added += imAddItems_(entries);
    } catch (err) {
      failed++;
      showToast(`${file.name}：${err.message === 'Timeout' ? '時間切れになりました' : err.message}`, 'error');
    }
  }
  status.textContent = failed ? `読み取り完了（${failed}枚は読み取れませんでした）` : '';
  imBusy = false;
  imAfterAdd_(added);
}

// ---------- 候補一覧への追加 ----------
function imAddItems_(items) {
  const room = IM_MAX_ITEMS - imItems.length;
  if (room <= 0) { showToast(`一度に取り込めるのは${IM_MAX_ITEMS}件までです`, 'error'); return 0; }
  const list = items.slice(0, room);
  list.forEach(it => { if (imDuplicateOf_(it)) it.include = false; }); // 重複らしいものは最初から外しておく
  if (items.length > room) showToast(`${IM_MAX_ITEMS}件を超えた分は読み込みませんでした`, 'error');
  imItems.push(...list);
  return list.length;
}

function imAfterAdd_(added) {
  if (added) showToast(`${added}件を読み込みました。内容を確認して「取り込む」を押してください`);
  else if (added === 0) showToast('日記が見つかりませんでした', 'error');
  imSortItems_();
  imRender();
  const box = document.getElementById('im-preview');
  if (added && box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function imSortItems_() {
  // 日付未入力を先頭に、その後は古い日付から
  imItems.sort((a, b) => {
    if (!a.date && b.date) return -1;
    if (a.date && !b.date) return 1;
    return (a.date + a.time).localeCompare(b.date + b.time);
  });
}

// ---------- 既存の日記との重複チェック ----------
function imDuplicateOf_(it) {
  if (!it.date || typeof allMyDiaries === 'undefined') return null;
  return allMyDiaries.find(d => localDateKey_(d.createdAt) === it.date &&
    (String(d.title || '').trim() === it.title.trim() ||
     String(d.content || '').trim().slice(0, 40) === it.content.trim().slice(0, 40))) || null;
}

// ---------- 一覧の描画 ----------
function imRender() {
  const box = document.getElementById('im-preview');
  if (!box) return;
  if (!imItems.length) { box.innerHTML = ''; return; }

  const selected = imItems.filter(it => it.include).length;
  const noDate = imItems.filter(it => it.include && !it.date).length;

  const rows = imItems.map((it, idx) => {
    const dup = imDuplicateOf_(it);
    const warn = [];
    if (!it.date) warn.push('<span class="im-warn">📅 日付を入れてください</span>');
    if (!it.content) warn.push('<span class="im-warn">本文がありません</span>');
    if (dup) warn.push('<span class="im-warn im-warn-soft">⚠️ 同じ日に似た日記があります（重複？）</span>');
    return `
      <div class="im-row${it.include ? '' : ' excluded'}${it.error ? ' has-error' : ''}" id="im-row-${it.uid}">
        <div class="im-row-head">
          <label class="im-check"><input type="checkbox" ${it.include ? 'checked' : ''} onchange="imSet('${it.uid}','include',this.checked,true)"> 取り込む</label>
          <input type="date" class="im-date" value="${it.date}" onchange="imSet('${it.uid}','date',this.value,true)">
          <input type="time" class="im-time" value="${it.time}" onchange="imSet('${it.uid}','time',this.value)" title="時刻（空欄なら12:00）">
          <span class="im-src">${escHtml(it.source)}</span>
          <button type="button" class="im-del" onclick="imRemove('${it.uid}')" title="一覧から外す">✕</button>
        </div>
        ${warn.length || it.error ? `<div class="im-warns">${warn.join('')}${it.error ? `<span class="im-warn">❌ ${escHtml(it.error)}</span>` : ''}</div>` : ''}
        <input type="text" class="im-title" maxlength="100" placeholder="タイトル" value="${escHtml(it.title)}" oninput="imSet('${it.uid}','title',this.value)">
        <textarea class="im-content" rows="4" placeholder="本文" oninput="imSet('${it.uid}','content',this.value)">${escHtml(it.content)}</textarea>
        <div class="im-row-foot">
          <select onchange="imSet('${it.uid}','mood',this.value)">${IM_MOODS.map(m => `<option ${m === it.mood ? 'selected' : ''}>${m}</option>`).join('')}</select>
          <input type="text" class="im-tags" placeholder="タグ（カンマ区切り）" value="${escHtml(it.tags)}" oninput="imSet('${it.uid}','tags',this.value)">
          <label class="im-check"><input type="checkbox" ${it.isPublic ? 'checked' : ''} onchange="imSet('${it.uid}','isPublic',this.checked)"> 🌐 公開</label>
        </div>
        <div class="im-photos">
          ${it.photos.map((p, pi) => `
            <div class="im-photo"><img src="data:${p.mimeType};base64,${p.data}" alt="">
              <button type="button" onclick="imRemovePhoto('${it.uid}',${pi})">✕</button></div>`).join('')}
          ${it.photos.length < IM_MAX_PHOTOS ? `
            <label class="im-photo-add">📷 写真を追加
              <input type="file" accept="image/*" multiple hidden onchange="imAddPhotos(event,'${it.uid}')">
            </label>` : ''}
        </div>
      </div>`;
  }).join('');

  box.innerHTML = `
    <div class="im-toolbar">
      <strong>取り込み候補 ${imItems.length}件</strong>（選択中 ${selected}件${noDate ? `・<span class="im-warn-text">日付なし ${noDate}件</span>` : ''}）
      <div class="im-toolbar-btns">
        <button type="button" class="rc-btn" onclick="imSetAll('include',true)">すべて選択</button>
        <button type="button" class="rc-btn" onclick="imSetAll('include',false)">すべて外す</button>
        <button type="button" class="rc-btn" onclick="imSetAll('isPublic',true)">🌐 すべて公開</button>
        <button type="button" class="rc-btn" onclick="imSetAll('isPublic',false)">🔒 すべて非公開</button>
        <label class="rc-btn im-bulk-photo" title="ファイル名の日付（例：IMG_20260809_…）で自動的に振り分けます">📷 写真をまとめて振り分け
          <input type="file" accept="image/*" multiple hidden onchange="imBulkPhotos(event)">
        </label>
        <button type="button" class="rc-btn" onclick="imClear()">🗑️ 候補をすべて消す</button>
      </div>
    </div>
    ${rows}
    <div class="im-submit">
      <div id="im-progress" class="im-progress" style="display:none"><div id="im-progress-bar"></div></div>
      <p id="im-progress-text" class="im-progress-text"></p>
      <button type="button" id="im-submit-btn" class="btn-primary" onclick="imSubmit()">📥 選択した${selected}件を取り込む</button>
    </div>`;
}

function imFind_(uid) { return imItems.find(it => it.uid === uid); }

// 入力のたびに全体を描き直すと入力中の欄からカーソルが外れるため、必要なときだけ再描画
function imSet(uid, key, value, rerender = false) {
  const it = imFind_(uid);
  if (!it) return;
  it[key] = value;
  if (key === 'content' && !it.titleTouched && !it.title) it.title = imMakeTitle_(value);
  if (key === 'title') it.titleTouched = true;
  if (rerender) imRender();
}

function imSetAll(key, value) { imItems.forEach(it => { it[key] = value; }); imRender(); }

function imRemove(uid) { imItems = imItems.filter(it => it.uid !== uid); imRender(); }

function imClear() {
  if (!imItems.length || !confirm('取り込み候補をすべて消しますか？')) return;
  imItems = [];
  imRender();
}

function imRemovePhoto(uid, idx) {
  const it = imFind_(uid);
  if (!it) return;
  it.photos.splice(idx, 1);
  imRender();
}

async function imAddPhotos(e, uid) {
  const it = imFind_(uid);
  const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
  e.target.value = '';
  if (!it || !files.length) return;
  if (it.photos.length + files.length > IM_MAX_PHOTOS) { showToast(`写真は1件につき${IM_MAX_PHOTOS}枚までです`, 'error'); return; }
  for (const f of files) {
    try { it.photos.push(await resizeImageFile(f)); } catch (err) { /* スキップ */ }
  }
  imRender();
}

// ファイル名の日付で、同じ日付の候補へ写真を自動で振り分ける
async function imBulkPhotos(e) {
  const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
  e.target.value = '';
  if (!files.length) return;
  let ok = 0;
  const unmatched = [], full = [];
  for (const f of files) {
    const date = imDateFromFilename_(f.name);
    const it = date && imItems.find(x => x.date === date && x.photos.length < IM_MAX_PHOTOS);
    if (!date || !it) {
      (date && imItems.some(x => x.date === date) ? full : unmatched).push(f.name);
      continue;
    }
    try { it.photos.push(await resizeImageFile(f)); ok++; } catch (err) { unmatched.push(f.name); }
  }
  imRender();
  let msg = `${ok}枚の写真を振り分けました`;
  if (unmatched.length) msg += `（${unmatched.length}枚は日付が合う日記がありません）`;
  if (full.length) msg += `（${full.length}枚は${IM_MAX_PHOTOS}枚の上限を超えました）`;
  showToast(msg, unmatched.length || full.length ? 'error' : 'success');
}

// ---------- サーバーへ送信 ----------
async function imSubmit() {
  if (imBusy) return;
  const targets = imItems.filter(it => it.include);
  if (!targets.length) { showToast('取り込む日記を選んでください', 'error'); return; }
  const bad = targets.find(it => !it.date || !it.content.trim() || !it.title.trim());
  if (bad) {
    showToast('日付・タイトル・本文が入っていない日記があります', 'error');
    document.getElementById('im-row-' + bad.uid)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (!confirm(`${targets.length}件の日記を取り込みます。よろしいですか？`)) return;
  targets.forEach(it => { delete it.error; });

  // 写真なしは20件ずつまとめて、写真ありは1件ずつ送る（1回の通信を軽くするため）
  const batches = [];
  let textBatch = [];
  targets.forEach(it => {
    if (it.photos.length) batches.push([it]);
    else {
      textBatch.push(it);
      if (textBatch.length >= 20) { batches.push(textBatch); textBatch = []; }
    }
  });
  if (textBatch.length) batches.push(textBatch);

  imBusy = true;
  const btn = document.getElementById('im-submit-btn');
  const bar = document.getElementById('im-progress');
  const barInner = document.getElementById('im-progress-bar');
  const txt = document.getElementById('im-progress-text');
  btn.disabled = true;
  bar.style.display = 'block';

  let done = 0, saved = 0, skipped = 0, failed = 0;
  const doneUids = new Set();
  for (const batch of batches) {
    txt.textContent = `取り込み中… ${done} / ${targets.length}件${batch[0].photos.length ? '（写真をアップロード中）' : ''}`;
    try {
      const res = await imPost_({
        action: 'importDiaries',
        token: Auth.getToken(),
        entries: batch.map(it => ({
          diaryId: it.uid, date: it.date, time: it.time || '12:00',
          title: it.title.trim(), content: it.content.trim(), mood: it.mood,
          tags: it.tags.trim(), isPublic: it.isPublic, photos: it.photos
        }))
      });
      if (!res.success) throw new Error(res.error || '取り込みに失敗しました');
      (res.results || []).forEach(r => {
        const it = imFind_(r.diaryId);
        if (!it) return;
        if (r.status === 'saved' || r.status === 'exists') {
          doneUids.add(it.uid);
          r.status === 'saved' ? saved++ : skipped++;
        } else { it.error = r.error || '保存できませんでした'; failed++; }
      });
    } catch (err) {
      batch.forEach(it => { it.error = err.message === 'Timeout' ? '時間切れ（もう一度お試しください）' : err.message; });
      failed += batch.length;
      if (/ログイン|セッション|認証/.test(err.message)) break;
    }
    done += batch.length;
    barInner.style.width = Math.round(done / targets.length * 100) + '%';
  }

  imItems = imItems.filter(it => !doneUids.has(it.uid));
  imBusy = false;
  let msg = `✅ ${saved}件を取り込みました`;
  if (skipped) msg += `（取り込み済み${skipped}件）`;
  if (failed) msg += `／❌ ${failed}件は失敗しました（一覧に残しています）`;
  showToast(msg, failed ? 'error' : 'success');
  imRender();
  const summary = document.getElementById('im-result');
  if (summary) summary.textContent = msg;

  // 日記キャッシュを更新（同じ日・ランダム・マイ日記に反映）
  if (typeof ensureMyDiaries === 'function') await ensureMyDiaries(true);
  if (typeof loadMyDiaries === 'function') loadMyDiaries();
}

// ---------- CSVのひな形ダウンロード ----------
function imDownloadSample() {
  const csv = '\uFEFF日付,タイトル,本文,気分,タグ,公開\n' +
    '2024/08/09,夏祭り,"孫と夏祭りに行った。\n金魚すくいで3匹とれた。",😊,家族,非公開\n' +
    '2025年1月1日,初日の出,"近所の丘から初日の出を見た。",🤔,お正月,公開\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '10nen-nikki-sample.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 取り込みタブを開いたとき
async function renderImportTab() {
  const y = document.getElementById('im-default-year');
  if (y && !y.value) y.value = new Date().getFullYear();
  if (typeof ensureMyDiaries === 'function') await ensureMyDiaries(); // 重複チェック用
  imRender();
}
