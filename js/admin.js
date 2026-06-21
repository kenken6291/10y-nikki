// ===== 会員管理 =====
async function adminLoadMembers() {
  const container = document.getElementById('admin-members');
  if (!container) return;
  showLoading(container, '会員情報を読み込んでいます...');
  try {
    const res = await Auth.post({ action: 'adminGetMembers', token: Auth.getToken() });
    if (!res.success) { container.innerHTML = '<p>読み込みエラー</p>'; return; }
    container.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>ニックネーム</th><th>会員番号（メール）</th><th>生年</th><th>SNS</th><th>権限</th>
            <th>登録日</th><th>状態</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${res.members.map(m => `
            <tr class="${m.isActive ? '' : 'row-inactive'}">
              <td>${escHtml(m.nickname)}</td>
              <td>${escHtml(m.email)}</td>
              <td>${m.birthYear || '-'}</td>
              <td>${m.snsContact ? escHtml(m.snsContact) : '-'}</td>
              <td><span class="role-badge role-${m.role}">${m.role}</span></td>
              <td>${formatDate(m.createdAt)}</td>
              <td>${m.isActive ? '✅ 有効' : '🚫 停止'}</td>
              <td>
                <button class="btn-toggle ${m.isActive ? 'btn-suspend' : 'btn-activate'}"
                  onclick="adminToggleMember('${m.memberId}', this)">
                  ${m.isActive ? '停止' : '有効化'}
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch(e) { container.innerHTML = '<p>接続エラー</p>'; }
}

async function adminToggleMember(memberId, btn) {
  btn.disabled = true;
  try {
    const res = await Auth.post({ action: 'adminToggleMember', token: Auth.getToken(), memberId });
    if (res.success) { showToast('会員状態を変更しました'); adminLoadMembers(); }
    else showToast(res.error || 'エラー', 'error');
  } catch(e) { showToast('エラー', 'error'); }
  btn.disabled = false;
}

// ===== 日記管理 =====
async function adminLoadDiaries() {
  const container = document.getElementById('admin-diaries');
  if (!container) return;
  showLoading(container, '日記を読み込んでいます...');
  try {
    const res = await Auth.post({ action: 'adminGetAllDiaries', token: Auth.getToken() });
    if (!res.success) { container.innerHTML = '<p>読み込みエラー</p>'; return; }
    container.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr><th>投稿者</th><th>タイトル</th><th>公開</th><th>投稿日</th><th>操作</th></tr>
        </thead>
        <tbody>
          ${res.diaries.map(d => `
            <tr>
              <td>${escHtml(d.nickname)}</td>
              <td>${escHtml(d.title)}</td>
              <td>${d.isPublic ? '🌐' : '🔒'}</td>
              <td>${formatDate(d.createdAt)}</td>
              <td>
                <button class="btn-delete-sm" onclick="adminDeleteDiary('${d.diaryId}')">削除</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch(e) { container.innerHTML = '<p>接続エラー</p>'; }
}

async function adminDeleteDiary(diaryId) {
  if (!confirm('この日記を強制削除しますか？')) return;
  try {
    const res = await Auth.post({ action: 'adminDeleteDiary', token: Auth.getToken(), diaryId });
    if (res.success) { showToast('日記を削除しました'); adminLoadDiaries(); }
    else showToast(res.error || 'エラー', 'error');
  } catch(e) { showToast('エラー', 'error'); }
}

// ===== イベント管理（v3新規） =====
async function adminLoadEvents() {
  const container = document.getElementById('admin-events');
  if (!container) return;
  showLoading(container, 'イベントを読み込んでいます...');
  try {
    const res = await Auth.post({ action: 'adminGetAllEvents', token: Auth.getToken() });
    if (!res.success) { container.innerHTML = '<p>読み込みエラー</p>'; return; }
    container.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr><th>主催者</th><th>タイトル</th><th>開催日時</th><th>状態</th><th>作成日</th><th>操作</th></tr>
        </thead>
        <tbody>
          ${res.events.map(ev => `
            <tr>
              <td>${escHtml(ev.organizerNickname)}</td>
              <td>${escHtml(ev.title)}</td>
              <td>${formatDate(ev.eventDate)}</td>
              <td><span class="role-badge role-member">${ev.status}</span></td>
              <td>${formatDate(ev.createdAt)}</td>
              <td>
                <button class="btn-delete-sm" onclick="adminDeleteEvent('${ev.eventId}')">削除</button>
                <button class="btn-toggle btn-suspend" onclick="adminCancelEvent('${ev.eventId}', this)">キャンセル扱い</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch(e) { container.innerHTML = '<p>接続エラー</p>'; }
}

async function adminDeleteEvent(eventId) {
  if (!confirm('このイベントを強制削除しますか？')) return;
  try {
    const res = await Auth.post({ action: 'adminDeleteEvent', token: Auth.getToken(), eventId });
    if (res.success) { showToast('イベントを削除しました'); adminLoadEvents(); }
    else showToast(res.error || 'エラー', 'error');
  } catch(e) { showToast('エラー', 'error'); }
}

async function adminCancelEvent(eventId, btn) {
  if (!confirm('このイベントをキャンセル扱いにしますか？')) return;
  btn.disabled = true;
  try {
    const res = await Auth.post({ action: 'adminUpdateEvent', token: Auth.getToken(), eventId, status: 'cancelled' });
    if (res.success) { showToast('イベントをキャンセル扱いにしました'); adminLoadEvents(); }
    else showToast(res.error || 'エラー', 'error');
  } catch(e) { showToast('エラー', 'error'); }
  btn.disabled = false;
}

// ===== タブ切り替え =====
function adminTab(tab) {
  document.querySelectorAll('.admin-tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.admin-tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('admin-' + tab).style.display = 'block';
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  if (tab === 'members') adminLoadMembers();
  if (tab === 'diaries') adminLoadDiaries();
  if (tab === 'events')  adminLoadEvents();
}
