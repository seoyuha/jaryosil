/**
 * 수업자료실 공개 사이트용 구글 앱스 스크립트
 *
 * 1) 자료 보내기(doGet): 드라이브 '수업자료실 공개 데이터' 폴더의 가장 최근 자료(site-data-….json)에
 *    공개 사이트에서 막 올린 자료를 더해 공개 사이트에 보내 줘요.
 * 2) 자료 올리기(doPost): 공개 사이트에서 비밀번호를 넣고 파일을 올리면, 파일이 브라우저에서 드라이브로
 *    바로 올라가도록 '업로드 주소'를 만들어 줘요. 용량 제한이 사실상 없어요.
 */
const FOLDER_ID = '1Qr0ljDrgrUaqxS6B7WlzZ8M99xQBgDeC'; // 수업자료실 공개 데이터 폴더

// ▼ 공개 사이트에서 자료를 올릴 때 쓸 비밀번호를 따옴표 안에 적으세요 (선생님만 아는 것으로)
const UPLOAD_KEY = 'finel9932!';

const PENDING_NAME = 'pending-uploads.json';

function doGet() {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const files = folder.getFiles();
  let newest = null;
  while (files.hasNext()) {
    const f = files.next();
    if (f.isTrashed() || !/^site-data-\d+\.json$/.test(f.getName())) continue;
    if (!newest || f.getDateCreated() > newest.getDateCreated()) newest = f;
  }
  if (!newest) return json_({ error: '아직 공개된 자료가 없어요. 수업자료실에서 [드라이브와 맞추기 → 공개 사이트에 반영]을 눌러 주세요.' });
  const data = JSON.parse(newest.getBlob().getDataAsString('UTF-8'));
  // 마지막 공개 이후에 공개 사이트에서 올린 자료를 더해요
  const since = data.generatedAt || newest.getDateCreated().getTime();
  const pend = readPending_().filter(m => m.at > since);
  if (pend.length) {
    const byId = {};
    (data.materials || []).forEach((m, i) => { byId[m.id] = i; });
    pend.forEach(m => {
      const doc = Object.assign({}, m); delete doc.at;
      if (byId[doc.id] !== undefined) data.materials[byId[doc.id]] = doc; else data.materials.push(doc);
    });
  }
  data.uploadOn = !!UPLOAD_KEY;
  return json_(data);
}

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: '요청을 읽지 못했어요.' }); }
  if (!UPLOAD_KEY) return json_({ error: '앱스 스크립트에 비밀번호(UPLOAD_KEY)가 아직 없어요.' });
  if (p.key !== UPLOAD_KEY) return json_({ error: '비밀번호가 맞지 않아요.', badKey: true });

  if (p.action === 'check') return json_({ ok: true });

  if (p.action === 'init') {
    const folder = targetFolder_(p.parentId, p.sub);
    // 같은 이름 파일이 있으면 그 파일 내용을 새로 바꿔요 (주소는 그대로)
    const same = folder.getFilesByName(p.name);
    let existing = null;
    while (same.hasNext()) { const f = same.next(); if (!f.isTrashed()) { existing = f; break; } }
    const meta = { name: p.name, mimeType: p.mime || 'application/octet-stream' };
    if (p.modifiedTime) meta.modifiedTime = p.modifiedTime;
    let url, method;
    if (existing) {
      url = 'https://www.googleapis.com/upload/drive/v3/files/' + existing.getId() + '?uploadType=resumable&fields=id,name,size,modifiedTime,parents';
      method = 'patch';
      delete meta.mimeType;
    } else {
      url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,modifiedTime,parents';
      method = 'post';
      meta.parents = [folder.getId()];
    }
    const res = UrlFetchApp.fetch(url, {
      method: method,
      contentType: 'application/json; charset=UTF-8',
      payload: JSON.stringify(meta),
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        Origin: p.origin || 'https://seoyuha.github.io',
        'X-Upload-Content-Type': p.mime || 'application/octet-stream',
        'X-Upload-Content-Length': String(p.size || 0)
      },
      muteHttpExceptions: true
    });
    const loc = res.getHeaders()['Location'] || res.getHeaders()['location'];
    if (!loc) return json_({ error: '업로드를 시작하지 못했어요. (' + res.getResponseCode() + ')' });
    return json_({ uploadUrl: loc, folderId: folder.getId(), replaced: !!existing });
  }

  if (p.action === 'done') {
    const m = p.material;
    if (!m || !m.id) return json_({ error: '자료 정보가 없어요.' });
    m.at = Date.now();
    const list = readPending_().filter(x => x.id !== m.id && Date.now() - x.at < 1000 * 60 * 60 * 24 * 60);
    list.push(m);
    writePending_(list.slice(-500));
    return json_({ ok: true });
  }
  return json_({ error: '알 수 없는 요청이에요.' });
}

function targetFolder_(parentId, sub) {
  const parent = DriveApp.getFolderById(parentId);
  if (!sub) return parent;
  const it = parent.getFoldersByName(sub);
  while (it.hasNext()) { const f = it.next(); if (!f.isTrashed()) return f; }
  return parent.createFolder(sub);
}

function pendingFile_() {
  const it = DriveApp.getFolderById(FOLDER_ID).getFilesByName(PENDING_NAME);
  while (it.hasNext()) { const f = it.next(); if (!f.isTrashed()) return f; }
  return null;
}
function readPending_() {
  const f = pendingFile_();
  if (!f) return [];
  try { return JSON.parse(f.getBlob().getDataAsString('UTF-8')) || []; } catch (e) { return []; }
}
function writePending_(list) {
  const body = JSON.stringify(list);
  const f = pendingFile_();
  if (f) f.setContent(body); else DriveApp.getFolderById(FOLDER_ID).createFile(PENDING_NAME, body, 'application/json');
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** 편집기에서 이 함수를 한 번 실행하면 새 권한(드라이브·외부 요청)을 허용하는 창이 떠요. */
function 권한확인() {
  Logger.log(DriveApp.getFolderById(FOLDER_ID).getName());
  UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
}
