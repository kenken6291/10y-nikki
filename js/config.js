// ★ デプロイ後にGASのURLを貼り付けてください
// ★ 画面側のバージョン（ファイルを更新したら数字と日付を上げる）
//   GAS側の GAS_VERSION と揃えておくと、画面右下の表示で反映漏れがすぐ分かる
const APP_VERSION = '3.1.0';
const APP_VERSION_DATE = '2026-11-23';
const APP_VERSION_NOTE = '日記の日付修正に対応';

const GAS_URL = 'https://script.google.com/macros/s/AKfycbyYqcZEW76V7JyHqoF8NdZh_7prmEMu0mZjwgYpa4SeCAIbOQd7sP38W639VXKM0oEJmg/exec';

// ============================================================
// Geminiモデル設定（2026年11月版）
// 画面の「AIモデル」選択肢（value がAPIのモデルID）
// 空文字 '' = 自動（汎用の最新モデル）
// 指定モデルが使えない（廃止・未公開・名前違い）場合は
// GAS側で汎用の最新モデルへ自動で切り替わる
// ============================================================
const GEMINI_MODEL_OPTIONS = [
  { value: '',                  label: '自動モード（汎用の最新）' },
  { value: 'gemini-4-hydrogen', label: '4 Hydrogen（日々の暮らしをサポート）' },
  { value: 'gemini-4-neon',     label: '4 Neon（Deeper analysis）' },
  { value: 'gemini-4-carbon',   label: '4 Carbon（Code & complex work）' },
  { value: 'gemini-4-argon',    label: '4 Argon' },
  { value: 'gemini-3.8-flash',  label: '3.8 Flash' },
  { value: 'gemini-3.5-flash',  label: '3.5 Flash' }
];

// 選んだモデルは端末（localStorage）に保存し、音声入力・写真取り込みで共通に使う
const AiModel = {
  KEY: 'tenyNikki_gemini_model',
  get() {
    let v = '';
    try { v = localStorage.getItem(this.KEY) || ''; } catch (e) { /* 無視 */ }
    return GEMINI_MODEL_OPTIONS.some(o => o.value === v) ? v : '';
  },
  set(v) {
    try { localStorage.setItem(this.KEY, v || ''); } catch (e) { /* 無視 */ }
    document.querySelectorAll('select.ai-model-select').forEach(s => { s.value = v || ''; });
  },
  label(v) {
    const o = GEMINI_MODEL_OPTIONS.find(x => x.value === v);
    return o ? o.label : (v || '自動');
  },
  // class="ai-model-select" の <select> に選択肢を入れる（ページ内に複数あっても同期）
  init() {
    const cur = this.get();
    document.querySelectorAll('select.ai-model-select').forEach(sel => {
      sel.innerHTML = '';
      GEMINI_MODEL_OPTIONS.forEach(o => {
        const op = document.createElement('option');
        op.value = o.value;
        op.textContent = o.label;
        sel.appendChild(op);
      });
      sel.value = cur;
      sel.addEventListener('change', () => this.set(sel.value));
    });
  },
  // GASの応答に自動切り替えがあった時の案内文
  fallbackNote(res) {
    if (res && res.fallback && res.model) {
      return '選んだモデルが使えなかったため「' + res.model + '」で処理しました';
    }
    return '';
  }
};
document.addEventListener('DOMContentLoaded', () => AiModel.init());

// ============================================================
// バージョン情報表示（全ページ共通・画面右下）
//   画面 vX.X.X ／ GAS vX.X.X を表示。GASが古い・違う場合は赤色で警告
//   タップで詳細（更新日・内容・GAS URL末尾）を表示
// ============================================================
const VersionInfo = {
  gas: null,
  async init() {
    const el = document.createElement('div');
    el.id = 'version-badge';
    el.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:9999;font-size:11px;' +
      'padding:3px 8px;border-radius:10px;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;' +
      'font-family:sans-serif;line-height:1.4;user-select:none;';
    el.textContent = '画面 v' + APP_VERSION + ' ／ GAS 確認中…';
    el.title = 'タップで詳細';
    el.addEventListener('click', () => this.showDetail());
    document.body.appendChild(el);

    try {
      const url = new URL(GAS_URL);
      url.searchParams.append('action', 'getVersion');
      url.searchParams.append('_ts', Date.now());
      const res = await fetch(url.toString()).then(r => r.json());
      this.gas = (res && res.version) ? res : { version: '', error: '旧バージョン（getVersion未対応）' };
    } catch (e) {
      this.gas = { version: '', error: '接続できません' };
    }
    const ok = this.gas.version === APP_VERSION;
    el.textContent = '画面 v' + APP_VERSION + ' ／ GAS ' + (this.gas.version ? 'v' + this.gas.version : '旧版');
    el.style.background = ok ? 'rgba(0,0,0,.55)' : 'rgba(200,30,30,.9)';
    if (!ok) el.title = 'GASのバージョンが画面と違います。GASを「新しいバージョン」で再デプロイしてください';
  },
  showDetail() {
    const g = this.gas || {};
    const lines = [
      '【画面】 v' + APP_VERSION + '（' + APP_VERSION_DATE + '）',
      '　' + APP_VERSION_NOTE,
      '【GAS】 ' + (g.version ? 'v' + g.version + '（' + (g.date || '') + '）' : (g.error || '確認中')),
      g.note ? '　' + g.note : '',
      '【GAS URL】 …' + GAS_URL.replace(/\/exec$/, '').slice(-12),
      '',
      (g.version && g.version === APP_VERSION)
        ? '✅ 画面とGASのバージョンは一致しています'
        : '⚠️ 一致していません。\n・GAS：デプロイを管理→編集→新しいバージョン→デプロイ\n・画面：GitHubへ反映後、強制再読み込み（Ctrl+Shift+R）'
    ].filter(x => x !== '');
    alert(lines.join('\n'));
  }
};
document.addEventListener('DOMContentLoaded', () => VersionInfo.init());
