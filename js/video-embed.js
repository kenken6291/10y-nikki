// ===== 日記本文の動画リンク表示（YouTube・Instagram・TikTok・X・Facebook・Vimeo・ニコニコ） =====
// 本文に貼られたURLを見つけて、
//   ・詳細画面／同じ日／ランダム … サムネイル付きの再生カード（押すとその場で再生）
//   ・一覧のカード            … 「▶ YouTube」などの小さな目印
// を表示する。再生ボタンを押すまで外部サイトは読み込まない（表示が重くならないように）。

const VE_URL_RE = /https?:\/\/[^\s<>"'（）「」、。]+/g;

const VE_PLATFORMS = {
  youtube:   { name: 'YouTube',     icon: '▶️', color: '#ff0000' },
  vimeo:     { name: 'Vimeo',       icon: '🎞️', color: '#1ab7ea' },
  tiktok:    { name: 'TikTok',      icon: '🎵', color: '#111111' },
  instagram: { name: 'Instagram',   icon: '📸', color: '#d62976' },
  x:         { name: 'X（Twitter）', icon: '✖️', color: '#111111' },
  facebook:  { name: 'Facebook',    icon: '📘', color: '#1877f2' },
  niconico:  { name: 'ニコニコ動画', icon: '📺', color: '#252525' }
};

// URLの末尾に付いてしまった記号を取り除く
function veCleanUrl_(u) {
  return u.replace(/[)\]}>.,!?;:、。！？）」』】]+$/, '');
}

// "1h2m3s" / "90" / "90s" → 秒
function veParseTime_(t) {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = String(t).match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  return m ? (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) : 0;
}

// URL 1本を解析して、埋め込み情報を返す（対応外なら null）
function veParseUrl_(raw) {
  let url;
  try { url = new URL(raw); } catch (e) { return null; }
  const host = url.hostname.replace(/^(www\.|m\.|mobile\.|music\.)/, '');
  const path = url.pathname;
  let m;

  // YouTube
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    let id = '', shorts = false;
    if (host === 'youtu.be') id = path.slice(1).split('/')[0];
    else if (path === '/watch') id = url.searchParams.get('v') || '';
    else if ((m = path.match(/^\/(shorts|live|embed|v)\/([\w-]{11})/))) { id = m[2]; shorts = m[1] === 'shorts'; }
    if (!/^[\w-]{11}$/.test(id)) return null;
    const start = veParseTime_(url.searchParams.get('t') || url.searchParams.get('start'));
    return {
      platform: 'youtube', id, url: raw, vertical: shorts,
      thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1${start ? '&start=' + start : ''}`
    };
  }
  // Vimeo
  if (host === 'vimeo.com' && (m = path.match(/^\/(?:video\/)?(\d+)/))) {
    return { platform: 'vimeo', id: m[1], url: raw, embed: `https://player.vimeo.com/video/${m[1]}?autoplay=1` };
  }
  // TikTok（短縮URL vt.tiktok.com は動画IDが分からないのでリンクのみ）
  if (host === 'tiktok.com' && (m = path.match(/\/video\/(\d+)/))) {
    return { platform: 'tiktok', id: m[1], url: raw, vertical: true, tall: true, embed: `https://www.tiktok.com/embed/v2/${m[1]}` };
  }
  // Instagram（投稿・リール）
  if (host === 'instagram.com' && (m = path.match(/^\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/))) {
    const kind = m[1] === 'reels' ? 'reel' : m[1];
    return { platform: 'instagram', id: m[2], url: raw, vertical: true, tall: true, embed: `https://www.instagram.com/${kind}/${m[2]}/embed/` };
  }
  // X / Twitter
  if ((host === 'x.com' || host === 'twitter.com') && (m = path.match(/\/status(?:es)?\/(\d+)/))) {
    return { platform: 'x', id: m[1], url: raw, tall: true, embed: `https://platform.twitter.com/embed/Tweet.html?id=${m[1]}&lang=ja` };
  }
  // Facebook（動画・リール・fb.watch）
  if ((host === 'facebook.com' && /\/(videos|reel|watch|share\/v|share\/r)\b/.test(path + url.search)) || host === 'fb.watch') {
    return { platform: 'facebook', id: raw, url: raw, embed: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(raw)}&show_text=false&autoplay=true` };
  }
  // ニコニコ動画
  if ((host === 'nicovideo.jp' || host === 'sp.nicovideo.jp') && (m = path.match(/\/watch\/((?:sm|so|nm)\d+)/)) ||
      (host === 'nico.ms' && (m = path.match(/^\/((?:sm|so|nm)\d+)/)))) {
    return { platform: 'niconico', id: m[1], url: raw, embed: `https://embed.nicovideo.jp/watch/${m[1]}?autoplay=1` };
  }
  return null;
}

// 本文から動画リンクを取り出す（同じ動画は1回だけ）
function veFindVideos(text) {
  const found = [];
  const seen = {};
  (String(text || '').match(VE_URL_RE) || []).forEach(u => {
    const v = veParseUrl_(veCleanUrl_(u));
    if (!v) return;
    const key = v.platform + ':' + v.id;
    if (seen[key]) return;
    seen[key] = true;
    found.push(v);
  });
  return found;
}

// 本文をエスケープし、URLをリンクにする（brLines=true なら改行を<br>に）
function veLinkify(text, brLines = false) {
  const src = String(text || '');
  let out = '', last = 0;
  src.replace(VE_URL_RE, (match, offset) => {
    const url = veCleanUrl_(match);
    out += escHtml(src.slice(last, offset));
    out += `<a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer" class="ve-link" onclick="event.stopPropagation()">${escHtml(url)}</a>`;
    last = offset + url.length;
    return match;
  });
  out += escHtml(src.slice(last));
  return brLines ? out.replace(/\n/g, '<br>') : out;
}

// 再生カード（詳細画面・同じ日・ランダム用）
function veEmbedsHtml(text) {
  const videos = veFindVideos(text);
  if (!videos.length) return '';
  return `<div class="ve-list">${videos.map(veCardHtml_).join('')}</div>`;
}

function veCardHtml_(v) {
  const p = VE_PLATFORMS[v.platform];
  const cls = ['ve-card', 've-' + v.platform];
  if (v.vertical) cls.push('ve-vertical');
  if (v.tall) cls.push('ve-tall');
  const poster = v.thumb
    ? `<img class="ve-thumb" src="${escHtml(v.thumb)}" alt="" loading="lazy">`
    : `<div class="ve-poster" style="background:${p.color}"><span class="ve-poster-icon">${p.icon}</span><span>${escHtml(p.name)}</span></div>`;
  return `
    <div class="${cls.join(' ')}" data-embed="${escHtml(v.embed)}" onclick="event.stopPropagation()">
      <button type="button" class="ve-play-area" onclick="vePlay(this.parentNode)" aria-label="${escHtml(p.name)}を再生">
        ${poster}
        <span class="ve-play-btn">▶</span>
      </button>
      <div class="ve-foot">
        <span class="ve-badge" style="background:${p.color}">${p.icon} ${escHtml(p.name)}</span>
        <a href="${escHtml(v.url)}" target="_blank" rel="noopener noreferrer" class="ve-open">${escHtml(p.name)}で開く ↗</a>
      </div>
    </div>`;
}

// 再生ボタン → その場でプレーヤーに差し替え
function vePlay(card) {
  if (!card || card.classList.contains('playing')) return;
  const area = card.querySelector('.ve-play-area');
  const frame = document.createElement('iframe');
  frame.src = card.dataset.embed;
  frame.className = 've-frame';
  frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
  frame.setAttribute('allowfullscreen', '');
  frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  frame.setAttribute('loading', 'lazy');
  frame.title = '動画';
  area.replaceWith(frame);
  card.classList.add('playing');
}

// 一覧カード用の小さな目印（例：「▶️ YouTube」「📸 Instagram ×2」）
function veChipsHtml(text) {
  const videos = veFindVideos(text);
  if (!videos.length) return '';
  const count = {};
  videos.forEach(v => { count[v.platform] = (count[v.platform] || 0) + 1; });
  return `<div class="ve-chips">${Object.keys(count).map(k => {
    const p = VE_PLATFORMS[k];
    return `<span class="ve-chip" style="border-color:${p.color};color:${p.color}">${p.icon} ${escHtml(p.name)}${count[k] > 1 ? ' ×' + count[k] : ''}</span>`;
  }).join('')}</div>`;
}

// 一覧の本文プレビュー用：URLを「🔗」に縮めて読みやすくする
function veShortenUrls(text) {
  return String(text || '').replace(VE_URL_RE, m => {
    const v = veParseUrl_(veCleanUrl_(m));
    return v ? `[${VE_PLATFORMS[v.platform].name}の動画]` : '🔗';
  });
}

// 投稿・編集フォーム：本文に貼った動画リンクをその場でプレビュー
function veBindFormPreview(textareaId, previewId) {
  const ta = document.getElementById(textareaId);
  const box = document.getElementById(previewId);
  if (!ta || !box || ta.dataset.veBound) return;
  ta.dataset.veBound = '1';
  let timer = null;
  const update = () => {
    const html = veEmbedsHtml(ta.value);
    box.innerHTML = html ? `<p class="ve-preview-label">🎬 動画リンクを見つけました（日記の中で再生できます）</p>${html}` : '';
  };
  ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 400); });
  ta.addEventListener('change', update);
  update();
}

// 見た目（どのページで読み込んでも同じ表示になるよう、ここで追加する）
(function veInjectStyle_() {
  if (document.getElementById('ve-style')) return;
  const st = document.createElement('style');
  st.id = 've-style';
  st.textContent = `
    .ve-hint { font-size:0.78rem; color:#8a7862; margin:0.35rem 0 0; }
    .ve-preview-label { font-size:0.8rem; color: var(--brown); margin:0.6rem 0 0.3rem; }
    .ve-link { color:#3a6ea5; word-break:break-all; }
    .ve-list { display:flex; flex-wrap:wrap; gap:0.7rem; margin:0.7rem 0; }
    .ve-card { width:100%; max-width:480px; background:#000; border-radius:10px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.15); }
    .ve-card.ve-vertical { max-width:300px; }
    .ve-play-area { position:relative; display:block; width:100%; aspect-ratio:16/9; border:none; padding:0; cursor:pointer; background:#000; }
    .ve-vertical .ve-play-area { aspect-ratio:9/16; max-height:480px; }
    .ve-thumb { width:100%; height:100%; object-fit:cover; display:block; }
    .ve-poster { width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0.4rem; color:#fff; font-weight:bold; font-size:0.95rem; }
    .ve-poster-icon { font-size:2.4rem; }
    .ve-play-btn {
      position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
      width:64px; height:46px; border-radius:12px; background:rgba(255,0,0,0.9); color:#fff;
      display:flex; align-items:center; justify-content:center; font-size:1.3rem; transition: transform 0.15s;
    }
    .ve-card:not(.ve-youtube) .ve-play-btn { background:rgba(0,0,0,0.65); }
    .ve-play-area:hover .ve-play-btn { transform:translate(-50%,-50%) scale(1.08); }
    .ve-frame { display:block; width:100%; aspect-ratio:16/9; border:0; background:#000; }
    .ve-vertical .ve-frame { aspect-ratio:9/16; max-height:640px; }
    .ve-tall .ve-frame { aspect-ratio:auto; height:620px; background:#fff; }
    .ve-foot { display:flex; align-items:center; justify-content:space-between; gap:0.5rem; padding:0.35rem 0.6rem; background:#fffaf0; }
    .ve-badge { color:#fff; font-size:0.72rem; padding:0.1rem 0.5rem; border-radius:10px; }
    .ve-open { font-size:0.75rem; color:#3a6ea5; }
    .ve-chips { display:flex; flex-wrap:wrap; gap:0.3rem; margin:0.3rem 0; }
    .ve-chip { font-size:0.72rem; border:1px solid; border-radius:10px; padding:0.05rem 0.5rem; background:#fff; }
    @media (max-width:600px) {
      .ve-card, .ve-card.ve-vertical { max-width:100%; }
      .ve-tall .ve-frame { height:560px; }
    }
`;
  document.head.appendChild(st);
})();
