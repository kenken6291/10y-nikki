# 「10年日記」コミュニティサイト 完全実装指示書 v3
## Claude への完全実装指示文

---

## 【v2 からの変更点サマリー】

本指示書は v2 をベースに、以下の要件を統合した完全版です。

1. **レスポンシブ自動判定**：スマホ／PCを自動認識し最適レイアウトで表示（v2でも対応済みだが明文化・強化）
2. **会員番号 = メールアドレス**に変更（ログインIDとして使用。ニックネーム表示は維持）
3. **会員登録フロー変更**：本人がパスワードを決めるのではなく、**仮パスワードをメール発行**→ログイン後に変更必須
4. **パスワード問い合わせ機能**：会員番号（メール）を入力 → 仮パスワード再発行 → ログイン後変更
5. **パスワード変更機能**：マイページから変更可能
6. **パスワード表示／非表示切り替え**：全パスワード入力欄に目アイコン付与
7. **SNS連絡先登録**：プロフィールに連絡用SNS（任意）を追加。イベント参加者一覧に表示
8. **イベント機能の強化**：
   - 最新順表示（v2は開催日時昇順だったが、登録日時の降順「最新の投稿が上」に変更）
   - 参加／不参加表明、定員（参加人数）設定
   - **募集期限**を設定可能
   - 募集期限超過 or 定員到達で自動的に「募集終了」表示
   - 参加者一覧にニックネーム＋SNS（任意）表示
   - イベントの登録・修正・削除（本人または管理者）
9. **免責事項・注意事項の会員登録時同意フロー**：チェックボックス必須、未チェックは登録不可
10. **操作説明ページ**：使い方をまとめた `guide.html` を新規追加し、各ページからリンク

---

## 【プロジェクト概要】

「10年日記」をテーマに、幅広い世代（10代〜80代）が集い、日常のできごとを記録・共有しながら、
自由にイベントを企画・参加できるコミュニティサイトを構築する。

- **フロントエンド**: GitHub Pages（`kenken6291.github.io/10y-nikki/`）
- **バックエンド**: Google Apps Script（GAS）+ Google スプレッドシート
- **認証**: メールアドレス（会員番号）＋パスワード（SHA-256ハッシュ化）による独自ログイン
- **管理**: 管理者ダッシュボード（PropertiesService パスワード）
- **レスポンシブ**: スマホ／PCを自動判定し最適なUIで表示
- **コンプライアンス**: 会員登録時に免責事項・注意事項への同意を必須化

---

## 【ファイル構成】

```
10y-nikki/
├── index.html          # トップページ（日記フィード・ログイン）
├── diary.html          # 日記投稿・閲覧・年表ページ
├── events.html         # イベント掲示板
├── profile.html         # マイページ（プロフィール・SNS・パスワード変更・通知設定）
├── admin.html           # 管理者ダッシュボード
├── guide.html            # ★新規：操作説明ページ
├── terms.html            # ★新規：免責事項・注意事項全文ページ
├── css/
│   └── style.css       # 共通スタイル（レスポンシブ対応）
└── js/
    ├── config.js       # GAS URL のみ記載（APIキー等なし）
    ├── auth.js         # ログイン・セッション管理・共通fetch・パスワード表示切替
    ├── diary.js        # 日記CRUD・いいね・コメント・年表
    ├── events.js       # イベントCRUD・参加／不参加・募集締切判定
    └── admin.js        # 管理者機能
```

---

## 【Google スプレッドシート構成】

スプレッドシートを1つ作成し、以下 **9シート** を用意する（列構成は v2 から一部変更）。

### シート①: `members`
| 列 | 内容 |
|----|------|
| A | memberId（= **登録メールアドレス**。会員番号として使用） |
| B | email（memberId と同一値を保持。後方互換のため残す） |
| C | passwordHash（SHA-256） |
| D | nickname |
| E | birthYear（生年 例:1990） |
| F | profile（自己紹介） |
| G | role（`member` / `admin`） |
| H | createdAt |
| I | isActive（TRUE/FALSE） |
| J | notifyLikes（TRUE/FALSE いいね通知） |
| K | notifyComments（TRUE/FALSE コメント通知） |
| L | notifyReminder（TRUE/FALSE 10年前リマインド通知） |
| M | notifyEvents（TRUE/FALSE イベント通知） |
| N | snsContact（★新規：連絡用SNS。例「Instagram: @xxxx」任意項目） |
| O | mustChangePassword（★新規：TRUE/FALSE。仮パスワードでログイン中かどうか） |
| P | termsAgreedAt（★新規：免責事項同意日時） |

> **会員番号の仕様**：`memberId` 列にはメールアドレスをそのまま格納する。これにより「会員番号＝登録メールアドレス」の要件を満たす。`email` 列は通知送信先として引き続き利用する（値は memberId と常に同一）。

### シート②: `diaries`
| 列 | 内容 |
|----|------|
| A | diaryId（UUID） |
| B | memberId（＝メールアドレス） |
| C | nickname |
| D | title |
| E | content |
| F | mood（😊😢😤😴🤔） |
| G | tags（カンマ区切り） |
| H | isPublic（TRUE/FALSE） |
| I | createdAt |
| J | updatedAt |

### シート③: `diary_likes`（いいね）
| 列 | 内容 |
|----|------|
| A | likeId（UUID） |
| B | diaryId |
| C | memberId（いいねした人） |
| D | nickname |
| E | createdAt |

### シート④: `diary_comments`（日記コメント）
| 列 | 内容 |
|----|------|
| A | commentId（UUID） |
| B | diaryId |
| C | memberId |
| D | nickname |
| E | content |
| F | createdAt |

### シート⑤: `events`
| 列 | 内容 |
|----|------|
| A | eventId（UUID） |
| B | organizerId（memberId＝メールアドレス） |
| C | organizerNickname |
| D | title |
| E | description |
| F | eventDate（開催日時） |
| G | location（場所／オンライン） |
| H | maxParticipants（定員。空欄=無制限） |
| I | tags |
| J | status（`open` / `closed` / `cancelled`） |
| K | createdAt |
| L | updatedAt |
| M | deadline（★新規：募集期限。ISO日時文字列。空欄=期限なし） |

### シート⑥: `event_participants`
| 列 | 内容 |
|----|------|
| A | participantId |
| B | eventId |
| C | memberId |
| D | nickname |
| E | joinedAt |
| F | snsContact（★新規：参加登録時点のSNS連絡先スナップショット。任意） |

### シート⑦: `event_messages`（イベント内コメント）
| 列 | 内容 |
|----|------|
| A | messageId |
| B | eventId |
| C | memberId |
| D | nickname |
| E | content |
| F | createdAt |

### シート⑧: `sessions`
| 列 | 内容 |
|----|------|
| A | token |
| B | memberId |
| C | expireAt |
| D | role |
| E | nickname |

### シート⑨: `reminder_log`（10年前リマインド送信記録）
| 列 | 内容 |
|----|------|
| A | logId |
| B | memberId |
| C | diaryId |
| D | sentAt |

---

## 【GAS 実装方針】

### ▼ セキュリティ方針（必ず守ること。v2 から変更なし）
- スプレッドシートIDはGAS内 `SPREADSHEET_ID` 定数にのみ記述。フロントエンドに書かない。
- 管理者パスワードは `PropertiesService.getScriptProperties()` にのみ保存。
- パスワードはSHA-256ハッシュ化して保存。平文保存禁止。
- セッションはUUIDトークン、有効期限24時間。
- GAS側で必ず本人確認・管理者確認を行う。フロント側の判定のみに頼らない。
- POSTは `Content-Type` ヘッダーを付けない（text/plain扱い）でCORS回避。
- GASプロジェクト自体やスプレッドシートをGitHubにコミットしない。

### ▼ 認証・登録フローの変更点（重要）

**会員登録フロー（v3）**：
1. ユーザーはメールアドレス・ニックネーム・生年（任意）・**免責事項同意チェック**のみを入力する（パスワードは入力させない）。
2. サーバー側で8桁程度のランダムな**仮パスワード**を生成し、SHA-256でハッシュ化して保存。`mustChangePassword = TRUE` で登録。
3. 仮パスワードを **MailApp** で本人のメールアドレスに送信する。
4. ユーザーは仮パスワードでログイン → `mustChangePassword = TRUE` の場合、強制的にパスワード変更画面へ誘導する（フロント側でログイン直後にチェックし、変更が完了するまで他機能を使わせない）。
5. パスワード変更完了時に `mustChangePassword = FALSE` に更新。

**パスワード問い合わせ（再発行）フロー**：
1. ログイン画面に「パスワードをお忘れの方」リンクを設置。
2. 会員番号（＝登録メールアドレス）を入力させる。
3. 該当会員が存在すれば、新しい仮パスワードを生成・ハッシュ化して上書き保存し、`mustChangePassword = TRUE` に設定。
4. 仮パスワードをメール送信。
5. 以降は登録時と同じく、ログイン後にパスワード変更を強制する。
6. **セキュリティ上の注意**：該当メールが存在しない場合でも「登録されていれば送信されました」という曖昧な成功メッセージを返し、メールアドレスの存在有無を外部から推測できないようにする（列挙攻撃対策）。

**パスワード変更フロー（マイページから任意のタイミングで実行可能）**：
1. 現在のパスワード（仮パスワードまたは現行パスワード）を入力させ、ハッシュ照合で本人確認。
2. 新しいパスワード（8文字以上）を入力させる。
3. ハッシュ化して保存し、`mustChangePassword = FALSE` に更新。

**パスワード表示／非表示切り替え**：
- すべてのパスワード入力欄（ログイン、パスワード変更の新旧パスワード）に「👁️」アイコンボタンを併設。
- クリックで `input type="password"` ⇔ `input type="text"` を切り替える。

---

## 【GAS 実装コード全文】

### ▼ Code.gs（メインルーター）

```javascript
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID'; // ★ここだけ変更
const SESSION_EXPIRE_HOURS = 24;

function doGet(e) {
  const action = e.parameter.action;
  if (action === 'getDiaries')       return getDiaries(e);
  if (action === 'getDiaryDetail')   return getDiaryDetail(e);
  if (action === 'getEvents')        return getEvents(e);
  if (action === 'getEventDetail')   return getEventDetail(e);
  if (action === 'getMessages')      return getEventMessages(e);
  return jsonRes({error: 'Invalid action'});
}

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); }
  catch(err) { return jsonRes({error: 'Invalid JSON'}); }

  const action = p.action;

  // 認証不要
  if (action === 'register')        return register(p);
  if (action === 'login')           return login(p);
  if (action === 'requestPasswordReset') return requestPasswordReset(p);
  if (action === 'adminLogin')      return adminLogin(p);

  // セッション検証
  const sess = validateSession(p.token);
  if (!sess) return jsonRes({error: 'Unauthorized', code: 401});

  // 日記
  if (action === 'postDiary')         return postDiary(p, sess);
  if (action === 'updateDiary')       return updateDiary(p, sess);
  if (action === 'deleteDiary')       return deleteDiary(p, sess);
  if (action === 'getMyDiaries')      return getMyDiaries(p, sess);
  if (action === 'getTimeline')       return getTimeline(p, sess);
  // いいね
  if (action === 'toggleLike')        return toggleLike(p, sess);
  // コメント
  if (action === 'postComment')       return postComment(p, sess);
  if (action === 'deleteComment')     return deleteComment(p, sess);
  if (action === 'getComments')       return getComments(p, sess);
  // イベント
  if (action === 'createEvent')       return createEvent(p, sess);
  if (action === 'updateEvent')       return updateEvent(p, sess);
  if (action === 'deleteEvent')       return deleteEvent(p, sess);
  if (action === 'joinEvent')         return joinEvent(p, sess);
  if (action === 'leaveEvent')        return leaveEvent(p, sess);
  if (action === 'postEventMessage')  return postEventMessage(p, sess);
  // プロフィール・通知設定・パスワード
  if (action === 'updateProfile')         return updateProfile(p, sess);
  if (action === 'updateNotifySettings')  return updateNotifySettings(p, sess);
  if (action === 'changePassword')        return changePassword(p, sess);
  if (action === 'getMyProfile')          return getMyProfile(p, sess);
  if (action === 'logout')                return logout(p.token);

  // 管理者専用
  if (sess.role !== 'admin') return jsonRes({error: 'Forbidden', code: 403});
  if (action === 'adminGetMembers')   return adminGetMembers();
  if (action === 'adminGetAllDiaries')return adminGetAllDiaries();
  if (action === 'adminGetAllEvents') return adminGetAllEvents();
  if (action === 'adminDeleteDiary')  return adminForceDiary(p);
  if (action === 'adminDeleteEvent')  return adminForceEvent(p);
  if (action === 'adminUpdateEvent')  return adminForceUpdateEvent(p);
  if (action === 'adminDeleteComment')return adminForceComment(p);
  if (action === 'adminToggleMember') return adminToggleMember(p);

  return jsonRes({error: 'Invalid action'});
}

// ===== ヘルパー =====
function jsonRes(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
function ss() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function sh(name) { return ss().getSheetByName(name); }
function allRows(name) {
  const d = sh(name).getDataRange().getValues();
  return d.slice(1);
}
function uuid() { return Utilities.getUuid(); }
function now() { return new Date().toISOString(); }
function hashPw(pw) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pw, Utilities.Charset.UTF_8);
  return d.map(b => ('0'+(b&0xFF).toString(16)).slice(-2)).join('');
}
// 仮パスワード生成（8桁、英数字）
function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pw = '';
  for (let i = 0; i < 8; i++) pw += chars.charAt(Math.floor(Math.random() * chars.length));
  return pw;
}

function validateSession(token) {
  if (!token) return null;
  const rows = allRows('sessions');
  const nowD = new Date();
  for (const r of rows) {
    if (r[0] === token && new Date(r[2]) > nowD) {
      return { memberId: r[1], role: r[3], nickname: r[4] };
    }
  }
  return null;
}

function getMemberEmail(memberId) {
  const rows = allRows('members');
  const m = rows.find(r => r[0] === memberId && r[8] === true);
  return m ? {
    email: m[1], nickname: m[3],
    notifyLikes: m[9], notifyComments: m[10],
    notifyReminder: m[11], notifyEvents: m[12],
    snsContact: m[13]
  } : null;
}
```

---

### ▼ 会員登録・ログイン・パスワード関連

```javascript
function register(p) {
  const { email, nickname, birthYear, agreedTerms } = p;
  if (!email || !nickname) return jsonRes({error: '必須項目が不足しています'});
  if (!agreedTerms) return jsonRes({error: '免責事項・注意事項への同意が必要です'});

  const rows = allRows('members');
  if (rows.find(r => r[0] === email)) return jsonRes({error: 'このメールアドレスは既に登録済みです'});

  const tempPassword = generateTempPassword();

  sh('members').appendRow([
    email,                  // A memberId = メールアドレス
    email,                  // B email
    hashPw(tempPassword),   // C passwordHash
    nickname,               // D nickname
    birthYear || '',        // E birthYear
    '',                     // F profile
    'member',               // G role
    now(),                  // H createdAt
    true,                   // I isActive
    true, true, true, true, // J-M 通知設定デフォルトON
    '',                     // N snsContact
    true,                   // O mustChangePassword
    now()                   // P termsAgreedAt
  ]);

  try {
    MailApp.sendEmail({
      to: email,
      subject: '【10年日記】ご登録ありがとうございます（仮パスワードのお知らせ）',
      body: nickname + ' さん、ようこそ「10年日記」へ！\n\n' +
        '会員番号（ログインID）: ' + email + '\n' +
        '仮パスワード: ' + tempPassword + '\n\n' +
        'こちらの仮パスワードでログイン後、必ずパスワードを変更してください。\n\n' +
        'https://kenken6291.github.io/10y-nikki/'
    });
  } catch(e) { /* メール失敗は無視（登録自体は成功させる） */ }

  return jsonRes({success: true});
}

function login(p) {
  const { email, password } = p;
  const rows = allRows('members');
  const hash = hashPw(password);
  const m = rows.find(r => r[0] === email && r[2] === hash && r[8] === true);
  if (!m) return jsonRes({error: '会員番号またはパスワードが違います'});

  const token = uuid();
  const expire = new Date(Date.now() + SESSION_EXPIRE_HOURS * 3600000);
  sh('sessions').appendRow([token, m[0], expire.toISOString(), m[6], m[3]]);
  return jsonRes({
    success: true, token, nickname: m[3], memberId: m[0], role: m[6],
    birthYear: m[4], mustChangePassword: m[14] === true
  });
}

// パスワード問い合わせ（仮パスワード再発行）
function requestPasswordReset(p) {
  const { email } = p;
  if (!email) return jsonRes({error: '会員番号（メールアドレス）を入力してください'});

  const sheet = sh('members');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email && data[i][8] === true) {
      const tempPassword = generateTempPassword();
      sheet.getRange(i+1, 3).setValue(hashPw(tempPassword));  // C passwordHash
      sheet.getRange(i+1, 15).setValue(true);                  // O mustChangePassword
      try {
        MailApp.sendEmail({
          to: email,
          subject: '【10年日記】仮パスワード発行のお知らせ',
          body: data[i][3] + ' さんへ\n\n' +
            'パスワード再設定のリクエストを受け付けました。\n\n' +
            '会員番号: ' + email + '\n' +
            '新しい仮パスワード: ' + tempPassword + '\n\n' +
            'こちらの仮パスワードでログイン後、必ずパスワードを変更してください。\n\n' +
            '※心当たりのない場合は、このメールを破棄してください。'
        });
      } catch(e) {}
      break;
    }
  }
  // メールの存在有無に関わらず同一レスポンス（列挙攻撃対策）
  return jsonRes({success: true, message: '登録されているメールアドレスの場合、仮パスワードを送信しました'});
}

// パスワード変更
function changePassword(p, sess) {
  const { currentPassword, newPassword } = p;
  if (!newPassword || newPassword.length < 8) return jsonRes({error: '新しいパスワードは8文字以上にしてください'});

  const sheet = sh('members');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === sess.memberId) {
      if (data[i][2] !== hashPw(currentPassword)) {
        return jsonRes({error: '現在のパスワードが正しくありません'});
      }
      sheet.getRange(i+1, 3).setValue(hashPw(newPassword)); // C passwordHash
      sheet.getRange(i+1, 15).setValue(false);              // O mustChangePassword = false
      return jsonRes({success: true});
    }
  }
  return jsonRes({error: '会員が見つかりません'});
}

function adminLogin(p) {
  const adminPass = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (p.password !== adminPass) return jsonRes({error: 'パスワードが違います'});
  const token = uuid();
  const expire = new Date(Date.now() + SESSION_EXPIRE_HOURS * 3600000);
  sh('sessions').appendRow([token, 'admin', expire.toISOString(), 'admin', '管理者']);
  return jsonRes({ success: true, token, nickname: '管理者', memberId: 'admin', role: 'admin' });
}

function logout(token) {
  const sheet = sh('sessions');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) { sheet.deleteRow(i+1); break; }
  }
  return jsonRes({success: true});
}

function getMyProfile(p, sess) {
  const rows = allRows('members');
  const m = rows.find(r => r[0] === sess.memberId);
  if (!m) return jsonRes({error: '会員が見つかりません'});
  return jsonRes({success: true, profile: {
    nickname: m[3], birthYear: m[4], profile: m[5], snsContact: m[13],
    notifyLikes: m[9], notifyComments: m[10], notifyReminder: m[11], notifyEvents: m[12]
  }});
}

function updateProfile(p, sess) {
  const sheet = sh('members');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === sess.memberId) {
      if (p.nickname    !== undefined) sheet.getRange(i+1,4).setValue(p.nickname);
      if (p.profile     !== undefined) sheet.getRange(i+1,7).setValue(p.profile);
      if (p.birthYear   !== undefined) sheet.getRange(i+1,6).setValue(p.birthYear);
      if (p.snsContact  !== undefined) sheet.getRange(i+1,14).setValue(p.snsContact);
      return jsonRes({success: true});
    }
  }
  return jsonRes({error: '会員が見つかりません'});
}

function updateNotifySettings(p, sess) {
  const sheet = sh('members');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === sess.memberId) {
      sheet.getRange(i+1,10).setValue(p.notifyLikes    !== undefined ? p.notifyLikes    : data[i][9]);
      sheet.getRange(i+1,11).setValue(p.notifyComments !== undefined ? p.notifyComments : data[i][10]);
      sheet.getRange(i+1,12).setValue(p.notifyReminder !== undefined ? p.notifyReminder : data[i][11]);
      sheet.getRange(i+1,13).setValue(p.notifyEvents   !== undefined ? p.notifyEvents   : data[i][12]);
      return jsonRes({success: true});
    }
  }
  return jsonRes({error: '会員が見つかりません'});
}
```

> **列インデックス注意**：上記コードの `getRange(i+1, N)` の列番号は `members` シートが A〜P の16列構成（A=1, B=2, ... P=16）であることを前提にしている。実装時は必ずシートの実列順と一致させてから動作確認すること。

---

### ▼ 日記 CRUD・いいね・コメント・年表・10年前リマインド

この部分は **v2 と同一仕様**のため割愛する（v2指示書の該当セクションをそのまま使用すること）。`memberId` が「UUID」から「メールアドレス」に意味が変わる点のみ注意し、コード自体の変更は不要（`memberId` を文字列として扱っている箇所はそのまま動作する）。

---

### ▼ イベント CRUD（v3 で強化：募集期限・自動締切・SNS表示）

```javascript
function getEvents(e) {
  const rows = allRows('events');
  const pRows = allRows('event_participants');
  const nowD = new Date();

  const events = rows
    .filter(r => r[9] !== 'cancelled')
    .map(r => {
      const participantCount = pRows.filter(p => p[1] === r[0]).length;
      const deadline = r[12] ? new Date(r[12]) : null;
      const maxP = r[7] ? parseInt(r[7]) : null;

      // 自動締切判定：ステータスがopenでも、期限超過または定員到達なら表示上closedにする
      let effectiveStatus = r[9];
      if (effectiveStatus === 'open') {
        const deadlinePassed = deadline && nowD > deadline;
        const fullyBooked = maxP && participantCount >= maxP;
        if (deadlinePassed || fullyBooked) effectiveStatus = 'closed';
      }

      return {
        eventId: r[0], organizerId: r[1], organizerNickname: r[2],
        title: r[3], description: r[4], eventDate: r[5],
        location: r[6], maxParticipants: r[7], tags: r[8],
        status: effectiveStatus, rawStatus: r[9],
        createdAt: r[10], updatedAt: r[11], deadline: r[12],
        participantCount
      };
    });

  // 最新の投稿順（createdAt 降順）
  events.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  return jsonRes({success: true, events});
}

function getEventDetail(e) {
  const { eventId } = e.parameter;
  const rows = allRows('events');
  const r = rows.find(x => x[0] === eventId);
  if (!r) return jsonRes({error: 'イベントが見つかりません'});

  const pRows = allRows('event_participants').filter(p => p[1] === eventId);
  const participants = pRows.map(p => ({
    memberId: p[2], nickname: p[3], joinedAt: p[4], snsContact: p[5] || ''
  }));
  const messages = allRows('event_messages')
    .filter(m => m[1] === eventId)
    .map(m => ({messageId: m[0], memberId: m[2], nickname: m[3], content: m[4], createdAt: m[5]}));

  const nowD = new Date();
  const deadline = r[12] ? new Date(r[12]) : null;
  const maxP = r[7] ? parseInt(r[7]) : null;
  let effectiveStatus = r[9];
  if (effectiveStatus === 'open') {
    const deadlinePassed = deadline && nowD > deadline;
    const fullyBooked = maxP && participants.length >= maxP;
    if (deadlinePassed || fullyBooked) effectiveStatus = 'closed';
  }

  return jsonRes({success: true,
    event: {eventId: r[0], organizerId: r[1], organizerNickname: r[2],
      title: r[3], description: r[4], eventDate: r[5], location: r[6],
      maxParticipants: r[7], tags: r[8], status: effectiveStatus, rawStatus: r[9],
      createdAt: r[10], updatedAt: r[11], deadline: r[12]},
    participants, messages});
}

function createEvent(p, sess) {
  const { title, eventDate, description, location, maxParticipants, tags, deadline } = p;
  if (!title || !eventDate) return jsonRes({error: 'タイトルと開催日時は必須です'});
  const eventId = uuid();
  const n = now();
  sh('events').appendRow([eventId, sess.memberId, sess.nickname, title,
    description||'', eventDate, location||'', maxParticipants||'', tags||'',
    'open', n, n, deadline||'']);
  return jsonRes({success: true, eventId});
}

function updateEvent(p, sess) {
  const sheet = sh('events');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.eventId) {
      if (data[i][1] !== sess.memberId && sess.role !== 'admin')
        return jsonRes({error: '編集権限がありません'});
      if (p.title           !== undefined) sheet.getRange(i+1,4).setValue(p.title);
      if (p.description     !== undefined) sheet.getRange(i+1,5).setValue(p.description);
      if (p.eventDate       !== undefined) sheet.getRange(i+1,6).setValue(p.eventDate);
      if (p.location        !== undefined) sheet.getRange(i+1,7).setValue(p.location);
      if (p.maxParticipants !== undefined) sheet.getRange(i+1,8).setValue(p.maxParticipants);
      if (p.tags            !== undefined) sheet.getRange(i+1,9).setValue(p.tags);
      if (p.status           !== undefined) sheet.getRange(i+1,10).setValue(p.status);
      if (p.deadline          !== undefined) sheet.getRange(i+1,13).setValue(p.deadline);
      sheet.getRange(i+1,12).setValue(now());

      if (p.notifyParticipants) {
        const pRows = allRows('event_participants').filter(r => r[1] === p.eventId);
        pRows.forEach(par => {
          const m = getMemberEmail(par[2]);
          if (m && m.notifyEvents) {
            try {
              MailApp.sendEmail({
                to: m.email,
                subject: '【10年日記】イベント「' + data[i][3] + '」の情報が更新されました',
                body: m.nickname + ' さんへ\n\n参加中のイベント「' + (p.title || data[i][3]) + '」の情報が更新されました。\n\n' +
                  'https://kenken6291.github.io/10y-nikki/events.html?id=' + p.eventId
              });
            } catch(e) {}
          }
        });
      }
      return jsonRes({success: true});
    }
  }
  return jsonRes({error: 'イベントが見つかりません'});
}

function deleteEvent(p, sess) {
  const sheet = sh('events');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.eventId) {
      if (data[i][1] !== sess.memberId && sess.role !== 'admin')
        return jsonRes({error: '削除権限がありません'});
      sheet.deleteRow(i+1);
      return jsonRes({success: true});
    }
  }
  return jsonRes({error: 'イベントが見つかりません'});
}

// 参加表明
function joinEvent(p, sess) {
  const { eventId } = p;
  const eRows = allRows('events');
  const event = eRows.find(r => r[0] === eventId);
  if (!event) return jsonRes({error: 'イベントが見つかりません'});
  if (event[9] === 'cancelled') return jsonRes({error: 'このイベントはキャンセルされています'});
  if (event[9] === 'closed') return jsonRes({error: 'このイベントは募集終了しています'});

  const nowD = new Date();
  const deadline = event[12] ? new Date(event[12]) : null;
  if (deadline && nowD > deadline) return jsonRes({error: '募集期限を過ぎています'});

  const pRows = allRows('event_participants').filter(r => r[1] === eventId);
  if (pRows.some(r => r[2] === sess.memberId)) return jsonRes({error: '既に参加登録済みです'});

  const maxP = event[7] ? parseInt(event[7]) : null;
  if (maxP && pRows.length >= maxP) return jsonRes({error: '定員に達しています'});

  // SNS連絡先のスナップショットを取得
  const memberInfo = getMemberEmail(sess.memberId);
  const snsContact = memberInfo ? (memberInfo.snsContact || '') : '';

  sh('event_participants').appendRow([uuid(), eventId, sess.memberId, sess.nickname, now(), snsContact]);

  // 定員到達 or 期限到達なら自動的にステータスをcloseに更新
  const newCount = pRows.length + 1;
  if (maxP && newCount >= maxP) {
    const sheet = sh('events');
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === eventId) { sheet.getRange(i+1,10).setValue('closed'); break; }
    }
  }

  // 主催者にメール通知
  const org = getMemberEmail(event[1]);
  if (org && org.notifyEvents) {
    try {
      MailApp.sendEmail({
        to: org.email,
        subject: '【10年日記】「' + event[3] + '」に新しい参加者が加わりました',
        body: org.nickname + ' さんへ\n\n' +
          sess.nickname + ' さんがイベント「' + event[3] + '」に参加しました。\n' +
          '現在の参加者数: ' + newCount + '名' + (maxP ? ' / ' + maxP + '名' : '') + '\n\n' +
          'https://kenken6291.github.io/10y-nikki/events.html?id=' + eventId
      });
    } catch(e) {}
  }
  return jsonRes({success: true});
}

// 不参加（参加取消）
function leaveEvent(p, sess) {
  const sheet = sh('event_participants');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === p.eventId && data[i][2] === sess.memberId) {
      sheet.deleteRow(i+1);

      // 定員割れで再度openにする（期限内であれば）
      const eRows = allRows('events');
      const event = eRows.find(r => r[0] === p.eventId);
      if (event && event[9] === 'closed') {
        const nowD = new Date();
        const deadline = event[12] ? new Date(event[12]) : null;
        const deadlineOk = !deadline || nowD <= deadline;
        if (deadlineOk) {
          const evSheet = sh('events');
          const evData = evSheet.getDataRange().getValues();
          for (let j = 1; j < evData.length; j++) {
            if (evData[j][0] === p.eventId) { evSheet.getRange(j+1,10).setValue('open'); break; }
          }
        }
      }
      return jsonRes({success: true});
    }
  }
  return jsonRes({error: '参加登録が見つかりません'});
}

function postEventMessage(p, sess) {
  const { eventId, content } = p;
  if (!content) return jsonRes({error: 'メッセージを入力してください'});
  const messageId = uuid();
  sh('event_messages').appendRow([messageId, eventId, sess.memberId, sess.nickname, content, now()]);

  if (p.notifyAll) {
    const eRows = allRows('events');
    const event = eRows.find(r => r[0] === eventId);
    const pRows = allRows('event_participants').filter(r => r[1] === eventId && r[2] !== sess.memberId);
    pRows.forEach(par => {
      const m = getMemberEmail(par[2]);
      if (m && m.notifyEvents) {
        try {
          MailApp.sendEmail({
            to: m.email,
            subject: '【10年日記】イベント「' + (event ? event[3] : '') + '」に新しい連絡があります',
            body: m.nickname + ' さんへ\n\n' +
              sess.nickname + ' さんからメッセージが届きました:\n\n' +
              '「' + content + '」\n\n' +
              'https://kenken6291.github.io/10y-nikki/events.html?id=' + eventId
          });
        } catch(e) {}
      }
    });
  }
  return jsonRes({success: true, messageId});
}

function getEventMessages(e) {
  const rows = allRows('event_messages')
    .filter(r => r[1] === e.parameter.eventId)
    .map(r => ({messageId: r[0], memberId: r[2], nickname: r[3], content: r[4], createdAt: r[5]}));
  return jsonRes({success: true, messages: rows});
}
```

> **募集終了の自動判定ロジック**：`getEvents` / `getEventDetail` 取得時に都度「期限超過」「定員到達」を判定して `effectiveStatus` を返す（リアルタイム判定）のに加え、`joinEvent` 内で定員に達した瞬間にシート上のステータスも `closed` に書き込む（実体としても締め切る）二重の仕組みにしている。これにより一覧表示は常に最新の正しい状態を反映しつつ、シート上のデータとしても締切が記録される。

---

### ▼ 管理者専用（v3でイベント管理を追加）

```javascript
function adminGetMembers() {
  const rows = allRows('members').map(r => ({
    memberId: r[0], email: r[1], nickname: r[3], birthYear: r[4],
    role: r[6], createdAt: r[7], isActive: r[8], snsContact: r[13]
  }));
  return jsonRes({success: true, members: rows});
}

function adminGetAllDiaries() {
  const rows = allRows('diaries').map(r => ({
    diaryId: r[0], memberId: r[1], nickname: r[2], title: r[3],
    isPublic: r[7], createdAt: r[8]
  }));
  rows.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  return jsonRes({success: true, diaries: rows});
}

function adminGetAllEvents() {
  const rows = allRows('events').map(r => ({
    eventId: r[0], organizerNickname: r[2], title: r[3],
    eventDate: r[5], status: r[9], createdAt: r[10]
  }));
  rows.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  return jsonRes({success: true, events: rows});
}

function adminForceDiary(p)   { return deleteDiary(p, {memberId: null, role: 'admin'}); }
function adminForceEvent(p)   { return deleteEvent(p, {memberId: null, role: 'admin'}); }
function adminForceComment(p) { return deleteComment(p, {memberId: null, role: 'admin'}); }
function adminForceUpdateEvent(p) { return updateEvent(p, {memberId: null, role: 'admin'}); }

function adminToggleMember(p) {
  const sheet = sh('members');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.memberId) {
      sheet.getRange(i+1,9).setValue(!data[i][8]);
      return jsonRes({success: true, isActive: !data[i][8]});
    }
  }
  return jsonRes({error: '会員が見つかりません'});
}
```

---

## 【フロントエンド実装指示】

### ▼ js/config.js（GAS URLのみ。APIキー等は一切書かない）

```javascript
const GAS_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
```

### ▼ js/auth.js（v3で拡張：mustChangePassword判定・パスワード表示切替）

```javascript
const Auth = {
  getToken:    () => sessionStorage.getItem('token'),
  getNickname: () => sessionStorage.getItem('nickname'),
  getMemberId: () => sessionStorage.getItem('memberId'), // ＝メールアドレス
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
    Object.entries(params).forEach(([k,v]) => url.searchParams.append(k,v));
    const res = await fetch(url, { redirect: 'follow' });
    return res.json();
  }
};

// パスワード表示／非表示の切替ボタンを共通化
function togglePasswordVisibility(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') {
    input.type = 'text';
    btnEl.textContent = '🙈';
  } else {
    input.type = 'password';
    btnEl.textContent = '👁️';
  }
}

// ログイン直後、仮パスワードのままなら強制的にパスワード変更を促す
function enforcePasswordChangeIfNeeded() {
  if (Auth.isLoggedIn() && Auth.mustChangePassword() && !location.pathname.endsWith('profile.html')) {
    sessionStorage.setItem('forcePasswordChangeRedirect', '1');
    location.href = 'profile.html?forceChange=1';
  }
}
```

### ▼ レスポンシブ自動判定の方針

- CSS の `@media` クエリ（`max-width: 768px` をブレークポイント）で、スマホはボトムナビ＋1カラム、PCはヘッダーナビ＋複数カラムに**自動的に**切り替える（v2のCSSと同様の方針を踏襲。JSでのUser-Agent判定は行わず、CSSメディアクエリのみで実現することで、画面回転やウィンドウリサイズにもリアルタイムに追従させる）。
- タップ領域は44px以上を確保し、スマホでの操作性を担保する。

---

## 【各ページ実装詳細（v3 差分のみ記載。共通部分は v2 を踏襲）】

### ▼ index.html（トップページ）

- ヒーローセクション・日記フィード・世代フィルターは v2 を踏襲。
- ログインモーダルに「パスワードをお忘れの方はこちら」リンクを追加 → パスワード問い合わせモーダルを開く。
- 登録モーダルから**パスワード入力欄を削除**し、代わりに以下を追加：
  - 免責事項・注意事項の要約と、全文へのリンク（`terms.html` を新規タブで開く）
  - 「上記の内容に同意します」チェックボックス（**未チェック時は登録ボタンを無効化**）
- フッターまたはヘッダーに「📖 使い方」リンクを設置し `guide.html` へ遷移。

**登録モーダルの実装例**：
```html
<div class="form-group">
  <label>メールアドレス（会員番号として使用します）</label>
  <input type="email" id="reg-email" autocomplete="email">
</div>
<div class="form-group">
  <label>ニックネーム</label>
  <input type="text" id="reg-nickname" maxlength="20">
</div>
<div class="form-group">
  <label>生まれた年（任意）</label>
  <input type="number" id="reg-birthyear" min="1940" max="2015">
</div>
<div class="terms-box">
  <p>登録には以下の内容への同意が必要です。</p>
  <a href="terms.html" target="_blank">免責事項・注意事項を全文表示する ↗</a>
  <label class="checkbox-row">
    <input type="checkbox" id="reg-agree-terms">
    上記の免責事項・注意事項に同意します
  </label>
</div>
<button class="btn-primary" id="register-submit-btn" disabled onclick="doRegister()">
  登録する（仮パスワードをメールでお送りします）
</button>
```

```javascript
document.getElementById('reg-agree-terms').addEventListener('change', function() {
  document.getElementById('register-submit-btn').disabled = !this.checked;
});

async function doRegister() {
  const email     = document.getElementById('reg-email').value.trim();
  const nickname  = document.getElementById('reg-nickname').value.trim();
  const birthYear = document.getElementById('reg-birthyear').value;
  const agreedTerms = document.getElementById('reg-agree-terms').checked;
  if (!email || !nickname) { showToast('必須項目を入力してください', 'error'); return; }
  if (!agreedTerms) { showToast('免責事項への同意が必要です', 'error'); return; }
  try {
    const res = await Auth.post({ action: 'register', email, nickname, birthYear, agreedTerms });
    if (res.success) {
      showToast('登録完了！仮パスワードをメールで送信しました 📧');
      switchAuthTab('login');
      document.getElementById('login-email').value = email;
    } else {
      showToast(res.error || '登録に失敗しました', 'error');
    }
  } catch(e) { showToast('通信エラーが発生しました', 'error'); }
}
```

**パスワード問い合わせモーダル**：
```html
<div class="modal-overlay" id="reset-modal">
  <div class="modal-box">
    <button class="modal-close" onclick="document.getElementById('reset-modal').style.display='none'">✕</button>
    <h2 class="modal-title">🔑 パスワードをお忘れの方</h2>
    <p style="font-size:0.88rem;color:#7a5c4a;margin-bottom:1rem;">
      会員番号（登録メールアドレス）を入力してください。仮パスワードを発行しメールでお送りします。
    </p>
    <div class="form-group">
      <label>会員番号（メールアドレス）</label>
      <input type="email" id="reset-email">
    </div>
    <button class="btn-primary" style="width:100%" onclick="doRequestReset()">仮パスワードを発行する</button>
  </div>
</div>
```

```javascript
async function doRequestReset() {
  const email = document.getElementById('reset-email').value.trim();
  if (!email) { showToast('会員番号を入力してください', 'error'); return; }
  try {
    const res = await Auth.post({ action: 'requestPasswordReset', email });
    showToast(res.message || '送信しました');
    document.getElementById('reset-modal').style.display = 'none';
  } catch(e) { showToast('通信エラーが発生しました', 'error'); }
}
```

**ログインフォームへのパスワード表示切替の組み込み例**：
```html
<div class="form-group">
  <label>パスワード</label>
  <div class="password-input-wrap">
    <input type="password" id="login-password">
    <button type="button" class="pw-toggle-btn" onclick="togglePasswordVisibility('login-password', this)">👁️</button>
  </div>
</div>
<p class="mt-1" style="text-align:right;">
  <a href="#" style="font-size:0.85rem;color:var(--amber);" onclick="document.getElementById('reset-modal').style.display='flex';return false;">
    パスワードをお忘れの方はこちら
  </a>
</p>
```

```css
.password-input-wrap { position: relative; }
.password-input-wrap input { padding-right: 2.5rem; }
.pw-toggle-btn {
  position: absolute; right: 0.5rem; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer; font-size: 1rem;
}
```

---

### ▼ profile.html（マイページ）— v3 で大幅拡張

**強制パスワード変更画面**（`mustChangePassword === true` の場合に表示。他のセクションは隠す）：
```html
<div id="force-change-section" class="form-card" style="display:none;">
  <h2>🔐 パスワードの変更が必要です</h2>
  <p style="font-size:0.9rem;color:#7a5c4a;margin-bottom:1rem;">
    仮パスワードでログイン中です。安全のため、新しいパスワードを設定してください。
  </p>
  <div class="form-group">
    <label>現在の仮パスワード</label>
    <div class="password-input-wrap">
      <input type="password" id="force-current-pw">
      <button type="button" class="pw-toggle-btn" onclick="togglePasswordVisibility('force-current-pw', this)">👁️</button>
    </div>
  </div>
  <div class="form-group">
    <label>新しいパスワード（8文字以上）</label>
    <div class="password-input-wrap">
      <input type="password" id="force-new-pw">
      <button type="button" class="pw-toggle-btn" onclick="togglePasswordVisibility('force-new-pw', this)">👁️</button>
    </div>
  </div>
  <button class="btn-primary" style="width:100%" onclick="submitForcePasswordChange()">パスワードを変更して続ける</button>
</div>
```

**通常のパスワード変更セクション**（マイページ常設）：
```html
<div class="form-card mt-2">
  <h2>🔑 パスワード変更</h2>
  <div class="form-group">
    <label>現在のパスワード</label>
    <div class="password-input-wrap">
      <input type="password" id="pw-current">
      <button type="button" class="pw-toggle-btn" onclick="togglePasswordVisibility('pw-current', this)">👁️</button>
    </div>
  </div>
  <div class="form-group">
    <label>新しいパスワード（8文字以上）</label>
    <div class="password-input-wrap">
      <input type="password" id="pw-new">
      <button type="button" class="pw-toggle-btn" onclick="togglePasswordVisibility('pw-new', this)">👁️</button>
    </div>
  </div>
  <div class="form-footer">
    <button class="btn-primary" onclick="changePassword()">パスワードを変更する</button>
  </div>
</div>
```

```javascript
async function changePassword() {
  const currentPassword = document.getElementById('pw-current').value;
  const newPassword     = document.getElementById('pw-new').value;
  if (!currentPassword || !newPassword) { showToast('全て入力してください', 'error'); return; }
  if (newPassword.length < 8) { showToast('新しいパスワードは8文字以上にしてください', 'error'); return; }
  try {
    const res = await Auth.post({ action: 'changePassword', token: Auth.getToken(), currentPassword, newPassword });
    if (res.success) {
      showToast('パスワードを変更しました ✅');
      document.getElementById('pw-current').value = '';
      document.getElementById('pw-new').value = '';
    } else showToast(res.error || 'エラー', 'error');
  } catch(e) { showToast('エラー', 'error'); }
}

async function submitForcePasswordChange() {
  const currentPassword = document.getElementById('force-current-pw').value;
  const newPassword     = document.getElementById('force-new-pw').value;
  if (!currentPassword || !newPassword) { showToast('全て入力してください', 'error'); return; }
  if (newPassword.length < 8) { showToast('8文字以上にしてください', 'error'); return; }
  try {
    const res = await Auth.post({ action: 'changePassword', token: Auth.getToken(), currentPassword, newPassword });
    if (res.success) {
      sessionStorage.setItem('mustChangePassword', 'false');
      showToast('パスワードを変更しました。ようこそ！');
      document.getElementById('force-change-section').style.display = 'none';
      document.getElementById('profile-main-content').style.display = 'block';
    } else showToast(res.error || 'エラー', 'error');
  } catch(e) { showToast('エラー', 'error'); }
}
```

**SNS連絡先の登録欄**（プロフィール編集セクションに追加）：
```html
<div class="form-group">
  <label>連絡用SNS（任意・イベント参加者にのみ公開されます）</label>
  <input type="text" id="p-sns" placeholder="例: Instagram @your_id / LINE ID: xxxx">
</div>
```

**会員番号の表示**（マイページ上部、編集不可の表示として）：
```html
<p style="font-size:0.85rem;color:#7a5c4a;">会員番号（ログインID）: <strong id="p-member-id"></strong></p>
```

---

### ▼ events.html（イベント掲示板）— v3 で大幅拡張

**イベント作成フォームに募集期限を追加**：
```html
<div class="form-group">
  <label>定員（参加人数。空欄=無制限）</label>
  <input type="number" id="ev-max" min="2" max="9999">
</div>
<div class="form-group">
  <label>募集期限（任意）</label>
  <input type="datetime-local" id="ev-deadline">
</div>
```

**イベントカードに状態バッジ・最新順表示**：
- `getEvents` は `createdAt` 降順で返却されるため、フロント側は受け取った順にそのまま描画すればよい（最新の投稿が一番上）。
- ステータスバッジは `open`（受付中・緑）/ `closed`（募集終了・グレー）/ `cancelled`（キャンセル・赤）の3種。
- 募集期限が設定されている場合はカードに「〆切: 2026年7月1日（水）18:00」のように表示する。

**参加者一覧にSNS表示を追加**（イベント詳細モーダル）：
```javascript
function renderParticipants(participants) {
  return participants.map(p => `
    <div class="participant-card">
      <span class="participant-name">${escHtml(p.nickname)}</span>
      ${p.snsContact ? `<span class="participant-sns">📱 ${escHtml(p.snsContact)}</span>` : ''}
    </div>
  `).join('');
}
```

```css
.participant-card {
  display: flex; flex-direction: column; gap: 0.15rem;
  background: var(--sub-bg); padding: 0.5rem 0.75rem; border-radius: 8px;
  border: 1px solid #c9b99a; min-width: 140px;
}
.participant-name { font-weight: 700; color: var(--brown); font-size: 0.88rem; }
.participant-sns { font-size: 0.78rem; color: #7a5c4a; }
```

**不参加ボタンの文言を明確化**：v2 の `leaveEvent` 呼び出しボタンは「参加をキャンセルする」のままでよいが、ボタン群に「✅ 参加する」「❌ 不参加（参加取消）」を対で表示し、現在の参加状態が一目でわかるようにする。

**募集終了時の表示**：
```javascript
// ev.status === 'closed' の場合
`<span class="closed-note">
  ${ev.deadline && new Date() > new Date(ev.deadline) ? '⏰ 募集期限を過ぎました' : '👥 定員に達しました'}
</span>`
```

---

### ▼ guide.html（★新規：操作説明ページ）

シンプルな静的ページとして、主要機能の使い方を見出し付きで解説する。各ページのヘッダー／ボトムナビに「📖 使い方」リンクを追加し、このページへ遷移できるようにする。

**掲載すべき内容（最低限）**：
1. 会員登録の流れ（メール登録 → 仮パスワード受信 → ログイン → パスワード変更）
2. パスワードを忘れた場合の再発行方法
3. 日記の書き方・公開設定・いいね・コメントの使い方
4. 年表機能の見方
5. イベントの探し方・参加表明・不参加の方法
6. イベントの企画方法（定員・募集期限の設定方法を含む）
7. 通知設定の変更方法
8. 免責事項・注意事項（`terms.html` への直接リンク）
9. 困ったときの問い合わせ先（運営が用意する場合は明記。ボランティア運営の旨を明示）

---

### ▼ terms.html（★新規：免責事項・注意事項全文ページ）

ユーザーが提供した以下の全文をそのまま掲載する静的ページとして作成する。改変せず転記すること。見出し・段落構成も維持する。

```
◻️免責事項および注意事項◻️

本サービス（以下「当サービス」といいます）は、有志のボランティアにより運営され、会員の皆様に無料で提供されているものです。
ご利用いただくにあたり、会員の皆様に安心・安全にご利用いただくための注意事項および免責事項を定めています。会員登録を完了された時点で、本内容に同意したものとみなされます。

1. 無料提供およびボランティア運営に伴う原則
当サービスはボランティアによる善意で運営されており、会員に対して何らの対価を求めるものではありません。
運営側は、当サービスの永続的な提供、運営サポート、システムの完全性（エラーやバグの不発生）、および特定の目的への適合性について、いかなる保証も行いません。

2. 自己責任の原則
会員は、当サービスが無料のボランティア運営であることを十分理解した上で、自己の責任において当サービスを利用するものとします。
当サービスを通じて提供される情報、他の会員とのやり取り、およびそれに付随する一切の行為については、会員ご自身でその正確性や安全性を判断してください。

3. 当事者間での問題解決
当サービスをきっかけとして生じた会員間、または会員と第三者との間のトラブル、紛争、損害（金銭的トラブル、誹謗中傷、出会いに関するトラブル等を含みますがこれらに限りません）については、すべて当事者間で解決するものとします。

4. 運営側の不関与（免責事項）
運営側は、会員間のトラブルおよび会員が被った損害について、理由の如何を問わず一切の責任を負いません。また、トラブルに対する仲裁、調停、相談対応、交渉等を行う義務も負わないものとします。
ボランティア運営の特性上、事前の予告なくサービスの変更、一時停止、または終了することがあります。これによって生じた損害についても、運営側は一切の責任を負いません。

5. 禁止事項（公序良俗の遵守）
会員は、当サービスの利用にあたり、以下の行為を行ってはならないものとします。
・公序良俗に反する行為、またはその恐れのある行為
・法令、条例、または本規約に違反する行為
・他の会員、運営側、または第三者の財産、プライバシー、名誉、信用を侵害する行為（誹謗中傷や迷惑行為など）
・営利目的、商業目的の宣伝、強引な勧誘、または宗教・政治活動への過度な勧誘行為
・運営側のボランティア活動を妨害する行為、または運営側に不当な負担をかける行為

6. 利用制限および登録抹消
会員が上記の禁止事項に違反した場合、または公序良俗に反する行為を行ったと運営側が判断した場合、運営側は事前の通知なしに、該当する投稿の削除、サービスの利用停止、または会員登録の抹消（強制退会）を行うことができるものとします。
```

ページ下部に「← トップページに戻る」リンクを設置する。デザインは他ページと統一感を持たせつつ、読みやすさを優先し、段落間の余白を広めに取る。

---

## 【管理者ダッシュボード追加機能】

admin.html に「イベント管理」タブを追加し、`adminGetAllEvents` / `adminForceEvent` / `adminForceUpdateEvent` を使って、管理者が任意のイベントを修正・削除できるようにする（v2では日記・会員管理のみだったため）。

---

## 【GAS 初期セットアップ手順（v3）】

1. Google スプレッドシートを新規作成し、以下の **9シート** を追加（ヘッダー行を入力）。`members` シートは **A〜P列の16列構成**に注意：
   - `members`（memberId, email, passwordHash, nickname, birthYear, profile, role, createdAt, isActive, notifyLikes, notifyComments, notifyReminder, notifyEvents, snsContact, mustChangePassword, termsAgreedAt）
   - `diaries`（v2と同一）
   - `diary_likes`（v2と同一）
   - `diary_comments`（v2と同一）
   - `events`（eventId, organizerId, organizerNickname, title, description, eventDate, location, maxParticipants, tags, status, createdAt, updatedAt, **deadline**）
   - `event_participants`（participantId, eventId, memberId, nickname, joinedAt, **snsContact**）
   - `event_messages`（v2と同一）
   - `sessions`（v2と同一）
   - `reminder_log`（v2と同一）

2. GAS エディタを開き、`Code.gs` に上記コードを貼り付け。`SPREADSHEET_ID` を書き換える。

3. スクリプトプロパティを設定:
   - `ADMIN_PASSWORD` = （任意の管理者パスワード）

4. **時間トリガー設定**（10年前リマインド用、v2と同一）:
   - 実行する関数: `sendTenYearReminders`
   - 時間主導型 → 日付ベースのタイマー → 午前8時〜9時

5. デプロイ:
   - 種類: ウェブアプリ／実行ユーザー: 自分／アクセス: 全員（匿名を含む）
   - URLをコピー

6. `js/config.js` の `GAS_URL` にURLを貼り付け。

7. GitHub にプッシュ → GitHub Pages を有効化（ブランチ: main / root）。

---

## 【セキュリティ・運用チェックリスト（v3）】

- [ ] スプレッドシートIDはGAS内のみ（フロントに書かない）
- [ ] 管理者パスワードはPropertiesServiceのみ
- [ ] パスワードはSHA-256ハッシュ保存（平文保存しない）
- [ ] 仮パスワードは登録・再発行のたびにランダム生成し、メール送信後はサーバー側に平文で残さない
- [ ] パスワード再発行APIは、メール存在有無に関わらず同一レスポンスを返す（列挙攻撃対策）
- [ ] セッショントークンは有効期限24時間
- [ ] いいね・コメント・日記・イベントの編集削除は本人または管理者のみ（GAS側でチェック）
- [ ] メール送信はMailApp（無料アカウントは1日100通上限に注意）
- [ ] GitHubにスプレッドシートID・パスワード・`Code.gs` をコミットしない（`.gitignore` 推奨）
- [ ] 免責事項同意チェックがない登録リクエストはGAS側でも拒否する（フロントのdisabledだけに頼らない）
- [ ] SNS連絡先は任意項目とし、未入力でも登録・イベント参加ができることを確認する

---

## 【デザイン指示（v2を継承）】

**テーマ**: 手書き日記・昭和レトロ・温かみ・世代を超えた交流

**カラーパレット**:
- メインカラー: `#5C4033`（深いチョコレートブラウン）
- アクセント: `#D4891A`（アンバー）
- 背景: `#FDF6E3`（クリーム）
- テキスト: `#2C1810`（濃いセピア）
- サブ背景: `#F0E6D3`

**フォント**: 見出し `Shippori Mincho` / 本文 `Noto Sans JP` / 英数字装飾 `Playfair Display`

**レスポンシブ**:
- スマホ（〜768px）: ボトムナビゲーション固定・1カラム・最小タップ44px
- PC（769px〜）: ヘッダーナビ・2〜3カラムグリッド
- CSSメディアクエリのみで自動切替（JS判定不要）

**v3 追加UIパーツ**:
- パスワード表示切替アイコン（👁️/🙈）
- 免責事項同意チェックボックス＋リンク
- 募集期限バッジ（⏰）・定員到達バッジ（👥）
- 参加者カードにSNS表示（📱）
- 強制パスワード変更画面（警告色の縁取りで注意喚起）

---

*この指示書 v3 に従って実装することで、会員番号＝メールアドレスによる仮パスワード認証、パスワード再発行・変更、SNS連絡先共有、募集期限付きイベント管理、免責事項同意フロー、操作説明ページを備えた、安全で世代を超えて楽しめる「10年日記」コミュニティサイトが完成します。*
