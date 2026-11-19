// ★ デプロイ後にGASのURLを貼り付けてください
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
