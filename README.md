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

---

## 写真登録機能（Googleドライブ連携・非公開設計）★追加

日記に写真を添付できます。**写真ファイルはGoogleドライブ上で常に非公開**とし、
閲覧のたびにGAS側で「この日記を見る権限があるか」を確認してから配信します
（Driveの共有リンクを直接使わないため、URLが漏れても写真は見られません）。

### 追加セットアップ

1. **diariesシートに列を追加**：K列に見出し `photos` を追記（既存9列の次）
   - 保存形式は `[{"fileId":"...","mimeType":"image/jpeg"}, ...]` のJSON文字列
2. **Googleドライブに保存用フォルダを作成**（例：「10年日記_写真」）
   - このフォルダは**共有しない**（非公開のまま）。フォルダIDをコピー
3. **スクリプトプロパティに追加**：
   | プロパティ名 | 値 |
   |---|---|
   | PHOTOS_ROOT_FOLDER_ID | （作成したフォルダのID） |
4. `PhotoUpload.gs` の中身を `Code.gs` の末尾に貼り付け、
   ファイル内コメントの「◆ 既存コードへの組み込み手順」に従って
   `postDiary` / `updateDiary` / `deleteDiary` / 日記読み取り処理 / `doPost`の
   アクション振り分けを修正する
5. GASエディタで保存→実行し、ドライブへのアクセス権限を再承認
6. 「新しいデプロイ」→「新しいバージョン」で再デプロイ

### セキュリティ設計のポイント

- Driveファイルへの共有設定（ANYONE_WITH_LINK等）は一切行わない
- 画像取得は毎回 `getPhoto` アクション（token付きPOST）を通し、サーバー側で
  「公開日記／本人／管理者」のいずれかを満たす場合のみ許可
- `fileId`が本当に指定`diaryId`のフォルダに属しているかも検証（なりすまし対策）
- アップロード時はサーバー側で**枚数上限・サイズ上限（8MB）・MIMEタイプ**を再検証
  （クライアント側のリサイズ・枚数制限はUX目的であり、信用しない設計）
- ファイル名はサーバー側でランダム生成（ユーザー入力のファイル名は使わない）
- 日記の更新・削除時は所有者チェックを必ず行い、除外された写真はゴミ箱に移動

### 動作仕様

- 写真はブラウザ側で最大辺1600px・JPEG品質0.8にリサイズしてから送信（通信量削減、ただしサーバー側でも再検証）
- 1件の日記につき最大5枚
- 画像はbase64でやり取りするため、枚数や解像度によっては表示に数百ms〜数秒かかる場合があります
