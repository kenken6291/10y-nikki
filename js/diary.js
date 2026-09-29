// ===== 日記フィード =====
let currentGenFilter = '';
let currentTagFilter = '';
let currentDiaries   = [];

// ログイン／ログアウト時に呼び出し、このタブ内に残る日記関連キャッシュを
// すべて破棄する（同一タブでアカウントを切り替えた場合に、前のユーザーの
// 日記・写真が一瞬でも表示され続けることを防ぐための対策）
function resetDiaryCaches() {
  currentDiaries = [];
  allMyDiaries = [];
  photoCache = {};
  postPhotos = [];
  editPhotos = [];
  editExistingPhotos = [];
}

// ===== 写真アップロード（Googleドライブ保存） =====
const MAX_PHOTOS = 5;
const MAX_PHOTO_EDGE = 1600;   // リサイズ後の最大辺(px)
const PHOTO_JPEG_QUALITY = 0.8;

// 選択中の新規写真（{name, mimeType, data(base64 dataURLなし)}）
let postPhotos = [];
let editPhotos = [];
// 編集時：既存写真のうち残すものを保持（{fileId,mimeType}一覧）
let editExistingPhotos = [];

// 画像ファイルをCanvasでリサイズ・圧縮してbase64に変換
function resizeImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_PHOTO_EDGE || height > MAX_PHOTO_EDGE) {
          const scale = MAX_PHOTO_EDGE / Math.max(width, height);
          width  = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY);
        resolve({
          name: (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg',
          mimeType: 'image/jpeg',
          data: dataUrl.split(',')[1] // base64本体のみ（先頭のdata:...;base64,を除く）
        });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ファイル選択時：リサイズしてプレビューに追加
async function handlePhotoSelect(e, mode) {
  const files = Array.from(e.target.files || []);
  const targetArr = mode === 'edit' ? editPhotos : postPhotos;
  const existingCount = mode === 'edit' ? editExistingPhotos.length : 0;
  if (targetArr.length + existingCount + files.length > MAX_PHOTOS) {
    showToast(`写真は合計${MAX_PHOTOS}枚までです`, 'error');
    e.target.value = '';
    return;
  }
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const resized = await resizeImageFile(file);
      targetArr.push(resized);
    } catch (err) { /* 変換失敗はスキップ */ }
  }
  e.target.value = '';
  renderPhotoPreview(mode);
}

function renderPhotoPreview(mode) {
  const arr = mode === 'edit' ? editPhotos : postPhotos;
  const previewId = mode === 'edit' ? 'edit-photo-preview' : 'post-photo-preview';
  const el = document.getElementById(previewId);
  if (!el) return;
  el.innerHTML = arr.map((p, i) => `
    <div class="photo-thumb-wrap">
      <img src="data:${p.mimeType};base64,${p.data}" class="photo-thumb">
      <button type="button" class="photo-thumb-remove" onclick="removeNewPhoto('${mode}', ${i})">✕</button>
    </div>
  `).join('');
}

function removeNewPhoto(mode, index) {
  const arr = mode === 'edit' ? editPhotos : postPhotos;
  arr.splice(index, 1);
  renderPhotoPreview(mode);
}

// 編集モーダル：既存写真（{fileId,mimeType}）のプレビュー（権限チェック付き取得）
async function renderExistingPhotoPreview(diaryId) {
  const el = document.getElementById('edit-photo-existing');
  if (!el) return;
  if (!editExistingPhotos.length) { el.innerHTML = ''; return; }
  el.innerHTML = editExistingPhotos.map((p, i) =>
    `<div class="photo-thumb-wrap" id="ephoto-${i}"><div class="photo-thumb loading"></div>
      <button type="button" class="photo-thumb-remove" onclick="removeExistingPhoto(${i})">✕</button>
    </div>`
  ).join('');
  for (let i = 0; i < editExistingPhotos.length; i++) {
    const dataUri = await fetchPhoto(diaryId, editExistingPhotos[i].fileId);
    const wrap = document.getElementById(`ephoto-${i}`);
    if (wrap && dataUri) wrap.querySelector('.photo-thumb').outerHTML = `<img src="${dataUri}" class="photo-thumb">`;
  }
}

function removeExistingPhoto(index) {
  editExistingPhotos.splice(index, 1);
  renderExistingPhotoPreview(document.getElementById('edit-modal').dataset.diaryId);
}

// 日記カード・詳細モーダル用：写真ギャラリーHTML生成（プレースホルダーを出し、非同期で権限チェック付き取得）
function renderPhotoGallery(diaryId, photos) {
  const list = parsePhotos(photos);
  if (!list.length) return '';
  const html = `<div class="photo-gallery">${list.map((p, i) =>
    `<div class="gallery-thumb loading" id="gphoto-${diaryId}-${i}"></div>`
  ).join('')}</div>`;
  // レンダリング後に非同期で画像を取得（DOM挿入後に実行するため0msタイマー）
  setTimeout(() => loadGalleryPhotos(diaryId, list), 0);
  return html;
}

async function loadGalleryPhotos(diaryId, list) {
  for (let i = 0; i < list.length; i++) {
    const el = document.getElementById(`gphoto-${diaryId}-${i}`);
    if (!el) continue;
    const dataUri = await fetchPhoto(diaryId, list[i].fileId);
    if (!dataUri) { el.remove(); continue; }
    el.classList.remove('loading');
    el.innerHTML = `<img src="${dataUri}" onclick="event.stopPropagation();openPhotoLightbox('${dataUri.replace(/'/g,"\\'")}')">`;
  }
}

// 権限チェック付きで1枚取得（本人・管理者・公開日記のみ許可されサーバー側で判定）
let photoCache = {};
async function fetchPhoto(diaryId, fileId) {
  const cacheKey = diaryId + ':' + fileId;
  if (photoCache[cacheKey]) return photoCache[cacheKey];
  try {
    const res = await Auth.post({ action: 'getPhoto', token: Auth.getToken(), diaryId, fileId });
    if (!res.success) return null;
    const dataUri = `data:${res.mimeType};base64,${res.data}`;
    photoCache[cacheKey] = dataUri;
    return dataUri;
  } catch (e) { return null; }
}

// sheetに保存されている形式（[{fileId,mimeType}] のJSON文字列）をパース
function parsePhotos(photos) {
  if (!photos) return [];
  if (Array.isArray(photos)) return photos.filter(p => p && p.fileId);
  if (typeof photos === 'string') {
    const s = photos.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.filter(p => p && p.fileId);
    } catch (e) { /* 不正な形式は無視 */ }
  }
  return [];
}

function openPhotoLightbox(dataUri) {
  let overlay = document.getElementById('photo-lightbox');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'photo-lightbox';
    overlay.className = 'lightbox-overlay';
    overlay.onclick = () => overlay.style.display = 'none';
    overlay.innerHTML = '<img id="lightbox-img">';
    document.body.appendChild(overlay);
  }
  document.getElementById('lightbox-img').src = dataUri;
  overlay.style.display = 'flex';
}

async function loadDiaries() {
  const container = document.getElementById('diary-feed');
  if (!container) return;
  showLoading(container, '日記を開いています...');
  try {
    const params = { action: 'getDiaries' };
    if (currentGenFilter) params.generation = currentGenFilter;
    if (currentTagFilter) params.tag = currentTagFilter;
    const res = await Auth.get(params);
    if (res.success) {
      currentDiaries = res.diaries;
      renderDiaries(res.diaries, container);
    } else {
      container.innerHTML = '<p class="empty-msg">日記の読み込みに失敗しました。</p>';
    }
  } catch(e) {
    container.innerHTML = '<p class="empty-msg">接続エラーが発生しました。</p>';
  }
}

function renderDiaries(diaries, container) {
  if (!diaries.length) {
    container.innerHTML = '<p class="empty-msg">まだ日記がありません。最初の一筆を綴りましょう。</p>';
    return;
  }
  container.innerHTML = diaries.map(d => `
    <article class="diary-card" onclick="openDiaryDetail('${escJsAttr(d.diaryId)}')">
      <div class="card-header">
        <span class="card-mood">${d.mood || '😊'}</span>
        <span class="card-nickname">${escHtml(d.nickname)}</span>
        ${d.birthYear ? `<span class="gen-badge">${birthYearToGeneration(d.birthYear)}</span>` : ''}
        <span class="card-date">${formatDate(d.createdAt)}</span>
      </div>
      <h3 class="card-title">${escHtml(d.title)}</h3>
      ${renderPhotoGallery(d.diaryId, d.photos)}
      <p class="card-preview">${escHtml((d.content || '').substring(0, 100))}${d.content && d.content.length > 100 ? '…' : ''}</p>
      ${d.tags ? `<div class="card-tags">${d.tags.split(',').map(t=>`<span class="tag">${escHtml(t.trim())}</span>`).join('')}</div>` : ''}
      <div class="card-footer">
        <span class="stat-btn">❤️ ${d.likeCount || 0}</span>
        <span class="stat-btn">💬 ${d.commentCount || 0}</span>
      </div>
    </article>
  `).join('');
}

// ===== 世代フィルター =====
function renderGenFilter(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = GENERATION_OPTIONS.map(o =>
    `<button class="gen-tab${currentGenFilter === o.value ? ' active' : ''}" onclick="setGenFilter('${o.value}')">${o.label}</button>`
  ).join('');
}

function setGenFilter(val) {
  currentGenFilter = val;
  renderGenFilter('gen-filter');
  loadDiaries();
}

// ===== 日記詳細モーダル =====
let currentDiaryId = '';
async function openDiaryDetail(diaryId) {
  currentDiaryId = diaryId;
  const modal = document.getElementById('diary-modal');
  const body  = document.getElementById('modal-body');
  if (!modal || !body) return;
  modal.style.display = 'flex';
  showLoading(body, '日記を読み込んでいます...');
  try {
    const res = await Auth.get({ action: 'getDiaryDetail', diaryId, token: Auth.getToken() || '' });
    if (!res.success) { body.innerHTML = '<p>読み込みエラー</p>'; return; }
    const d = res.diary;
    const myId = Auth.getMemberId();
    const isOwner = d.memberId === myId;
    const alreadyLiked = res.likes.some(l => l.memberId === myId);

    body.innerHTML = `
      <div class="modal-diary">
        <div class="modal-meta">
          <span class="card-mood">${d.mood || '😊'}</span>
          <strong>${escHtml(d.nickname)}</strong>
          <span class="card-date">${formatDate(d.createdAt)}</span>
          ${d.updatedAt && d.updatedAt !== d.createdAt ? `<span class="updated-badge">編集済</span>` : ''}
        </div>
        <h2 class="modal-title">${escHtml(d.title)}</h2>
        ${renderPhotoGallery(d.diaryId, d.photos)}
        <div class="modal-content">${escHtml(d.content).replace(/\n/g,'<br>')}</div>
        ${d.tags ? `<div class="card-tags">${d.tags.split(',').map(t=>`<span class="tag">${escHtml(t.trim())}</span>`).join('')}</div>` : ''}

        <div class="like-section">
          ${Auth.isLoggedIn() ? `
            <button class="like-btn${alreadyLiked ? ' liked' : ''}" onclick="toggleLike('${escJsAttr(d.diaryId)}', this)">
              ${alreadyLiked ? '❤️' : '🤍'} いいね ${res.likes.length}
            </button>
          ` : `<span class="like-count">❤️ ${res.likes.length}</span>`}
          ${isOwner ? `
            <button class="btn-edit" onclick="openEditModal('${escJsAttr(d.diaryId)}')">✏️ 編集</button>
            <button class="btn-delete-sm" onclick="deleteDiary('${escJsAttr(d.diaryId)}')">🗑️ 削除</button>
          ` : ''}
        </div>

        <div class="comments-section">
          <h4>💬 コメント（${res.comments.length}件）</h4>
          <div id="comments-list">
            ${renderComments(res.comments)}
          </div>
          ${Auth.isLoggedIn() ? `
            <div class="comment-form">
              <textarea id="comment-input" placeholder="コメントを書く..." rows="3"></textarea>
              <button onclick="postComment('${escJsAttr(d.diaryId)}')">送信</button>
            </div>
          ` : '<p class="login-prompt"><a href="index.html">ログイン</a>してコメントする</p>'}
        </div>
      </div>
    `;
  } catch(e) {
    body.innerHTML = '<p>読み込みエラーが発生しました。</p>';
  }
}

function renderComments(comments) {
  if (!comments.length) return '<p class="empty-msg-sm">まだコメントはありません。</p>';
  return comments.map(c => `
    <div class="comment-item">
      <div class="comment-meta">
        <strong>${escHtml(c.nickname)}</strong>
        <span>${formatDate(c.createdAt)}</span>
        ${c.memberId === Auth.getMemberId() ? `<button class="btn-delete-xs" onclick="deleteComment('${escJsAttr(c.commentId)}')">削除</button>` : ''}
      </div>
      <p>${escHtml(c.content).replace(/\n/g,'<br>')}</p>
    </div>
  `).join('');
}

function closeModal() {
  const modal = document.getElementById('diary-modal');
  if (modal) modal.style.display = 'none';
}

// ===== いいね =====
async function toggleLike(diaryId, btn) {
  if (!Auth.isLoggedIn()) { showToast('ログインが必要です', 'error'); return; }
  btn.disabled = true;
  btn.classList.add('like-anim');
  setTimeout(() => btn.classList.remove('like-anim'), 400);
  try {
    const res = await Auth.post({ action: 'toggleLike', token: Auth.getToken(), diaryId });
    if (res.success) {
      const liked = res.action === 'liked';
      const countMatch = btn.textContent.match(/\d+/);
      const count = countMatch ? parseInt(countMatch[0]) + (liked ? 1 : -1) : 0;
      btn.innerHTML = `${liked ? '❤️' : '🤍'} いいね ${count}`;
      btn.classList.toggle('liked', liked);
    }
  } catch(e) { showToast('エラーが発生しました', 'error'); }
  btn.disabled = false;
}

// ===== コメント =====
async function postComment(diaryId) {
  const input = document.getElementById('comment-input');
  const content = input ? input.value.trim() : '';
  if (!content) { showToast('コメントを入力してください', 'error'); return; }
  try {
    const res = await Auth.post({ action: 'postComment', token: Auth.getToken(), diaryId, content });
    if (res.success) {
      showToast('コメントを投稿しました');
      input.value = '';
      const r2 = await Auth.post({ action: 'getComments', token: Auth.getToken(), diaryId });
      if (r2.success) {
        document.getElementById('comments-list').innerHTML = renderComments(r2.comments);
      }
    } else {
      showToast(res.error || 'エラーが発生しました', 'error');
    }
  } catch(e) { showToast('エラーが発生しました', 'error'); }
}

async function deleteComment(commentId) {
  if (!confirm('このコメントを削除しますか？')) return;
  try {
    const res = await Auth.post({ action: 'deleteComment', token: Auth.getToken(), commentId });
    if (res.success) { showToast('コメントを削除しました'); openDiaryDetail(currentDiaryId); }
    else showToast(res.error || 'エラー', 'error');
  } catch(e) { showToast('エラーが発生しました', 'error'); }
}

// ===== マイ日記 =====
let allMyDiaries = []; // 「同じ日」「ランダム」タブで再利用するためのキャッシュ
async function loadMyDiaries() {
  const container = document.getElementById('my-diaries');
  if (!container) return;
  showLoading(container, 'マイ日記を開いています...');
  try {
    const res = await Auth.post({ action: 'getMyDiaries', token: Auth.getToken() });
    if (res.success) {
      allMyDiaries = res.diaries;
      renderMyDiaries(res.diaries, container);
    }
    else container.innerHTML = '<p class="empty-msg">読み込みに失敗しました。</p>';
  } catch(e) { container.innerHTML = '<p class="empty-msg">接続エラー</p>'; }
}

function renderMyDiaries(diaries, container) {
  if (!diaries.length) {
    container.innerHTML = '<p class="empty-msg">まだ日記がありません。最初の一筆を綴りましょう。</p>';
    return;
  }
  container.innerHTML = diaries.map(d => `
    <article class="diary-card my-diary-card" onclick="openDiaryDetail('${escJsAttr(d.diaryId)}')">
      <div class="card-header">
        <span class="card-mood">${d.mood || '😊'}</span>
        <span class="card-date">${formatDate(d.createdAt)}</span>
        <span class="visibility-badge">${d.isPublic ? '🌐 公開' : '🔒 非公開'}</span>
      </div>
      <h3 class="card-title">${escHtml(d.title)}</h3>
      ${renderPhotoGallery(d.diaryId, d.photos)}
      <p class="card-preview">${escHtml((d.content || '').substring(0,80))}…</p>
      ${d.tags ? `<div class="card-tags">${d.tags.split(',').map(t=>`<span class="tag">${escHtml(t.trim())}</span>`).join('')}</div>` : ''}
      <div class="card-footer">
        <span class="stat-btn">❤️ ${d.likeCount||0}</span>
        <span class="stat-btn">💬 ${d.commentCount||0}</span>
        <button class="btn-edit-sm" onclick="event.stopPropagation(); openEditModal('${escJsAttr(d.diaryId)}')">✏️</button>
        <button class="btn-delete-xs" onclick="event.stopPropagation(); deleteDiary('${escJsAttr(d.diaryId)}')">🗑️</button>
      </div>
    </article>
  `).join('');
}

// ===== 日記投稿 =====
async function submitDiary(e) {
  e.preventDefault();
  const title   = document.getElementById('diary-title').value.trim();
  const content = document.getElementById('diary-content').value.trim();
  const mood    = document.getElementById('diary-mood').value;
  const tags    = document.getElementById('diary-tags').value.trim();
  const isPublic = document.getElementById('diary-public').checked;
  if (!title || !content) { showToast('タイトルと本文は必須です', 'error'); return; }
  const btn = document.getElementById('submit-diary-btn');
  btn.disabled = true; btn.textContent = postPhotos.length ? '写真をアップロード中...' : '投稿中...';
  try {
    const res = await Auth.post({ action: 'postDiary', token: Auth.getToken(), title, content, mood, tags, isPublic, photos: postPhotos });
    if (res.success) {
      showToast('日記を投稿しました ✨');
      document.getElementById('diary-form').reset();
      postPhotos = [];
      renderPhotoPreview('post');
      loadMyDiaries();
    } else showToast(res.error || 'エラー', 'error');
  } catch(e) { showToast('エラーが発生しました', 'error'); }
  btn.disabled = false; btn.textContent = '投稿する';
}

// ===== 編集モーダル =====
function openEditModal(diaryId) {
  // 「マイ日記」タブ（allMyDiaries）と「みんなの日記」タブ（currentDiaries）の
  // どちらから開かれても見つかるよう両方を探す（片方だけだと空欄になる不具合があった）
  const diary = currentDiaries.find(d => d.diaryId === diaryId)
             || allMyDiaries.find(d => d.diaryId === diaryId)
             || {};
  const modal = document.getElementById('edit-modal');
  if (!modal) return;
  modal.dataset.diaryId = diaryId;
  document.getElementById('edit-title').value   = diary.title || '';
  document.getElementById('edit-content').value = diary.content || '';
  document.getElementById('edit-mood').value    = diary.mood || '😊';
  document.getElementById('edit-tags').value    = diary.tags || '';
  document.getElementById('edit-public').checked = diary.isPublic !== false;
  editPhotos = [];
  editExistingPhotos = parsePhotos(diary.photos);
  renderExistingPhotoPreview(diaryId);
  renderPhotoPreview('edit');
  modal.style.display = 'flex';
}

async function submitEdit() {
  const modal = document.getElementById('edit-modal');
  const diaryId = modal.dataset.diaryId;
  const title   = document.getElementById('edit-title').value.trim();
  const content = document.getElementById('edit-content').value.trim();
  const mood    = document.getElementById('edit-mood').value;
  const tags    = document.getElementById('edit-tags').value.trim();
  const isPublic = document.getElementById('edit-public').checked;
  try {
    const res = await Auth.post({
      action: 'updateDiary', token: Auth.getToken(), diaryId, title, content, mood, tags, isPublic,
      existingPhotos: editExistingPhotos.map(p => p.fileId), // 残す既存写真のfileId一覧
      photos: editPhotos                                     // 新規追加する写真（base64）
    });
    if (res.success) {
      showToast('日記を更新しました');
      modal.style.display = 'none';
      loadMyDiaries();
      loadDiaries();
    } else showToast(res.error || 'エラー', 'error');
  } catch(e) { showToast('エラー', 'error'); }
}

async function deleteDiary(diaryId) {
  if (!confirm('この日記を削除しますか？元に戻せません。')) return;
  try {
    const res = await Auth.post({ action: 'deleteDiary', token: Auth.getToken(), diaryId });
    if (res.success) {
      showToast('日記を削除しました');
      closeModal();
      loadMyDiaries();
      loadDiaries();
    } else showToast(res.error || 'エラー', 'error');
  } catch(e) { showToast('エラー', 'error'); }
}

// ===== 自分の日記キャッシュを確実に用意する（「同じ日」「ランダム」タブ共通） =====
async function ensureMyDiaries(force = false) {
  if (force || !allMyDiaries.length) {
    try {
      const res = await Auth.post({ action: 'getMyDiaries', token: Auth.getToken() });
      if (res.success) allMyDiaries = res.diaries || [];
    } catch (e) { /* 呼び出し側で0件表示になる */ }
  }
  return allMyDiaries;
}

// ===== 振り返り表示の共通ヘルパー =====
const WDAYS = ['日','月','火','水','木','金','土'];
const WDAYS_LONG = ['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'];

function pad2_(n) { return String(n).padStart(2, '0'); }

// createdAt → 端末ローカル時刻での 'YYYY-MM-DD'
function localDateKey_(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${pad2_(d.getMonth() + 1)}-${pad2_(d.getDate())}`;
}

// 日記を 'YYYY-MM-DD' ごとにまとめる（同じ日に複数書いた場合は時刻の古い順）
function groupDiariesByDate_(diaries) {
  const map = {};
  diaries.forEach(d => {
    const k = localDateKey_(d.createdAt);
    if (!k) return;
    (map[k] = map[k] || []).push(d);
  });
  Object.values(map).forEach(arr => arr.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
  return map;
}

// 何年前・何か月前・何日前のラベル
function agoLabel_(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const days = Math.round((now - then) / 86400000);
  if (days <= 0) return '今日';
  if (days < 31) return `${days}日前`;
  let years = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) years--;
  if (years >= 1) return `${years}年前`;
  const months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m) - (now.getDate() < d ? 1 : 0);
  return `${Math.max(1, months)}か月前`;
}

// 振り返り表示専用の写真ギャラリー
// （マイ日記タブ等と同じ日記を同時に描画してもIDが重複しないよう、表示ごとに接頭辞を分ける）
let rcGallerySeq = 0;
function rcGalleryHtml_(d) {
  const list = parsePhotos(d.photos);
  if (!list.length) return '';
  const prefix = `rcg${++rcGallerySeq}`;
  setTimeout(async () => {
    for (let i = 0; i < list.length; i++) {
      const el = document.getElementById(`${prefix}-${i}`);
      if (!el) continue;
      const dataUri = await fetchPhoto(d.diaryId, list[i].fileId);
      if (!dataUri) { el.remove(); continue; }
      el.classList.remove('loading');
      el.innerHTML = `<img src="${dataUri}" alt="" onclick="event.stopPropagation();openPhotoLightbox(this.src)">`;
    }
  }, 0);
  return `<div class="rc-photos">${list.map((_, i) => `<div class="rc-photo loading" id="${prefix}-${i}"></div>`).join('')}</div>`;
}

// 日記1件の中身（タイトル・本文・写真）
function rcDiaryContentHtml_(d) {
  return `
    <div class="rc-diary" onclick="event.stopPropagation();openDiaryDetail('${escJsAttr(d.diaryId)}')">
      <div class="rc-diary-title">${escHtml(d.title)}${d.isPublic ? '' : ' <span class="rc-lock">🔒</span>'}</div>
      <div class="rc-diary-body">${escHtml(d.content || '')}</div>
      ${rcGalleryHtml_(d)}
      ${d.tags ? `<div class="card-tags">${d.tags.split(',').filter(t => t.trim()).map(t => `<span class="tag">${escHtml(t.trim())}</span>`).join('')}</div>` : ''}
    </div>`;
}

// タイムライン形式（大きな日付見出し＋本文＋写真＋曜日）で1日分を描画
function rcTimelineDayHtml_(dateKey, list, opts = {}) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const moods = list.map(x => x.mood || '😊').join(' ');
  return `
    <article class="rc-tl-item">
      <h3 class="rc-tl-date">${y}年${m}月${d}日${opts.showAgo ? `<span class="rc-tl-ago">${agoLabel_(dateKey)}</span>` : ''}</h3>
      ${list.map(rcDiaryContentHtml_).join('<hr class="rc-sep">')}
      <div class="rc-foot">
        <span>${WDAYS_LONG[dt.getDay()]}</span><span class="rc-foot-mood">${moods}</span>
        ${opts.showJump ? `<button type="button" class="rc-link-btn" onclick="jumpToSameDay(${m}, ${d})">📆 毎年の${m}月${d}日を見る</button>` : ''}
      </div>
    </article>`;
}

// ===== 同じ日タブ（10年日記形式＋カレンダー＋月別アーカイブ） =====
let sameDayMonth = null;   // 1-12
let sameDayDay   = null;   // 1-31
let recallMode   = 'sameday'; // 'sameday'=毎年の同じ日 / 'month'=月別タイムライン
let recallYM     = null;   // month表示中の {y, m}
let calYear = null, calMonth = null; // サイドバーのカレンダー表示中の年月
let archiveOpen = true;

function initSameDayState_() {
  const t = new Date();
  if (sameDayMonth === null) { sameDayMonth = t.getMonth() + 1; sameDayDay = t.getDate(); }
  if (calYear === null) { calYear = t.getFullYear(); calMonth = t.getMonth() + 1; }
}

// 見出しの < > ボタン
function recallPrev() { recallMode === 'month' ? shiftRecallMonth(-1) : shiftSameDay(-1); }
function recallNext() { recallMode === 'month' ? shiftRecallMonth(1)  : shiftSameDay(1); }

function shiftSameDay(delta) {
  const dt = new Date(2024, sameDayMonth - 1, sameDayDay + delta); // 2024年＝うるう年なので2/29も通る
  sameDayMonth = dt.getMonth() + 1;
  sameDayDay   = dt.getDate();
  calMonth = sameDayMonth; // カレンダーも追従
  renderOnThisDay();
}

function selectSameDay(y, m, d) {
  sameDayMonth = m; sameDayDay = d;
  calYear = y; calMonth = m;
  recallMode = 'sameday';
  renderOnThisDay();
}

// 別タブ（ランダム等）から特定の月日を開く
function jumpToSameDay(m, d) {
  sameDayMonth = m; sameDayDay = d;
  calMonth = m;
  recallMode = 'sameday';
  switchTab('onthisday');
}

function openRecallMonth(y, m) {
  recallMode = 'month';
  recallYM = { y, m };
  calYear = y; calMonth = m;
  renderOnThisDay();
  const main = document.getElementById('onthisday-container');
  if (main) main.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function shiftRecallMonth(delta) {
  const dt = new Date(recallYM.y, recallYM.m - 1 + delta, 1);
  openRecallMonth(dt.getFullYear(), dt.getMonth() + 1);
}

function backToSameDay() { recallMode = 'sameday'; renderOnThisDay(); }

// カレンダー操作（<< >> は1年、< > は1か月）
function calShift(months) {
  const dt = new Date(calYear, calMonth - 1 + months, 1);
  calYear = dt.getFullYear(); calMonth = dt.getMonth() + 1;
  renderAllSidebars_();
}
function calToday() {
  const t = new Date();
  if (activeTab === 'photos') { calYear = t.getFullYear(); calMonth = t.getMonth() + 1; renderAllSidebars_(); return; }
  selectSameDay(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

function toggleArchive() {
  archiveOpen = !archiveOpen;
  renderAllSidebars_();
}

function renderAllSidebars_() {
  renderRecallSidebar_();
  renderRecallSidebar_('photos');
}

async function renderOnThisDay() {
  const container = document.getElementById('onthisday-container');
  const titleEl = document.getElementById('recall-head-label');
  if (!container) return;
  initSameDayState_();
  showLoading(container, '探しています...');

  await ensureMyDiaries();
  renderRecallSidebar_();

  const byDate = groupDiariesByDate_(allMyDiaries);

  // ---- 月別タイムライン表示 ----
  if (recallMode === 'month' && recallYM) {
    if (titleEl) titleEl.textContent = `${recallYM.y}年${recallYM.m}月`;
    const prefix = `${recallYM.y}-${pad2_(recallYM.m)}-`;
    const keys = Object.keys(byDate).filter(k => k.startsWith(prefix)).sort().reverse();
    const back = `<button type="button" class="rc-link-btn rc-back" onclick="backToSameDay()">📆 ${sameDayMonth}月${sameDayDay}日の表示に戻る</button>`;
    container.innerHTML = back + (keys.length
      ? keys.map(k => rcTimelineDayHtml_(k, byDate[k], { showJump: true })).join('')
      : '<p class="empty-msg">この月の日記はありません。</p>');
    return;
  }

  // ---- 毎年の同じ日（10年日記形式） ----
  if (titleEl) titleEl.textContent = `${sameDayMonth}月${sameDayDay}日`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const thisYear = today.getFullYear();
  const allYears = allMyDiaries.map(d => new Date(d.createdAt).getFullYear()).filter(y => !isNaN(y));
  const startYear = allYears.length ? Math.min(...allYears, thisYear) : thisYear;
  const endYear = Math.max(startYear + 9, thisYear); // 最初の年から10年分（今年がそれより先ならそこまで）
  const md = `${pad2_(sameDayMonth)}-${pad2_(sameDayDay)}`;

  let html = '';
  for (let y = startYear; y <= endYear; y++) {
    const dt = new Date(y, sameDayMonth - 1, sameDayDay);
    const validDate = dt.getMonth() === sameDayMonth - 1; // 平年の2/29は存在しない
    const list = byDate[`${y}-${md}`] || [];
    const isToday = validDate && dt.getTime() === today.getTime();
    const future = validDate && dt > today;

    let boxHtml;
    if (list.length) {
      boxHtml = `<div class="rc-box has-diary">${list.map(rcDiaryContentHtml_).join('<hr class="rc-sep">')}</div>`;
    } else if (!validDate) {
      boxHtml = `<div class="rc-box is-empty">この年に2月29日はありません</div>`;
    } else if (isToday) {
      boxHtml = `<div class="rc-box is-empty is-today" onclick="switchTab('post')">タップして今日の日記を書く ✏️</div>`;
    } else if (future) {
      boxHtml = `<div class="rc-box is-empty is-future">まだ先の日です</div>`;
    } else {
      boxHtml = `<div class="rc-box is-empty">記録はありません</div>`;
    }

    html += `
      <section class="rc-year-block${isToday ? ' is-today' : ''}">
        <h3 class="rc-year-title">${y}年${y === thisYear ? '<span class="rc-this-year">今年</span>' : ''}</h3>
        ${boxHtml}
        <div class="rc-foot">
          ${validDate ? `<span>${WDAYS_LONG[dt.getDay()]}</span>` : ''}
          ${list.length ? `<span class="rc-foot-mood">${list.map(x => x.mood || '😊').join(' ')}</span>` : ''}
        </div>
      </section>`;
  }
  container.innerHTML = html;
}

// サイドバー（カレンダー＋月別アーカイブ）
// mode='diary'  … 同じ日タブ用（日記のある日を太字、日付クリックでその日の毎年を表示、月クリックで月別タイムライン）
// mode='photos' … 写真タブ用（写真のある日を太字、日付クリックで同じ日タブへ、月クリックでその月の写真へ移動）
function renderRecallSidebar_(mode = 'diary') {
  const side = document.getElementById(mode === 'photos' ? 'photos-sidebar' : 'recall-sidebar');
  if (!side) return;
  initSameDayState_();
  const isPhotos = mode === 'photos';
  const source = isPhotos ? allMyDiaries.filter(d => parsePhotos(d.photos).length) : allMyDiaries;
  const byDate = groupDiariesByDate_(source);
  const t = new Date();
  const todayKey = localDateKey_(t.toISOString());

  // --- カレンダー ---
  const first = new Date(calYear, calMonth - 1, 1);
  const start = new Date(first); start.setDate(1 - first.getDay()); // 日曜はじまり
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const dt = new Date(start); dt.setDate(start.getDate() + i);
    if (i >= 35 && dt.getMonth() !== calMonth - 1) break; // 6週目が丸ごと翌月なら省略
    const y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate();
    const key = `${y}-${pad2_(m)}-${pad2_(d)}`;
    const cls = ['rc-cal-cell'];
    if (m !== calMonth) cls.push('other');
    if (dt.getDay() === 0) cls.push('sun');
    if (dt.getDay() === 6) cls.push('sat');
    if (byDate[key]) cls.push('has');
    if (key === todayKey) cls.push('today');
    if (!isPhotos && recallMode === 'sameday' && m === sameDayMonth && d === sameDayDay) cls.push('selected');
    const onclick = isPhotos
      ? (byDate[key] ? `photoScrollToDate('${key}')` : `jumpToSameDay(${m}, ${d})`)
      : `selectSameDay(${y}, ${m}, ${d})`;
    cells += `<button type="button" class="${cls.join(' ')}" onclick="${onclick}">${d}</button>`;
  }

  // --- 月別アーカイブ（件数つき・新しい月から）。写真タブでは写真の枚数 ---
  const monthCount = {};
  source.forEach(d => {
    const k = localDateKey_(d.createdAt).slice(0, 7);
    if (k) monthCount[k] = (monthCount[k] || 0) + (isPhotos ? parsePhotos(d.photos).length : 1);
  });
  const months = Object.keys(monthCount).sort().reverse();
  const archive = months.map(k => {
    const [y, m] = k.split('-').map(Number);
    const active = !isPhotos && recallMode === 'month' && recallYM && recallYM.y === y && recallYM.m === m;
    const onclick = isPhotos ? `photoScrollToMonth(${y}, ${m})` : `openRecallMonth(${y}, ${m})`;
    return `<button type="button" class="rc-arc-row${active ? ' active' : ''}" onclick="${onclick}">
      <span>${y}年${m}月</span><span class="rc-arc-count">${monthCount[k]}</span></button>`;
  }).join('');

  side.innerHTML = `
    <div class="rc-cal">
      <div class="rc-cal-head">
        <span class="rc-cal-title">${calYear}年${calMonth}月</span>
        <div class="rc-cal-nav">
          <button type="button" onclick="calShift(-12)" title="前の年">&lt;&lt;</button>
          <button type="button" onclick="calShift(-1)" title="前の月">&lt;</button>
          <button type="button" onclick="calToday()">今日</button>
          <button type="button" onclick="calShift(1)" title="次の月">&gt;</button>
          <button type="button" onclick="calShift(12)" title="次の年">&gt;&gt;</button>
        </div>
      </div>
      <div class="rc-cal-grid">
        ${WDAYS.map((w, i) => `<div class="rc-cal-wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</div>`).join('')}
        ${cells}
      </div>
    </div>
    <div class="rc-panel">
      <button type="button" class="rc-panel-head" onclick="toggleArchive()">
        <span>${isPhotos ? '写真' : '日記'}</span><span>${archiveOpen ? '▾' : '▸'}</span>
      </button>
      ${archiveOpen ? (archive || `<div class="rc-arc-empty">まだ${isPhotos ? '写真' : '日記'}がありません</div>`) : ''}
    </div>`;
}

// ===== 写真（年月ごとに写真を並べる） =====
// 写真はGAS経由で1枚ずつ取得するため、画面に見えてきたものから順に読み込む
let photoObserver = null;
let photoQueue = [];
let photoLoading = 0;
const PHOTO_PARALLEL = 3;

async function renderPhotosTab() {
  const container = document.getElementById('photos-container');
  if (!container) return;
  initSameDayState_();
  showLoading(container, '写真を集めています...');
  await ensureMyDiaries();
  renderRecallSidebar_('photos');

  // 写真1枚ごとの一覧（新しい日→古い日、同じ日記の中は並び順どおり）
  const items = [];
  allMyDiaries.forEach(d => {
    const key = localDateKey_(d.createdAt);
    if (!key) return;
    parsePhotos(d.photos).forEach((p, i) => items.push({ key, diaryId: d.diaryId, fileId: p.fileId, idx: i, t: new Date(d.createdAt).getTime() }));
  });
  if (!items.length) {
    container.innerHTML = '<p class="empty-msg">まだ写真がありません。日記に写真を添えると、ここに年月ごとに並びます。</p>';
    return;
  }
  items.sort((a, b) => b.t - a.t || a.idx - b.idx);

  const byMonth = {};
  items.forEach(it => { (byMonth[it.key.slice(0, 7)] = byMonth[it.key.slice(0, 7)] || []).push(it); });

  let seq = 0;
  container.innerHTML = Object.keys(byMonth).sort().reverse().map(ym => {
    const [y, m] = ym.split('-').map(Number);
    return `
      <section class="ph-month" id="ph-month-${ym}">
        <h3 class="ph-month-title">${y}年${m}月</h3>
        <div class="ph-grid">
          ${byMonth[ym].map(it => {
            const day = Number(it.key.slice(8, 10));
            return `<button type="button" class="ph-cell loading" id="ph-${++seq}" data-key="${it.key}"
                      data-diary="${escHtml(it.diaryId)}" data-file="${escHtml(it.fileId)}"
                      onclick="openDiaryDetail(this.dataset.diary)" title="${it.key}">
                      <span class="ph-day">${day}</span></button>`;
          }).join('')}
        </div>
      </section>`;
  }).join('');

  setupPhotoLazyLoad_(container);
}

function setupPhotoLazyLoad_(container) {
  if (photoObserver) photoObserver.disconnect();
  photoQueue = [];
  const cells = container.querySelectorAll('.ph-cell.loading');
  if (!('IntersectionObserver' in window)) { cells.forEach(enqueuePhoto_); return; }
  photoObserver = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      photoObserver.unobserve(en.target);
      enqueuePhoto_(en.target);
    });
  }, { rootMargin: '300px 0px' });
  cells.forEach(c => photoObserver.observe(c));
}

function enqueuePhoto_(cell) {
  photoQueue.push(cell);
  pumpPhotoQueue_();
}

function pumpPhotoQueue_() {
  while (photoLoading < PHOTO_PARALLEL && photoQueue.length) {
    const cell = photoQueue.shift();
    if (!cell.isConnected) continue; // 描き直しで消えたもの
    photoLoading++;
    fetchPhoto(cell.dataset.diary, cell.dataset.file).then(dataUri => {
      if (!cell.isConnected) return;
      cell.classList.remove('loading');
      if (!dataUri) { cell.classList.add('broken'); return; }
      const img = document.createElement('img');
      img.src = dataUri; img.alt = '';
      cell.insertBefore(img, cell.firstChild);
    }).finally(() => { photoLoading--; pumpPhotoQueue_(); });
  }
}

function photoScrollToMonth(y, m) {
  const el = document.getElementById(`ph-month-${y}-${pad2_(m)}`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  calYear = y; calMonth = m;
  renderRecallSidebar_('photos');
}

function photoScrollToDate(key) {
  const cell = document.querySelector(`#photos-container .ph-cell[data-key="${key}"]`);
  if (!cell) return;
  cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.querySelectorAll('#photos-container .ph-cell.flash').forEach(c => c.classList.remove('flash'));
  document.querySelectorAll(`#photos-container .ph-cell[data-key="${key}"]`).forEach(c => c.classList.add('flash'));
}

// ===== ランダム（過去の日をランダムに選んでタイムライン形式で並べる） =====
let randomCount = 3;
let lastRandomKeys = [];

function setRandomCount(n) {
  randomCount = Number(n) || 3;
  renderRandomDays();
}

async function renderRandomDays() {
  const container = document.getElementById('random-container');
  if (!container) return;
  showLoading(container, 'ページをめくっています...');

  await ensureMyDiaries();

  const todayKey = localDateKey_(new Date().toISOString());
  const byDate = groupDiariesByDate_(allMyDiaries);
  const keys = Object.keys(byDate).filter(k => k < todayKey); // 今日より前＝過去の日だけ

  if (!keys.length) {
    container.innerHTML = '<p class="empty-msg">過去の日記がまだありません。書き続けると、ここで昔の日がランダムに届きます。</p>';
    return;
  }

  // 前回と同じ日ばかり出ないよう、候補が十分あれば前回分を除外
  let pool = keys;
  const fresh = keys.filter(k => !lastRandomKeys.includes(k));
  if (fresh.length >= Math.min(randomCount, keys.length)) pool = fresh;

  // Fisher–Yates シャッフル
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const picked = shuffled.slice(0, randomCount).sort().reverse(); // 新しい日→古い日
  lastRandomKeys = picked;

  const note = `<p class="rc-summary">🎲 記録のある ${keys.length}日の中から ${picked.length}日を選びました</p>`;
  container.innerHTML = note + picked.map(k => rcTimelineDayHtml_(k, byDate[k], { showAgo: true, showJump: true })).join('');
}

// ===== 年表 =====
async function renderTimeline() {
  const container = document.getElementById('timeline-container');
  if (!container) return;
  showLoading(container, '年表を開いています...');
  try {
    const res = await Auth.post({ action: 'getTimeline', token: Auth.getToken() });
    if (!res.success || !res.years.length) {
      container.innerHTML = '<p class="empty-msg">年表を作るにはまず日記を書いてみましょう。</p>';
      return;
    }
    container.innerHTML = res.years.map(year => `
      <div class="timeline-year">
        <div class="timeline-year-header">
          <span class="year-label">${year}年</span>
          <span class="year-count">${res.timeline[year].length}件</span>
        </div>
        <div class="timeline-entries">
          ${res.timeline[year].map(d => `
            <div class="timeline-entry" onclick="openDiaryDetail('${escJsAttr(d.diaryId)}')">
              <div class="timeline-date">${formatDate(d.createdAt)}</div>
              <div class="timeline-mood">${d.mood || '😊'}</div>
              <div class="timeline-title">${escHtml(d.title)}</div>
              <div class="timeline-preview">${escHtml((d.content||'').substring(0,80))}…</div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  } catch(e) {
    container.innerHTML = '<p class="empty-msg">読み込みエラーが発生しました。</p>';
  }
}

function selectMoodDiary(btn) {
  btn.closest('.mood-selector').querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById('diary-mood').value = btn.dataset.mood;
}

function selectMood(btn, hiddenId) {
  btn.closest('.mood-selector').querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById(hiddenId).value = btn.dataset.mood;
}

// ===== 音声入力（Web Speech API による録音 → GAS経由でGemini整形） =====
let voiceRecognition = null;
let voiceRecording = false;
let voiceFinalTranscript = '';
let voiceRawTranscript = '';

function getSpeechRecognitionCtor_() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function openVoiceModal() {
  const modal = document.getElementById('voice-modal');
  if (!modal) return;
  voiceFinalTranscript = '';
  voiceRawTranscript = '';
  document.getElementById('voice-transcript').textContent = '';
  document.getElementById('voice-status').textContent = 'タップして開始';
  document.getElementById('voice-mic-btn').classList.remove('recording');
  document.getElementById('voice-step-record').style.display = 'block';
  document.getElementById('voice-step-loading').style.display = 'none';
  document.getElementById('voice-step-confirm').style.display = 'none';
  modal.style.display = 'flex';
}

function closeVoiceModal() {
  stopVoiceRecognition_();
  const modal = document.getElementById('voice-modal');
  if (modal) modal.style.display = 'none';
}

function stopVoiceRecognition_() {
  voiceRecording = false;
  if (voiceRecognition) {
    try { voiceRecognition.onend = null; voiceRecognition.stop(); } catch (e) { /* 無視 */ }
  }
}

function toggleVoiceRecording() {
  const Ctor = getSpeechRecognitionCtor_();
  if (!Ctor) { showToast('このブラウザは音声入力に対応していません', 'error'); return; }
  const micBtn = document.getElementById('voice-mic-btn');
  const statusEl = document.getElementById('voice-status');

  if (voiceRecording) {
    // 2回目のタップ＝録音終了 → AI整形へ
    stopVoiceRecognition_();
    micBtn.classList.remove('recording');
    statusEl.textContent = 'タップして開始';
    const text = voiceFinalTranscript.trim();
    if (!text) { showToast('音声が認識できませんでした。もう一度お試しください', 'error'); return; }
    runVoiceFormatting_(text);
    return;
  }

  voiceFinalTranscript = '';
  document.getElementById('voice-transcript').textContent = '';
  voiceRecognition = new Ctor();
  voiceRecognition.lang = 'ja-JP';
  voiceRecognition.continuous = true;
  voiceRecognition.interimResults = true;

  voiceRecognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const chunk = e.results[i][0].transcript;
      if (e.results[i].isFinal) voiceFinalTranscript += chunk;
      else interim += chunk;
    }
    const box = document.getElementById('voice-transcript');
    box.textContent = voiceFinalTranscript + interim;
    box.scrollTop = box.scrollHeight;
  };
  voiceRecognition.onerror = (e) => {
    if (e.error === 'no-speech') return; // 無音は無視して継続
    showToast('音声認識でエラーが発生しました', 'error');
  };
  voiceRecognition.onend = () => {
    // 無音等でブラウザ側が自動停止した場合、録音継続中なら自動的に再開する
    if (voiceRecording) {
      try { voiceRecognition.start(); } catch (e) { /* 無視 */ }
    }
  };

  voiceRecording = true;
  micBtn.classList.add('recording');
  statusEl.textContent = '聞き取り中...（もう一度タップで停止）';
  try { voiceRecognition.start(); } catch (e) { /* 無視 */ }
}

async function runVoiceFormatting_(rawText) {
  voiceRawTranscript = rawText;
  document.getElementById('voice-step-record').style.display = 'none';
  document.getElementById('voice-step-loading').style.display = 'block';
  try {
    const res = await Auth.post({ action: 'formatVoiceDiary', token: Auth.getToken(), rawText });
    document.getElementById('voice-step-loading').style.display = 'none';
    if (res.success) {
      document.getElementById('voice-result-title').value   = res.title || '';
      document.getElementById('voice-result-content').value = res.content || '';
      document.getElementById('voice-result-tags').value    = res.tags || '';
      const mood = res.mood || '😊';
      document.getElementById('voice-result-mood').value = mood;
      document.querySelectorAll('#voice-mood-selector .mood-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.mood === mood);
      });
      document.getElementById('voice-raw-transcript').textContent = voiceRawTranscript;
      document.getElementById('voice-step-confirm').style.display = 'block';
    } else {
      showToast(res.error || 'AIによる整形に失敗しました', 'error');
      document.getElementById('voice-step-record').style.display = 'block';
    }
  } catch (e) {
    document.getElementById('voice-step-loading').style.display = 'none';
    document.getElementById('voice-step-record').style.display = 'block';
    showToast('接続エラーが発生しました', 'error');
  }
}

// 「削除してやり直す」：AIの整形結果を破棄して録音ステップに戻る
function discardVoiceResult() {
  if (!confirm('AIが整形した内容を削除してやり直しますか？')) return;
  voiceFinalTranscript = '';
  voiceRawTranscript = '';
  document.getElementById('voice-transcript').textContent = '';
  document.getElementById('voice-step-confirm').style.display = 'none';
  document.getElementById('voice-step-record').style.display = 'block';
}

// 「この内容を投稿フォームに反映」：確認・修正済みの内容を通常の投稿フォームへコピー
function applyVoiceResult() {
  document.getElementById('diary-title').value   = document.getElementById('voice-result-title').value.trim();
  document.getElementById('diary-content').value = document.getElementById('voice-result-content').value.trim();
  document.getElementById('diary-tags').value    = document.getElementById('voice-result-tags').value.trim();
  const mood = document.getElementById('voice-result-mood').value || '😊';
  document.getElementById('diary-mood').value = mood;
  document.querySelectorAll('#post-mood-selector .mood-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.mood === mood);
  });
  closeVoiceModal();
  showToast('音声の内容を投稿フォームに反映しました。内容を確認して投稿してください');
}
