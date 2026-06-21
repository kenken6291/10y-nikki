# 10年日記 v3 - セットアップ手順書

v2からの主な変更点：会員番号＝メールアドレス化、仮パスワード認証、SNS連絡先、募集期限付きイベント、免責事項同意フロー、操作説明ページ追加。

## ファイル構成

```
10y-nikki-v3/
├── index.html      # トップページ（日記フィード・ログイン・登録・パスワード再発行）
├── diary.html      # 日記投稿・マイ日記・年表
├── events.html     # イベント掲示板（募集期限・編集モーダル対応）
├── profile.html    # マイページ（SNS・パスワード変更・強制変更画面・通知設定）
├── admin.html      # 管理者ダッシュボード（会員・日記・イベント管理）
├── guide.html      # ★新規：使い方ガイド
├── terms.html      # ★新規：免責事項・注意事項全文
├── Code.gs         # GASバックエンド（GASエディタに貼り付け）
├── css/
│   └── style.css   # 共通スタイル
└── js/
    ├── config.js   # GAS URLのみ記載
    ├── auth.js     # 認証・セッション・パスワード表示切替
    ├── diary.js    # 日記CRUD・いいね・コメント・年表
    ├── events.js   # イベントCRUD・参加/不参加・募集締切判定
    └── admin.js    # 管理者機能（会員・日記・イベント管理）
```

---

## STEP 1: Googleスプレッドシートを作成

新規スプレッドシートを作成し、以下9シートを追加します（v3で列構成が一部変更されています）。

### members（A〜P：16列）
memberId, email, passwordHash, nickname, birthYear, profile, role, createdAt,
isActive, notifyLikes, notifyComments, notifyReminder, notifyEvents,
**snsContact, mustChangePassword, termsAgreedAt**（太字がv3で追加）

### diaries（v2と同一）
diaryId, memberId, nickname, title, content, mood, tags, isPublic, createdAt, updatedAt

### diary_likes（v2と同一）
likeId, diaryId, memberId, nickname, createdAt

### diary_comments（v2と同一）
commentId, diaryId, memberId, nickname, content, createdAt

### events（A〜M：13列）
eventId, organizerId, organizerNickname, title, description, eventDate, location,
maxParticipants, tags, status, createdAt, updatedAt, **deadline**（v3で追加）

### event_participants（A〜F：6列）
participantId, eventId, memberId, nickname, joinedAt, **snsContact**（v3で追加）

### event_messages（v2と同一）
messageId, eventId, memberId, nickname, content, createdAt

### sessions（v2と同一）
token, memberId, expireAt, role, nickname

### reminder_log（v2と同一）
logId, memberId, diaryId, sentAt

> スプレッドシートURLの `/d/` と `/edit` の間がスプレッドシートIDです。

---

## STEP 2: GASプロジェクトをセットアップ

1. スプレッドシートのメニュー →「拡張機能」→「Apps Script」
2. `Code.gs` の内容を全て貼り付け
3. 1行目の `SPREADSHEET_ID` を実際のIDに書き換え

```javascript
const SPREADSHEET_ID = 'ここにスプレッドシートIDを貼り付け';
```

---

## STEP 3: スクリプトプロパティを設定

「プロジェクトの設定」→「スクリプト プロパティ」に追加：

| プロパティ名 | 値 |
|---|---|
| ADMIN_PASSWORD | （任意の管理者パスワード） |

---

## STEP 4: 10年前リマインドのトリガーを設定

「トリガー」→「トリガーを追加」
- 実行する関数: `sendTenYearReminders`
- イベントのソース: 時間主導型
- 時間ベースのトリガータイプ: 日付ベースのタイマー
- 時刻: 午前8時〜9時

---

## STEP 5: GASをデプロイ

1. 「デプロイ」→「新しいデプロイ」
2. 種類: ウェブアプリ
3. 実行ユーザー: 自分（GASオーナー）
4. アクセス: **全員（匿名を含む）**
5. デプロイ → URLをコピー

---

## STEP 6: フロントエンドにURLを設定

`js/config.js` を開き、コピーしたURLを貼り付け：

```javascript
const GAS_URL = 'https://script.google.com/macros/s/（ここにURLを貼り付け）/exec';
```

---

## STEP 7: GitHub Pagesにデプロイ

```bash
git init
git add .
git commit -m "v3リリース：仮パスワード認証・SNS連携・募集期限対応"
git remote add origin https://github.com/kenken6291/10y-nikki.git
git push -u origin main
```

リポジトリ設定 → Pages → ブランチ: main / root → Save

サイトURL: `https://kenken6291.github.io/10y-nikki/`

---

## v3 動作確認チェックリスト

- [ ] 会員登録：パスワード入力欄がなく、免責事項同意チェックなしでは登録ボタンが押せないこと
- [ ] 登録後、メールに会員番号（メールアドレス）と仮パスワードが届くこと
- [ ] 仮パスワードでログイン後、自動的にマイページのパスワード変更画面に遷移すること
- [ ] パスワード変更が完了するまで、他ページへの遷移を試みても変更画面に戻されること
- [ ] 「パスワードをお忘れの方」から仮パスワードが再発行されること（存在しないメールでも同じ成功メッセージが出ること）
- [ ] マイページのパスワード入力欄で👁️アイコンをクリックして表示/非表示が切り替わること
- [ ] プロフィールにSNS連絡先を登録し、イベント参加後に参加者一覧へ反映されること
- [ ] イベント作成時に募集期限を設定し、期限超過後は参加ボタンが表示されず「募集終了」になること
- [ ] 定員に達したイベントが自動的に「募集終了」表示になること
- [ ] 不参加にすると定員割れで再度「受付中」に戻ること（期限内の場合）
- [ ] 管理者ダッシュボードの「イベント管理」タブで全イベントの削除・キャンセル扱いができること
- [ ] `guide.html`・`terms.html` が各ページのナビゲーションからリンクされていること
- [ ] スマホ幅とPC幅でレイアウトが自動的に切り替わること（リサイズで確認）

---

## ⚠️ セキュリティ注意事項

- `Code.gs` は **GitHubにコミットしない**（スプレッドシートIDが含まれるため）
- `js/config.js` に書くのはGAS URLのみ
- 管理者パスワードはPropertiesServiceにのみ保存
- 仮パスワードは平文でサーバーに残さず、ハッシュ化のうえメール送信のみに利用
- パスワード再発行APIはメールの存在有無に関わらず同一レスポンスを返す設計（列挙攻撃対策）

`.gitignore` 推奨：
```
Code.gs
*.local.js
```

---

## GASコード更新後の注意

コード修正後は必ず **「新しいバージョン」** でデプロイし直すこと。
同じデプロイIDに上書きされるため、`config.js` のURL変更は不要。
