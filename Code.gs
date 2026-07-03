// ========================================================
// 10年日記 v3 - Google Apps Script バックエンド
// ========================================================
// ★ SPREADSHEET_ID を自分のスプレッドシートIDに書き換えてください
const SPREADSHEET_ID = '1wA4HG_eK5lYBSKW-C3a8hU341FmJ4k6Bh-FdlR1j-gg';
const SESSION_EXPIRE_HOURS = 24;

// ===== ルーター =====
function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'getDiaries')       return getDiaries(e);
    if (action === 'getDiaryDetail')   return getDiaryDetail(e);
    if (action === 'getEvents')        return getEvents(e);
    if (action === 'getEventDetail')   return getEventDetail(e);
    if (action === 'getMessages')      return getEventMessages(e);
    return jsonRes({error: 'Invalid action'});
  } catch (err) {
    // 例外が起きた場合も、CORSヘッダー付きの正常なJSONレスポンスとして
    // エラー内容を返す（例外を握りつぶしたHTMLエラーページになると、
    // ブラウザ側からはCORSエラーとしてしか見えなくなってしまうため）
    return jsonRes({success: false, error: 'サーバーエラー: ' + err.message, stack: String(err.stack || '')});
  }
}

function doPost(e) {
  try {
    let p;
    try { p = JSON.parse(e.postData.contents); }
    catch(err) { return jsonRes({error: 'Invalid JSON'}); }

    const action = p.action;

    // 認証不要
    if (action === 'register')             return register(p);
    if (action === 'login')                return login(p);
    if (action === 'requestPasswordReset') return requestPasswordReset(p);
    if (action === 'adminLogin')           return adminLogin(p);
    // 写真取得は「公開日記なら誰でも／非公開なら本人か管理者のみ」を
    // handleGetPhoto_ 内部で判定するため、ここではセッション必須にしない
    if (action === 'getPhoto')             return handleGetPhoto_(p);

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
    if (action === 'adminGetMembers')    return adminGetMembers();
    if (action === 'adminGetAllDiaries') return adminGetAllDiaries();
    if (action === 'adminGetAllEvents')  return adminGetAllEvents();
    if (action === 'adminDeleteDiary')   return adminForceDiary(p);
    if (action === 'adminDeleteEvent')   return adminForceEvent(p);
    if (action === 'adminUpdateEvent')   return adminForceUpdateEvent(p);
    if (action === 'adminDeleteComment') return adminForceComment(p);
    if (action === 'adminToggleMember')  return adminToggleMember(p);

    return jsonRes({error: 'Invalid action'});
  } catch (err) {
    // doGet同様、例外もCORSヘッダー付きの正常なJSONとして返す
    return jsonRes({success: false, error: 'サーバーエラー: ' + err.message, stack: String(err.stack || '')});
  }
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
  return d.slice(1); // ヘッダー除外
}
function uuid() { return Utilities.getUuid(); }
function now() { return new Date().toISOString(); }
function hashPw(pw) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pw, Utilities.Charset.UTF_8);
  return d.map(b => ('0'+(b&0xFF).toString(16)).slice(-2)).join('');
}
// 仮パスワード生成（8桁・紛らわしい文字を除いた英数字）
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

// memberId（＝メールアドレス）から通知用情報を取得
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

// ===== 会員登録・ログイン・パスワード関連 =====

// 会員登録：パスワードは入力させず、仮パスワードを自動発行してメール送信する
function register(p) {
  const { email, nickname, birthYear, agreedTerms } = p;
  if (!email || !nickname) return jsonRes({error: '必須項目が不足しています'});
  if (!agreedTerms) return jsonRes({error: '免責事項・注意事項への同意が必要です'});

  const rows = allRows('members');
  if (rows.find(r => r[0] === email)) return jsonRes({error: 'このメールアドレスは既に登録済みです'});

  const tempPassword = generateTempPassword();

  sh('members').appendRow([
    email,                  // A memberId = メールアドレス（会員番号）
    email,                  // B email
    hashPw(tempPassword),   // C passwordHash（仮パスワードのハッシュ）
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

// パスワード変更（本人確認あり）
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
      if (p.profile     !== undefined) sheet.getRange(i+1,6).setValue(p.profile);
      if (p.birthYear   !== undefined) sheet.getRange(i+1,5).setValue(p.birthYear);
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

// ===== 日記 CRUD =====
function getDiaries(e) {
  const genFilter = e.parameter.generation || '';
  const tagFilter = e.parameter.tag || '';
  const rows = allRows('diaries');
  const members = allRows('members');
  const likes = allRows('diary_likes');
  const comments = allRows('diary_comments');

  let diaries = rows
    .filter(r => r[7] === true)
    .map(r => {
      const m = members.find(mem => mem[0] === r[1]);
      const birthYear = m ? parseInt(m[4]) : 0;
      return {
        diaryId: r[0], memberId: r[1], nickname: r[2],
        title: r[3], content: r[4], mood: r[5],
        tags: r[6], createdAt: r[8], updatedAt: r[9],
        birthYear,
        photos: photosFromJson_(r[10]),
        likeCount:    likes.filter(l => l[1] === r[0]).length,
        commentCount: comments.filter(c => c[1] === r[0]).length
      };
    });

  if (genFilter) {
    const decade = parseInt(genFilter);
    diaries = diaries.filter(d => d.birthYear >= decade && d.birthYear < decade + 10);
  }
  if (tagFilter) {
    diaries = diaries.filter(d => d.tags && d.tags.split(',').map(t=>t.trim()).includes(tagFilter));
  }

  diaries.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  return jsonRes({success: true, diaries});
}

function getDiaryDetail(e) {
  const { diaryId, token } = e.parameter;
  const rows = allRows('diaries');
  const r = rows.find(x => x[0] === diaryId);
  if (!r) return jsonRes({error: '日記が見つかりません'});

  // ★セキュリティ修正：以前は isPublic を確認せず誰でも詳細を取得できた。
  //   非公開日記は「本人」または「管理者」のみ閲覧可とする。
  const requester = token ? validateSession(token) : null;
  const isOwner  = requester && requester.memberId === r[1];
  const isAdmin  = requester && requester.role === 'admin';
  const isPublic = r[7] === true;
  if (!isPublic && !isOwner && !isAdmin) {
    return jsonRes({error: 'この日記は非公開です'});
  }

  const likes = allRows('diary_likes').filter(l => l[1] === diaryId)
    .map(l => ({likeId: l[0], memberId: l[2], nickname: l[3], createdAt: l[4]}));
  const comments = allRows('diary_comments').filter(c => c[1] === diaryId)
    .map(c => ({commentId: c[0], memberId: c[2], nickname: c[3], content: c[4], createdAt: c[5]}));
  return jsonRes({success: true,
    diary: {diaryId: r[0], memberId: r[1], nickname: r[2], title: r[3], content: r[4],
            mood: r[5], tags: r[6], isPublic: r[7], createdAt: r[8], updatedAt: r[9],
            photos: photosFromJson_(r[10])},
    likes, comments});
}

function getMyDiaries(p, sess) {
  const rows = allRows('diaries');
  const likes = allRows('diary_likes');
  const comments = allRows('diary_comments');
  const mine = rows
    .filter(r => r[1] === sess.memberId)
    .map(r => ({
      diaryId: r[0], title: r[3], content: r[4], mood: r[5],
      tags: r[6], isPublic: r[7], createdAt: r[8], updatedAt: r[9],
      photos: photosFromJson_(r[10]),
      likeCount:    likes.filter(l => l[1] === r[0]).length,
      commentCount: comments.filter(c => c[1] === r[0]).length
    }));
  mine.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  return jsonRes({success: true, diaries: mine});
}

function postDiary(p, sess) {
  const { title, content, mood, tags, isPublic } = p;
  if (!title || !content) return jsonRes({error: 'タイトルと本文は必須です'});
  const diaryId = uuid();
  const n = now();
  let photoList = [];
  try {
    photoList = buildPhotoList_(p, diaryId, []);
  } catch (err) {
    return jsonRes({error: err.message});
  }
  sh('diaries').appendRow([diaryId, sess.memberId, sess.nickname, title, content,
    mood||'😊', tags||'', isPublic!==false, n, n, photosToJson_(photoList)]);
  return jsonRes({success: true, diaryId});
}

function updateDiary(p, sess) {
  const sheet = sh('diaries');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.diaryId) {
      if (data[i][1] !== sess.memberId && sess.role !== 'admin')
        return jsonRes({error: '編集権限がありません'});
      if (p.title    !== undefined) sheet.getRange(i+1,4).setValue(p.title);
      if (p.content  !== undefined) sheet.getRange(i+1,5).setValue(p.content);
      if (p.mood     !== undefined) sheet.getRange(i+1,6).setValue(p.mood);
      if (p.tags     !== undefined) sheet.getRange(i+1,7).setValue(p.tags);
      if (p.isPublic !== undefined) sheet.getRange(i+1,8).setValue(p.isPublic);

      // 写真：既存のうち残す分（existingPhotos＝fileIdの配列）＋ 新規アップロード分
      const oldPhotoList = photosFromJson_(data[i][10]);
      const keepIds = p.existingPhotos || [];
      const keptList = oldPhotoList.filter(ph => keepIds.indexOf(ph.fileId) !== -1);
      let photoList;
      try {
        photoList = buildPhotoList_(p, p.diaryId, keptList);
      } catch (err) {
        return jsonRes({error: err.message});
      }
      trashRemovedPhotos_(oldPhotoList, photoList); // 除外された写真をゴミ箱へ
      sheet.getRange(i+1, 11).setValue(photosToJson_(photoList));

      sheet.getRange(i+1,10).setValue(now());
      return jsonRes({success: true});
    }
  }
  return jsonRes({error: '日記が見つかりません'});
}

function deleteDiary(p, sess) {
  const sheet = sh('diaries');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.diaryId) {
      if (data[i][1] !== sess.memberId && sess.role !== 'admin')
        return jsonRes({error: '削除権限がありません'});
      const oldPhotoList = photosFromJson_(data[i][10]);
      trashRemovedPhotos_(oldPhotoList, []); // 写真も一緒にゴミ箱へ
      sheet.deleteRow(i+1);
      return jsonRes({success: true});
    }
  }
  return jsonRes({error: '日記が見つかりません'});
}

// ===== いいね =====
function toggleLike(p, sess) {
  const { diaryId } = p;
  const sheet = sh('diary_likes');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === diaryId && data[i][2] === sess.memberId) {
      sheet.deleteRow(i+1);
      return jsonRes({success: true, action: 'unliked'});
    }
  }

  sheet.appendRow([uuid(), diaryId, sess.memberId, sess.nickname, now()]);

  const diaryRows = allRows('diaries');
  const diary = diaryRows.find(r => r[0] === diaryId);
  if (diary && diary[1] !== sess.memberId) {
    const owner = getMemberEmail(diary[1]);
    if (owner && owner.notifyLikes) {
      try {
        MailApp.sendEmail({
          to: owner.email,
          subject: '【10年日記】あなたの日記に「いいね」が届きました',
          body: owner.nickname + ' さんへ\n\n' +
            sess.nickname + ' さんが「' + diary[3] + '」にいいねしました。\n\n' +
            'https://kenken6291.github.io/10y-nikki/diary.html?id=' + diaryId
        });
      } catch(e) {}
    }
  }
  return jsonRes({success: true, action: 'liked'});
}

// ===== コメント =====
function postComment(p, sess) {
  const { diaryId, content } = p;
  if (!content) return jsonRes({error: 'コメントを入力してください'});

  const commentId = uuid();
  sh('diary_comments').appendRow([commentId, diaryId, sess.memberId, sess.nickname, content, now()]);

  const diaryRows = allRows('diaries');
  const diary = diaryRows.find(r => r[0] === diaryId);
  if (diary && diary[1] !== sess.memberId) {
    const owner = getMemberEmail(diary[1]);
    if (owner && owner.notifyComments) {
      try {
        MailApp.sendEmail({
          to: owner.email,
          subject: '【10年日記】あなたの日記にコメントが届きました',
          body: owner.nickname + ' さんへ\n\n' +
            sess.nickname + ' さんが「' + diary[3] + '」にコメントしました:\n\n' +
            '「' + content + '」\n\n' +
            'https://kenken6291.github.io/10y-nikki/diary.html?id=' + diaryId
        });
      } catch(e) {}
    }
  }
  return jsonRes({success: true, commentId});
}

function deleteComment(p, sess) {
  const sheet = sh('diary_comments');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.commentId) {
      if (data[i][2] !== sess.memberId && sess.role !== 'admin')
        return jsonRes({error: '削除権限がありません'});
      sheet.deleteRow(i+1);
      return jsonRes({success: true});
    }
  }
  return jsonRes({error: 'コメントが見つかりません'});
}

function getComments(p, sess) {
  const rows = allRows('diary_comments').filter(r => r[1] === p.diaryId)
    .map(r => ({commentId: r[0], memberId: r[2], nickname: r[3], content: r[4], createdAt: r[5]}));
  return jsonRes({success: true, comments: rows});
}

// ===== 年表 =====
function getTimeline(p, sess) {
  const rows = allRows('diaries')
    .filter(r => r[1] === sess.memberId)
    .map(r => ({
      diaryId: r[0], title: r[3], content: r[4], mood: r[5],
      tags: r[6], isPublic: r[7], createdAt: r[8],
      photos: photosFromJson_(r[10])
    }));

  const timeline = {};
  rows.forEach(d => {
    const year = new Date(d.createdAt).getFullYear();
    if (!timeline[year]) timeline[year] = [];
    timeline[year].push(d);
  });
  Object.keys(timeline).forEach(year => {
    timeline[year].sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
  });
  const years = Object.keys(timeline).map(Number).sort((a,b) => b-a);
  return jsonRes({success: true, timeline, years});
}

// ===== 10年前リマインド（毎日トリガー） =====
function sendTenYearReminders() {
  const today = new Date();
  const todayMD = (String(today.getMonth()+1).padStart(2,'0')) + '-' + (String(today.getDate()).padStart(2,'0'));
  const tenYearsAgo = today.getFullYear() - 10;

  const diaryRows = allRows('diaries');
  const memberRows = allRows('members');
  const logRows = allRows('reminder_log');

  const targets = diaryRows.filter(r => {
    const d = new Date(r[8]);
    const dMD = (String(d.getMonth()+1).padStart(2,'0')) + '-' + (String(d.getDate()).padStart(2,'0'));
    return d.getFullYear() === tenYearsAgo && dMD === todayMD;
  });

  targets.forEach(diary => {
    const memberId = diary[1];
    const diaryId  = diary[0];

    const alreadySent = logRows.some(l => {
      const sentDate = new Date(l[3]);
      return l[1] === memberId && l[2] === diaryId &&
        sentDate.toDateString() === today.toDateString();
    });
    if (alreadySent) return;

    const m = memberRows.find(mem => mem[0] === memberId && mem[8] === true);
    if (!m || m[11] !== true) return;

    try {
      MailApp.sendEmail({
        to: m[1],
        subject: '【10年日記】10年前の今日、あなたはこんなことを書いていました',
        body: m[3] + ' さんへ\n\n' +
          'ちょうど10年前の今日（' + tenYearsAgo + '年' + (today.getMonth()+1) + '月' + today.getDate() + '日）、\n' +
          'あなたはこんな日記を書いていました:\n\n' +
          '━━━━━━━━━━━━━━━━\n' +
          '【' + diary[3] + '】\n\n' +
          diary[4].substring(0, 200) + (diary[4].length > 200 ? '...' : '') + '\n' +
          '━━━━━━━━━━━━━━━━\n\n' +
          '続きを読む: https://kenken6291.github.io/10y-nikki/diary.html?id=' + diaryId + '\n\n' +
          '今日の出来事も記録してみませんか？\n' +
          'https://kenken6291.github.io/10y-nikki/diary.html'
      });
      sh('reminder_log').appendRow([uuid(), memberId, diaryId, now()]);
    } catch(e) {}
  });
}
// ★ GASのトリガー設定: sendTenYearReminders を「時間主導型 → 毎日 → 午前8時〜9時」で設定すること

// ===== イベント（v3：募集期限・自動締切・SNS表示） =====
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

  // 定員到達なら自動的にステータスをcloseに更新
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

// ===== 管理者専用 =====
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

function adminForceDiary(p)       { return deleteDiary(p, {memberId: null, role: 'admin'}); }
function adminForceEvent(p)       { return deleteEvent(p, {memberId: null, role: 'admin'}); }
function adminForceComment(p)     { return deleteComment(p, {memberId: null, role: 'admin'}); }
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


/**
 * ===== 写真アップロード機能（Googleドライブ保存・非公開設計） =====
 *
 * 【セキュリティ設計】
 * - Driveファイルは常に非公開（共有設定は一切行わない）。
 *   GASはファイル所有者として実行されるため、共有設定に関わらず
 *   スクリプト自身は各ファイルにアクセスできる。
 * - フロントエンドは直接Drive URLを使わず、毎回 'getPhoto' アクション経由で
 *   「このユーザーはこの写真を見る権限があるか」をチェックしてから
 *   画像データ（base64）を返す（プロキシ方式）。
 * - 権限チェックは (a) 日記が公開設定 (b) 本人 (c) 管理者 のいずれか。
 * - fileIdとdiaryIdの整合性（fileIdが本当にそのdiaryIdのフォルダに
 *   属しているか）も検証し、「自分の公開日記のdiaryId」＋「他人の
 *   非公開日記のfileId」を組み合わせて不正取得する攻撃を防ぐ。
 * - アップロード時はサーバー側で 枚数／サイズ／MIMEタイプ を再検証
 *   （クライアント側の制限はUX目的であり、信用しない）。
 *
 * 【事前準備（未実施ならスクリプトエディタで行ってください）】
 * 1. Googleドライブに写真保存用フォルダを1つ作成（例：「10年日記_写真」／共有しない）
 * 2. フォルダを開いてURLの /folders/ の後ろのIDをコピー
 * 3. スクリプトプロパティに追加： PHOTOS_ROOT_FOLDER_ID = コピーしたフォルダID
 * 4. diariesシートのK列に見出し「photos」を追記
 * 5. 保存して一度手動実行し、ドライブへのアクセス権限を再承認
 * 6. 「新しいデプロイ」→「新しいバージョン」で再デプロイ
 */

const PHOTO_MAX_COUNT = 5;
const PHOTO_MAX_BYTES = 8 * 1024 * 1024; // 1枚あたり8MBまで（デコード後）
const PHOTO_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// 日記ID単位のサブフォルダを取得（なければ作成）
function getOrCreatePhotoFolder_(diaryId) {
  const rootId = PropertiesService.getScriptProperties().getProperty('PHOTOS_ROOT_FOLDER_ID');
  if (!rootId) throw new Error('スクリプトプロパティ PHOTOS_ROOT_FOLDER_ID が未設定です');
  const root = DriveApp.getFolderById(rootId);
  const existing = root.getFoldersByName(diaryId);
  if (existing.hasNext()) return existing.next();
  return root.createFolder(diaryId);
}

/**
 * base64写真の配列をバリデーションしてドライブにアップロード（非公開のまま）
 * @param {Array} photos [{name, mimeType, data(base64本体)}]
 * @param {string} diaryId
 * @param {number} existingCount 既にこの日記に登録済みの写真枚数（合計上限チェック用）
 * @return {Array<{fileId:string, mimeType:string}>}
 */
function uploadPhotosToDrive_(photos, diaryId, existingCount) {
  if (!photos || !photos.length) return [];
  if (existingCount + photos.length > PHOTO_MAX_COUNT) {
    throw new Error('写真は合計' + PHOTO_MAX_COUNT + '枚までです');
  }
  const folder = getOrCreatePhotoFolder_(diaryId);
  const results = [];
  photos.forEach(function(p) {
    if (!p || !p.data) return;
    const mimeType = p.mimeType || 'image/jpeg';
    if (PHOTO_ALLOWED_MIME.indexOf(mimeType) === -1) {
      throw new Error('許可されていない画像形式です: ' + mimeType);
    }
    const bytes = Utilities.base64Decode(p.data);
    if (bytes.length > PHOTO_MAX_BYTES) {
      throw new Error('画像サイズが大きすぎます（8MBまで）');
    }
    // ファイル名はユーザー入力を使わずランダム生成（情報漏洩・パス混乱防止）
    const safeName = Utilities.getUuid() + '.' + (mimeType.split('/')[1] || 'jpg');
    const blob = Utilities.newBlob(bytes, mimeType, safeName);
    const file = folder.createFile(blob);
    // ★重要：共有設定は一切行わない（非公開のまま）
    results.push({ fileId: file.getId(), mimeType: mimeType });
  });
  return results;
}

/**
 * 日記の写真一覧（保持する既存 + 新規アップロード分）を作成する
 * postDiary / updateDiary から呼び出す
 * @return {Array<{fileId,mimeType}>}
 */
function buildPhotoList_(p, diaryId, keepList) {
  const kept = keepList || [];
  const newOnes = uploadPhotosToDrive_(p.photos, diaryId, kept.length);
  return kept.concat(newOnes);
}

/**
 * 削除された写真（更新／削除で「保持」に含まれなくなったもの）をゴミ箱に移動
 * @param {Array<{fileId}>} oldList 更新前の写真一覧
 * @param {Array<{fileId}>} keptList 更新後も残す写真一覧（全削除なら空配列）
 */
function trashRemovedPhotos_(oldList, keptList) {
  const keepIds = {};
  (keptList || []).forEach(function(p) { keepIds[p.fileId] = true; });
  (oldList || []).forEach(function(p) {
    if (!keepIds[p.fileId]) {
      try { DriveApp.getFileById(p.fileId).setTrashed(true); } catch (err) { /* 既に削除済みなど */ }
    }
  });
}

// 写真データを配列⇔文字列で相互変換（シート保存用。K列に保存）
function photosToJson_(photoList) {
  return JSON.stringify(photoList || []);
}
function photosFromJson_(str) {
  if (!str) return [];
  try {
    const arr = JSON.parse(str);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

/**
 * 'getPhoto' アクション本体：権限チェック後、画像データ（base64）を返す。
 * 公開日記の写真は未ログインでも閲覧可、非公開日記は本人／管理者のみ。
 */
function handleGetPhoto_(p) {
  const diaryId = p.diaryId;
  const fileId  = p.fileId;
  if (!diaryId || !fileId) return jsonRes({success: false, error: 'パラメータ不足'});

  const diaryRow = allRows('diaries').find(r => r[0] === diaryId);
  if (!diaryRow) return jsonRes({success: false, error: '日記が見つかりません'});

  const requester = p.token ? validateSession(p.token) : null;
  const isOwner   = requester && requester.memberId === diaryRow[1];
  const isAdmin   = requester && requester.role === 'admin';
  const isPublic  = diaryRow[7] === true;

  if (!isPublic && !isOwner && !isAdmin) {
    return jsonRes({success: false, error: 'アクセス権がありません'});
  }

  // fileId が本当にこのdiaryIdのフォルダに属しているか検証
  // （他人の非公開diaryIdのfileIdを、自分の公開日記のdiaryIdと
  //   組み合わせて渡す不正アクセスを防ぐ）
  try {
    const file = DriveApp.getFileById(fileId);
    const parents = file.getParents();
    let belongsToDiary = false;
    while (parents.hasNext()) {
      if (parents.next().getName() === diaryId) { belongsToDiary = true; break; }
    }
    if (!belongsToDiary) return jsonRes({success: false, error: 'アクセス権がありません'});
    return jsonRes({
      success: true,
      mimeType: file.getBlob().getContentType(),
      data: Utilities.base64Encode(file.getBlob().getBytes())
    });
  } catch (err) {
    return jsonRes({success: false, error: '画像の取得に失敗しました'});
  }
}
