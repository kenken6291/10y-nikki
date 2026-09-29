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
let recallLayout = 'row'; // 'row'=横並び / 'col'=縦並び

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

// 1件分の日記カード（列の中に縦に積む）
function recallEntryHtml_(d) {
  const photoCount = parsePhotos(d.photos).length;
  const body = (d.content || '');
  const preview = body.length > 180 ? body.substring(0, 180) + '…' : body;
  const time = new Date(d.createdAt);
  return `
    <div class="rc-entry" onclick="openDiaryDetail('${escJsAttr(d.diaryId)}')">
      <div class="rc-entry-top">
        <span class="rc-mood">${d.mood || '😊'}</span>
        <span class="rc-time">${pad2_(time.getHours())}:${pad2_(time.getMinutes())}</span>
        ${photoCount ? `<span class="rc-badge">📷 ${photoCount}</span>` : ''}
        <span class="rc-badge rc-vis">${d.isPublic ? '🌐' : '🔒'}</span>
      </div>
      <div class="rc-title">${escHtml(d.title)}</div>
      <div class="rc-body">${escHtml(preview)}</div>
      ${d.tags ? `<div class="card-tags">${d.tags.split(',').filter(t => t.trim()).map(t => `<span class="tag">${escHtml(t.trim())}</span>`).join('')}</div>` : ''}
    </div>`;
}

function setRecallLayout(layout) {
  recallLayout = layout;
  document.querySelectorAll('.rc-columns').forEach(el => el.classList.toggle('vertical', layout === 'col'));
  document.querySelectorAll('.rc-layout-btn').forEach(b => b.classList.toggle('active', b.dataset.layout === layout));
}

function columnsClass_() { return 'rc-columns' + (recallLayout === 'col' ? ' vertical' : ''); }

// ===== 同じ日（毎年の同じ月日を年ごとに横並び） =====
let sameDayMonth = null; // 1-12
let sameDayDay   = null; // 1-31
let sameDayOrder = 'desc'; // desc=新しい年から / asc=古い年から

function daysInMonth_(m) { return new Date(2024, m, 0).getDate(); } // 2024年はうるう年＝2/29も選べる

function initSameDayControls_() {
  const mSel = document.getElementById('sd-month');
  const dSel = document.getElementById('sd-day');
  if (!mSel || !dSel) return;
  if (!mSel.options.length) {
    mSel.innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}月</option>`).join('');
  }
  mSel.value = String(sameDayMonth);
  const max = daysInMonth_(sameDayMonth);
  if (sameDayDay > max) sameDayDay = max;
  dSel.innerHTML = Array.from({ length: max }, (_, i) => `<option value="${i + 1}">${i + 1}日</option>`).join('');
  dSel.value = String(sameDayDay);
}

function onSameDaySelect() {
  sameDayMonth = Number(document.getElementById('sd-month').value);
  sameDayDay   = Number(document.getElementById('sd-day').value);
  renderOnThisDay();
}

function shiftSameDay(delta) {
  const dt = new Date(2024, sameDayMonth - 1, sameDayDay + delta);
  sameDayMonth = dt.getMonth() + 1;
  sameDayDay   = dt.getDate();
  renderOnThisDay();
}

// 記録のある前後の月日へジャンプ（年は問わず、月日だけで判定）
function jumpSameDayWithRecord(dir) {
  const mdSet = [...new Set(allMyDiaries.map(d => localDateKey_(d.createdAt).slice(5)).filter(Boolean))].sort();
  if (!mdSet.length) { showToast('まだ日記がありません', 'error'); return; }
  const cur = `${pad2_(sameDayMonth)}-${pad2_(sameDayDay)}`;
  let target;
  if (dir > 0) target = mdSet.find(md => md > cur) || mdSet[0];
  else target = [...mdSet].reverse().find(md => md < cur) || mdSet[mdSet.length - 1];
  const [m, d] = target.split('-').map(Number);
  sameDayMonth = m; sameDayDay = d;
  renderOnThisDay();
}

function resetSameDayToday() {
  const t = new Date();
  sameDayMonth = t.getMonth() + 1;
  sameDayDay   = t.getDate();
  renderOnThisDay();
}

function toggleSameDayOrder() {
  sameDayOrder = sameDayOrder === 'desc' ? 'asc' : 'desc';
  const b = document.getElementById('sd-order-btn');
  if (b) b.textContent = sameDayOrder === 'desc' ? '⇅ 新しい年から' : '⇅ 古い年から';
  renderOnThisDay();
}

// 別タブ（ランダム等）から特定の月日を開く
function jumpToSameDay(m, d) {
  sameDayMonth = m; sameDayDay = d;
  switchTab('onthisday');
}

async function renderOnThisDay() {
  const container = document.getElementById('onthisday-container');
  const subEl = document.getElementById('onthisday-sub');
  if (!container) return;
  const today = new Date();
  if (sameDayMonth === null) { sameDayMonth = today.getMonth() + 1; sameDayDay = today.getDate(); }
  initSameDayControls_();
  showLoading(container, '探しています...');

  await ensureMyDiaries();

  const isToday = sameDayMonth === today.getMonth() + 1 && sameDayDay === today.getDate();
  if (subEl) subEl.textContent = `${isToday ? '今日、' : ''}${sameDayMonth}月${sameDayDay}日に書いた日記を、年ごとに並べて見比べられます。`;

  const byDate = groupDiariesByDate_(allMyDiaries);
  const md = `${pad2_(sameDayMonth)}-${pad2_(sameDayDay)}`;
  const thisYear = today.getFullYear();
  const allYears = allMyDiaries.map(d => new Date(d.createdAt).getFullYear()).filter(y => !isNaN(y));

  if (!allYears.length) {
    container.innerHTML = '<p class="empty-msg">まだ日記がありません。最初の一筆を綴りましょう。</p>';
    return;
  }

  // 最初に日記を書いた年〜今年まで、記録のない年も「空白の年」として並べる
  const firstYear = Math.min(...allYears);
  let years = [];
  for (let y = thisYear; y >= firstYear; y--) years.push(y);
  if (sameDayOrder === 'asc') years.reverse();

  const hitYears = years.filter(y => byDate[`${y}-${md}`]);
  const isLeapOnly = sameDayMonth === 2 && sameDayDay === 29;

  const cols = years.map(y => {
    const key = `${y}-${md}`;
    const list = byDate[key] || [];
    const dt = new Date(y, sameDayMonth - 1, sameDayDay);
    const validDate = dt.getMonth() === sameDayMonth - 1; // 平年の2/29は存在しない
    const future = validDate && dt > today;
    const yearsAgo = thisYear - y;
    let bodyHtml;
    if (list.length) bodyHtml = list.map(recallEntryHtml_).join('');
    else if (!validDate) bodyHtml = '<div class="rc-empty">この年に2月29日はありません</div>';
    else if (future) bodyHtml = '<div class="rc-empty">まだこれから。<br>この日が来たら書いてみましょう ✏️</div>';
    else bodyHtml = '<div class="rc-empty">この年の記録はありません</div>';
    return `
      <section class="rc-col${list.length ? '' : ' is-empty'}${yearsAgo === 0 ? ' is-this-year' : ''}">
        <header class="rc-col-head">
          <span class="rc-year">${y}年</span>
          ${validDate ? `<span class="rc-wday">（${WDAYS[dt.getDay()]}）</span>` : ''}
          <span class="rc-ago">${yearsAgo === 0 ? '今年' : yearsAgo + '年前'}</span>
        </header>
        ${bodyHtml}
      </section>`;
  }).join('');

  const summary = hitYears.length
    ? `<p class="rc-summary">📚 ${years.length}年のうち <strong>${hitYears.length}年分</strong> の記録があります${isLeapOnly ? '（うるう日）' : ''}</p>`
    : `<p class="rc-summary">この月日の日記はまだありません。「⏩ 記録のある日」で書いた日へ移動できます。</p>`;

  container.innerHTML = summary + `<div class="${columnsClass_()}">${cols}</div>`;
}

// ===== ランダム（過去の日をランダムに選んで並べる） =====
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

  const cols = picked.map(k => {
    const [y, m, d] = k.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return `
      <section class="rc-col">
        <header class="rc-col-head">
          <span class="rc-year">${y}年${m}月${d}日</span>
          <span class="rc-wday">（${WDAYS[dt.getDay()]}）</span>
          <span class="rc-ago">${agoLabel_(k)}</span>
        </header>
        ${byDate[k].map(recallEntryHtml_).join('')}
        <button type="button" class="rc-jump-btn" onclick="jumpToSameDay(${m}, ${d})">📆 毎年の${m}月${d}日を見る</button>
      </section>`;
  }).join('');

  const note = keys.length < randomCount
    ? `<p class="rc-summary">記録のある過去の日は ${keys.length}日分です。</p>`
    : `<p class="rc-summary">🎲 記録のある ${keys.length}日の中から ${picked.length}日を選びました</p>`;

  container.innerHTML = note + `<div class="${columnsClass_()}">${cols}</div>`;
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
