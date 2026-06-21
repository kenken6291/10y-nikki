const Auth = {
  getToken:    () => sessionStorage.getItem('token'),
  getNickname: () => sessionStorage.getItem('nickname'),
  getMemberId: () => sessionStorage.getItem('memberId'), // ＝メールアドレス（会員番号）
  getRole:     () => sessionStorage.getItem('role'),
  getBirthYear:() => parseInt(sessionStorage.getItem('birthYear') || '0'),
  isLoggedIn:  () => !!sessionStorage.getItem('token'),
  isAdmin:     () => sessionStorage.getItem('role') === 'admin',
  mustChangePassword: () => sessionStorage.getItem('mustChangePassword') === 'true',

  setSession(data) {
    sessionStorage.setItem('token',     data.token);
    sessionStorage.setItem('nickname',  data.nickname);
    sessionStorage.setItem('memberId',  data.memberId);
    sessionStorage.setItem('role',      data.role);
    sessionStorage.setItem('birthYear', data.birthYear || '');
    sessionStorage.setItem('mustChangePassword', data.mustChangePassword ? 'true' : 'false');
  },
  clearSession() { sessionStorage.clear(); },

  async post(params) {
    const res = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify(params) });
    return res.json();
  },
  async get(params) {
    const url = new URL(GAS_URL);
    Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
    const res = await fetch(url, { redirect: 'follow' });
    return res.json();
  }
};

// ===== 日付フォーマット =====
function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const days = ['日','月','火','水','木','金','土'];
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${days[d.getDay()]}）`;
}

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const days = ['日','月','火','水','木','金','土'];
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${days[d.getDay()]}）${hh}:${mm}`;
}

// 世代ラベル生成
function birthYearToGeneration(birthYear) {
  if (!birthYear || birthYear < 1900) return '';
  const age = new Date().getFullYear() - birthYear;
  const ageGroup = Math.floor(age / 10) * 10;
  return `${ageGroup}代`;
}

// 世代オプション
const GENERATION_OPTIONS = [
  { label: '全世代', value: '' },
  { label: '10代',  value: '2010' },
  { label: '20代',  value: '2000' },
  { label: '30代',  value: '1990' },
  { label: '40代',  value: '1980' },
  { label: '50代',  value: '1970' },
  { label: '60代',  value: '1960' },
  { label: '70代',  value: '1950' },
  { label: '80代以上', value: '1940' },
];

// ===== ローディング・トースト =====
function showLoading(el, msg = '読み込んでいます...') {
  if (el) el.innerHTML = `<div class="loading-msg"><span class="loading-spinner"></span>${msg}</div>`;
}

function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}

// ===== ナビゲーション更新 =====
function updateNav() {
  const navLogin  = document.getElementById('nav-login');
  const navUser   = document.getElementById('nav-user');
  const navNick   = document.getElementById('nav-nickname');
  const navAdmin  = document.getElementById('nav-admin');
  if (!navLogin) return;
  if (Auth.isLoggedIn()) {
    navLogin.style.display  = 'none';
    navUser.style.display   = 'flex';
    if (navNick) navNick.textContent = Auth.getNickname() + ' さん';
    if (navAdmin) navAdmin.style.display = Auth.isAdmin() ? 'inline-block' : 'none';
  } else {
    navLogin.style.display  = 'flex';
    navUser.style.display   = 'none';
  }
}

async function handleLogout() {
  if (Auth.getToken()) {
    await Auth.post({ action: 'logout', token: Auth.getToken() }).catch(() => {});
  }
  Auth.clearSession();
  window.location.href = 'index.html';
}

// ===== パスワード表示／非表示切替（v3新規） =====
function togglePasswordVisibility(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btnEl.textContent = '🙈';
  } else {
    input.type = 'password';
    btnEl.textContent = '👁️';
  }
}

// ===== 強制パスワード変更チェック（v3新規） =====
// ログイン直後、仮パスワードのままなら profile.html へ誘導する
function enforcePasswordChangeIfNeeded() {
  if (Auth.isLoggedIn() && Auth.mustChangePassword() && !location.pathname.endsWith('profile.html')) {
    location.href = 'profile.html?forceChange=1';
  }
}

// HTMLエスケープ（共通）
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
