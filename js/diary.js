// ===== 日記フィード =====
let currentGenFilter = '';
let currentTagFilter = '';
let currentDiaries   = [];

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
    <article class="diary-card" onclick="openDiaryDetail('${d.diaryId}')">
      <div class="card-header">
        <span class="card-mood">${d.mood || '😊'}</span>
        <span class="card-nickname">${escHtml(d.nickname)}</span>
        ${d.birthYear ? `<span class="gen-badge">${birthYearToGeneration(d.birthYear)}</span>` : ''}
        <span class="card-date">${formatDate(d.createdAt)}</span>
      </div>
      <h3 class="card-title">${escHtml(d.title)}</h3>
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
    const res = await Auth.get({ action: 'getDiaryDetail', diaryId });
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
        <div class="modal-content">${escHtml(d.content).replace(/\n/g,'<br>')}</div>
        ${d.tags ? `<div class="card-tags">${d.tags.split(',').map(t=>`<span class="tag">${escHtml(t.trim())}</span>`).join('')}</div>` : ''}

        <div class="like-section">
          ${Auth.isLoggedIn() ? `
            <button class="like-btn${alreadyLiked ? ' liked' : ''}" onclick="toggleLike('${d.diaryId}', this)">
              ${alreadyLiked ? '❤️' : '🤍'} いいね ${res.likes.length}
            </button>
          ` : `<span class="like-count">❤️ ${res.likes.length}</span>`}
          ${isOwner ? `
            <button class="btn-edit" onclick="openEditModal('${d.diaryId}')">✏️ 編集</button>
            <button class="btn-delete-sm" onclick="deleteDiary('${d.diaryId}')">🗑️ 削除</button>
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
              <button onclick="postComment('${d.diaryId}')">送信</button>
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
        ${c.memberId === Auth.getMemberId() ? `<button class="btn-delete-xs" onclick="deleteComment('${c.commentId}')">削除</button>` : ''}
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
async function loadMyDiaries() {
  const container = document.getElementById('my-diaries');
  if (!container) return;
  showLoading(container, 'マイ日記を開いています...');
  try {
    const res = await Auth.post({ action: 'getMyDiaries', token: Auth.getToken() });
    if (res.success) renderMyDiaries(res.diaries, container);
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
      <p class="card-preview">${escHtml((d.content || '').substring(0,80))}…</p>
      ${d.tags ? `<div class="card-tags">${d.tags.split(',').map(t=>`<span class="tag">${escHtml(t.trim())}</span>`).join('')}</div>` : ''}
      <div class="card-footer">
        <span class="stat-btn">❤️ ${d.likeCount||0}</span>
        <span class="stat-btn">💬 ${d.commentCount||0}</span>
        <button class="btn-edit-sm" onclick="openEditModal('${d.diaryId}')">✏️</button>
        <button class="btn-delete-xs" onclick="deleteDiary('${d.diaryId}')">🗑️</button>
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
  btn.disabled = true; btn.textContent = '投稿中...';
  try {
    const res = await Auth.post({ action: 'postDiary', token: Auth.getToken(), title, content, mood, tags, isPublic });
    if (res.success) {
      showToast('日記を投稿しました ✨');
      document.getElementById('diary-form').reset();
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
    const res = await Auth.post({ action: 'updateDiary', token: Auth.getToken(), diaryId, title, content, mood, tags, isPublic });
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
            <div class="timeline-entry" onclick="openDiaryDetail('${d.diaryId}')">
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
