// ===== イベント一覧（最新投稿順） =====
async function loadEvents() {
  const container = document.getElementById('events-list');
  if (!container) return;
  showLoading(container, 'イベントを読み込んでいます...');
  try {
    const res = await Auth.get({ action: 'getEvents' });
    if (res.success) renderEvents(res.events, container);
    else container.innerHTML = '<p class="empty-msg">読み込みに失敗しました。</p>';
  } catch(e) { container.innerHTML = '<p class="empty-msg">接続エラー</p>'; }
}

function renderEvents(events, container) {
  if (!events.length) {
    container.innerHTML = '<p class="empty-msg">現在開催中のイベントはありません。<br>最初のイベントを企画してみましょう！</p>';
    return;
  }
  container.innerHTML = events.map(ev => `
    <article class="event-card" onclick="openEventDetail('${ev.eventId}')">
      <div class="event-status-badge status-${ev.status}">${statusLabel(ev)}</div>
      <h3 class="event-title">${escHtml(ev.title)}</h3>
      <div class="event-meta">
        <span>📅 ${formatDate(ev.eventDate)}</span>
        <span>📍 ${escHtml(ev.location || '場所未定')}</span>
        <span>👤 主催: ${escHtml(ev.organizerNickname)}</span>
        ${ev.deadline ? `<span>⏰ 〆切: ${formatDateTime(ev.deadline)}</span>` : ''}
      </div>
      <p class="event-desc">${escHtml((ev.description||'').substring(0,80))}${ev.description && ev.description.length > 80 ? '…' : ''}</p>
      ${ev.tags ? `<div class="card-tags">${ev.tags.split(',').map(t=>`<span class="tag">${escHtml(t.trim())}</span>`).join('')}</div>` : ''}
      <div class="event-footer">
        <span class="participant-count">
          👥 ${ev.participantCount}名参加${ev.maxParticipants ? ' / 定員'+ev.maxParticipants+'名' : ''}
        </span>
      </div>
    </article>
  `).join('');
}

function statusLabel(ev) {
  if (ev.status === 'cancelled') return 'キャンセル';
  if (ev.status === 'closed') {
    if (ev.deadline && new Date() > new Date(ev.deadline)) return '⏰ 募集期限終了';
    if (ev.maxParticipants && ev.participantCount >= parseInt(ev.maxParticipants)) return '👥 定員到達';
    return '募集終了';
  }
  return '受付中';
}

// ===== イベント詳細モーダル =====
let currentEventId = '';
async function openEventDetail(eventId) {
  currentEventId = eventId;
  const modal = document.getElementById('event-modal');
  const body  = document.getElementById('event-modal-body');
  if (!modal || !body) return;
  modal.style.display = 'flex';
  showLoading(body, 'イベントを読み込んでいます...');
  try {
    const res = await Auth.get({ action: 'getEventDetail', eventId });
    if (!res.success) { body.innerHTML = '<p>読み込みエラー</p>'; return; }
    const ev = res.event;
    const myId = Auth.getMemberId();
    const isOrganizer = ev.organizerId === myId;
    const isParticipant = res.participants.some(p => p.memberId === myId);
    const isFull = ev.maxParticipants && res.participants.length >= parseInt(ev.maxParticipants);
    const deadlinePassed = ev.deadline && new Date() > new Date(ev.deadline);

    body.innerHTML = `
      <div class="event-detail">
        <div class="event-status-badge status-${ev.status}">${statusLabel({...ev, participantCount: res.participants.length})}</div>
        <h2>${escHtml(ev.title)}</h2>
        <div class="event-meta">
          <span>📅 ${formatDate(ev.eventDate)}</span>
          <span>📍 ${escHtml(ev.location || '場所未定')}</span>
          <span>👤 主催: ${escHtml(ev.organizerNickname)}</span>
          <span>👥 ${res.participants.length}名参加${ev.maxParticipants ? ' / 定員'+ev.maxParticipants+'名' : ''}</span>
          ${ev.deadline ? `<span>⏰ 募集期限: ${formatDateTime(ev.deadline)}</span>` : ''}
        </div>
        <div class="event-desc-full">${escHtml(ev.description||'').replace(/\n/g,'<br>')}</div>
        ${ev.tags ? `<div class="card-tags">${ev.tags.split(',').map(t=>`<span class="tag">${escHtml(t.trim())}</span>`).join('')}</div>` : ''}

        <div class="event-actions">
          ${Auth.isLoggedIn() && !isOrganizer ? `
            ${isParticipant
              ? `<button class="btn-leave" onclick="leaveEvent('${ev.eventId}')">❌ 不参加にする（参加取消）</button>`
              : ev.status === 'open' && !isFull && !deadlinePassed
                ? `<button class="btn-join" onclick="joinEvent('${ev.eventId}')">✅ 参加する</button>`
                : `<span class="closed-note">${deadlinePassed ? '⏰ 募集期限を過ぎました' : '👥 定員に達しました'}</span>`
            }
          ` : ''}
          ${isOrganizer ? `
            <button class="btn-edit" onclick="openEditEventModal('${ev.eventId}')">✏️ 編集</button>
            <button class="btn-delete-sm" onclick="deleteEvent('${ev.eventId}')">🗑️ 削除</button>
          ` : ''}
        </div>

        <div class="participants-section">
          <h4>参加者（${res.participants.length}名）</h4>
          <div class="participants-list">
            ${renderParticipants(res.participants)}
          </div>
        </div>

        <div class="event-messages-section">
          <h4>📢 掲示板</h4>
          <div id="event-messages-list">
            ${renderEventMessages(res.messages)}
          </div>
          ${Auth.isLoggedIn() && isParticipant ? `
            <div class="comment-form">
              <textarea id="event-msg-input" placeholder="メッセージを書く..." rows="3"></textarea>
              <label class="notify-check">
                <input type="checkbox" id="msg-notify-all"> 参加者全員にメール通知する
              </label>
              <button onclick="postEventMsg('${ev.eventId}')">送信</button>
            </div>
          ` : Auth.isLoggedIn() && isOrganizer ? `
            <div class="comment-form">
              <textarea id="event-msg-input" placeholder="参加者へのメッセージ..." rows="3"></textarea>
              <label class="notify-check">
                <input type="checkbox" id="msg-notify-all" checked> 参加者全員にメール通知する
              </label>
              <button onclick="postEventMsg('${ev.eventId}')">全員に送信</button>
            </div>
          ` : !Auth.isLoggedIn() ? '<p class="login-prompt"><a href="index.html">ログイン</a>して参加・投稿する</p>' : ''}
        </div>
      </div>
    `;
  } catch(e) { body.innerHTML = '<p>読み込みエラー</p>'; }
}

function renderParticipants(participants) {
  if (!participants.length) return '<p class="empty-msg-sm">まだ参加者はいません。</p>';
  return participants.map(p => `
    <div class="participant-card">
      <span class="participant-name">${escHtml(p.nickname)}</span>
      ${p.snsContact ? `<span class="participant-sns">📱 ${escHtml(p.snsContact)}</span>` : ''}
    </div>
  `).join('');
}

function renderEventMessages(messages) {
  if (!messages.length) return '<p class="empty-msg-sm">まだメッセージはありません。</p>';
  return messages.map(m => `
    <div class="comment-item">
      <div class="comment-meta">
        <strong>${escHtml(m.nickname)}</strong>
        <span>${formatDate(m.createdAt)}</span>
      </div>
      <p>${escHtml(m.content).replace(/\n/g,'<br>')}</p>
    </div>
  `).join('');
}

function closeEventModal() {
  const modal = document.getElementById('event-modal');
  if (modal) modal.style.display = 'none';
}

// ===== 参加・不参加 =====
async function joinEvent(eventId) {
  try {
    const res = await Auth.post({ action: 'joinEvent', token: Auth.getToken(), eventId });
    if (res.success) { showToast('参加登録しました 🎉'); openEventDetail(eventId); loadEvents(); }
    else showToast(res.error || 'エラー', 'error');
  } catch(e) { showToast('エラー', 'error'); }
}

async function leaveEvent(eventId) {
  if (!confirm('参加をキャンセルしますか？')) return;
  try {
    const res = await Auth.post({ action: 'leaveEvent', token: Auth.getToken(), eventId });
    if (res.success) { showToast('参加をキャンセルしました'); openEventDetail(eventId); loadEvents(); }
    else showToast(res.error || 'エラー', 'error');
  } catch(e) { showToast('エラー', 'error'); }
}

// ===== メッセージ投稿 =====
async function postEventMsg(eventId) {
  const input = document.getElementById('event-msg-input');
  const notifyAll = document.getElementById('msg-notify-all')?.checked;
  const content = input ? input.value.trim() : '';
  if (!content) { showToast('メッセージを入力してください', 'error'); return; }
  try {
    const res = await Auth.post({ action: 'postEventMessage', token: Auth.getToken(), eventId, content, notifyAll });
    if (res.success) {
      showToast('メッセージを送信しました');
      input.value = '';
      openEventDetail(eventId);
    } else showToast(res.error || 'エラー', 'error');
  } catch(e) { showToast('エラー', 'error'); }
}

// ===== イベント作成 =====
async function submitEvent(e) {
  e.preventDefault();
  const title     = document.getElementById('ev-title').value.trim();
  const eventDate = document.getElementById('ev-date').value;
  const location  = document.getElementById('ev-location').value.trim();
  const desc      = document.getElementById('ev-desc').value.trim();
  const maxP      = document.getElementById('ev-max').value;
  const tags      = document.getElementById('ev-tags').value.trim();
  const deadline  = document.getElementById('ev-deadline').value;
  if (!title || !eventDate) { showToast('タイトルと開催日時は必須です', 'error'); return; }
  const btn = document.getElementById('create-event-btn');
  btn.disabled = true; btn.textContent = '作成中...';
  try {
    const res = await Auth.post({
      action: 'createEvent', token: Auth.getToken(),
      title, eventDate, location, description: desc, maxParticipants: maxP, tags, deadline
    });
    if (res.success) {
      showToast('イベントを作成しました 🎊');
      document.getElementById('event-form').reset();
      loadEvents();
      const formSection = document.getElementById('event-form-section');
      if (formSection) formSection.classList.remove('open');
    } else showToast(res.error || 'エラー', 'error');
  } catch(e) { showToast('エラー', 'error'); }
  btn.disabled = false; btn.textContent = '🎊 イベントを作成';
}

// ===== イベント削除 =====
async function deleteEvent(eventId) {
  if (!confirm('このイベントを削除しますか？')) return;
  try {
    const res = await Auth.post({ action: 'deleteEvent', token: Auth.getToken(), eventId });
    if (res.success) { showToast('イベントを削除しました'); closeEventModal(); loadEvents(); }
    else showToast(res.error || 'エラー', 'error');
  } catch(e) { showToast('エラー', 'error'); }
}

// ===== イベント編集モーダル =====
let editEventData = null;
async function openEditEventModal(eventId) {
  try {
    const res = await Auth.get({ action: 'getEventDetail', eventId });
    if (!res.success) { showToast('読み込みエラー', 'error'); return; }
    editEventData = res.event;
    const modal = document.getElementById('event-edit-modal');
    modal.dataset.eventId = eventId;
    document.getElementById('eev-title').value    = res.event.title || '';
    document.getElementById('eev-date').value     = toLocalDatetimeValue(res.event.eventDate);
    document.getElementById('eev-location').value = res.event.location || '';
    document.getElementById('eev-desc').value     = res.event.description || '';
    document.getElementById('eev-max').value      = res.event.maxParticipants || '';
    document.getElementById('eev-tags').value     = res.event.tags || '';
    document.getElementById('eev-deadline').value = res.event.deadline ? toLocalDatetimeValue(res.event.deadline) : '';
    document.getElementById('eev-status').value   = res.event.rawStatus || res.event.status || 'open';
    closeEventModal();
    modal.style.display = 'flex';
  } catch(e) { showToast('エラー', 'error'); }
}

function toLocalDatetimeValue(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function submitEventEdit() {
  const modal = document.getElementById('event-edit-modal');
  const eventId = modal.dataset.eventId;
  const title     = document.getElementById('eev-title').value.trim();
  const eventDate = document.getElementById('eev-date').value;
  const location  = document.getElementById('eev-location').value.trim();
  const description = document.getElementById('eev-desc').value.trim();
  const maxParticipants = document.getElementById('eev-max').value;
  const tags      = document.getElementById('eev-tags').value.trim();
  const deadline  = document.getElementById('eev-deadline').value;
  const status    = document.getElementById('eev-status').value;
  const notifyParticipants = document.getElementById('eev-notify').checked;
  if (!title || !eventDate) { showToast('タイトルと開催日時は必須です', 'error'); return; }
  try {
    const res = await Auth.post({
      action: 'updateEvent', token: Auth.getToken(), eventId,
      title, eventDate, location, description, maxParticipants, tags, deadline, status, notifyParticipants
    });
    if (res.success) {
      showToast('イベントを更新しました');
      modal.style.display = 'none';
      loadEvents();
    } else showToast(res.error || 'エラー', 'error');
  } catch(e) { showToast('エラー', 'error'); }
}

function closeEventEditModal() {
  document.getElementById('event-edit-modal').style.display = 'none';
}
