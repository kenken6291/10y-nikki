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
let allMyDiaries = []; // 「今日は」タブで再利用するためのキャッシュ
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
    <article class="diary-card my-diary-card">
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
        <button class="btn-edit-sm" onclick="openEditModal('${escJsAttr(d.diaryId)}')">✏️</button>
        <button class="btn-delete-xs" onclick="deleteDiary('${escJsAttr(d.diaryId)}')">🗑️</button>
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
  const diary = currentDiaries.find(d => d.diaryId === diaryId) || {};
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

// ===== 今日は（毎年の同じ月日を新しい年から順に） =====
async function renderOnThisDay() {
  const container = document.getElementById('onthisday-container');
  const subEl = document.getElementById('onthisday-sub');
  if (!container) return;
  showLoading(container, '探しています...');

  // マイ日記がまだ読み込まれていなければ先に取得（tabの初回表示など）
  if (!allMyDiaries.length) {
    try {
      const res = await Auth.post({ action: 'getMyDiaries', token: Auth.getToken() });
      if (res.success) allMyDiaries = res.diaries;
    } catch (e) { /* 下のフィルタで0件表示になる */ }
  }

  const today = new Date();
  const mm = today.getMonth();
  const dd = today.getDate();
  if (subEl) subEl.textContent = `${mm + 1}月${dd}日に書いた日記が、書いた年ごとに新しい順で並びます。`;

  const matches = allMyDiaries
    .filter(d => {
      const dt = new Date(d.createdAt);
      return dt.getMonth() === mm && dt.getDate() === dd;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // 新しい年→古い年

  if (!matches.length) {
    container.innerHTML = '<p class="empty-msg">今日と同じ月日に書いた日記はまだありません。来年、再来年…と積み重ねていきましょう。</p>';
    return;
  }

  const thisYear = today.getFullYear();
  container.innerHTML = matches.map(d => {
    const y = new Date(d.createdAt).getFullYear();
    const yearsAgo = thisYear - y;
    return `
      <div class="timeline-entry" onclick="openDiaryDetail('${escJsAttr(d.diaryId)}')">
        <div class="timeline-date">${y}年（${yearsAgo === 0 ? '今年' : yearsAgo + '年前'}）</div>
        <div class="timeline-mood">${d.mood || '😊'}</div>
        <div class="timeline-title">${escHtml(d.title)}</div>
        <div class="timeline-preview">${escHtml((d.content||'').substring(0,80))}…</div>
      </div>
    `;
  }).join('');
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
