#!/usr/bin/env node
/**
 * Import dữ liệu phụ từ SQL dump của sachhiem.net (72244436.sql).
 *
 * Đầu ra (src/data/):
 *   news.json     — bảng news: link tin ngoài hiển thị trang chủ (date, title, link)
 *   email.json    — bảng email "hộp thư": bài gửi qua email (title, author, date, link, thumb)
 *   recipes.json  — bảng recipes: chỉ mục bài viết cũ (title, author, date, category, link, thumb)
 *
 * Dùng: node scripts/import-db.mjs [đường-dẫn-file.sql]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_FILE = process.argv[2] ?? path.resolve(SITE_ROOT, '../72244436.sql');
const DATA_DIR = path.join(SITE_ROOT, 'src/data');

// ---------------------------------------------------------------- parser

/** Tách một dòng giá trị tuple SQL thành mảng token theo cột (ngoài nháy đơn). */
function tokenizeTuple(tuple) {
  const tokens = [];
  let cur = '';
  let inStr = false;
  for (let i = 0; i < tuple.length; i++) {
    const c = tuple[i];
    if (inStr) {
      if (c === '\\' && (tuple[i + 1] === "'" || tuple[i + 1] === '\\' || tuple[i + 1] === '"')) {
        cur += tuple[i + 1]; i++; // \' \\ \" escape
      } else if (c === "'") {
        if (tuple[i + 1] === "'") { cur += "'"; i++; } // '' escape
        else inStr = false;
      } else cur += c;
    } else if (c === "'") inStr = true;
    else if (c === ',') { tokens.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  tokens.push(cur.trim());
  // bỏ dấu '(' bao quanh tuple ở token đầu tiên
  if (tokens.length && tokens[0].startsWith('(')) tokens[0] = tokens[0].slice(1);
  return tokens;
}

/** Quét toàn bộ dump, gọi cb(table, columns, rowTokens) cho mỗi dòng dữ liệu. */
function scanSql(sql, cb) {
  let i = 0;
  const headerRe = /^INSERT INTO `(\w+)` \(([^)]+)\) VALUES\s*$/;
  while (i < sql.length) {
    const nl = sql.indexOf('\n', i);
    const line = nl === -1 ? sql.slice(i) : sql.slice(i, nl);
    const m = headerRe.exec(line.trim());
    if (!m) { i = nl === -1 ? sql.length : nl + 1; continue; }
    const table = m[1];
    const columns = m[2].split(',').map((s) => s.trim().replace(/`/g, ''));
    let buf = '';
    let j = nl + 1;
    let depth = 0, inStr = false;
    while (j < sql.length) {
      const c = sql[j];
      if (inStr) {
        if (c === '\\' && (sql[j + 1] === "'" || sql[j + 1] === '\\' || sql[j + 1] === '"')) {
          buf += sql[j + 1]; j += 2; continue; // \' \\ \" escape
        }
        buf += c;
        if (c === "'") {
          if (sql[j + 1] === "'") { buf += sql[j + 1]; j += 2; continue; }
          inStr = false;
        }
        j++;
        continue;
      }
      if (c === "'") { inStr = true; buf += c; j++; continue; }
      if (c === '(') { depth++; buf += c; j++; continue; }
      if (c === ')') {
        depth--;
        buf += c;
        if (depth > 0) { j++; continue; }
        // đóng tuple ngoài cùng: xử lý row, rồi xem ký tự tiếp theo là ';' hay ','
        if (buf.trim()) cb(table, columns, tokenizeTuple(buf));
        buf = '';
        let k = j + 1;
        while (sql[k] === ' ' || sql[k] === '\n' || sql[k] === '\r') k++;
        if (sql[k] === ';') { i = k + 1; break; }
        if (sql[k] === ',') { j = k + 1; continue; }
        i = k; break;
      }
      if (c === ',' && depth === 0) {
        // dấu phẩy giữa các tuple: "),("
        if (buf.trim()) cb(table, columns, tokenizeTuple(buf));
        buf = '';
        j++;
        continue;
      }
      buf += c;
      j++;
    }
    if (j >= sql.length) break;
  }
}

// ---------------------------------------------------------------- extract

const firstUrl = (s) => {
  if (!s) return null;
  const m = String(s).match(/https?:\/\/[^\s"'<>)\]]+/i);
  return m ? m[0].replace(/&amp;/g, '&') : null;
};

/** Đường dẫn bài viết tĩnh nội bộ (vd NMQ/TT_MY/TongThongMy02.php) trong nội dung. */
const articlePathOf = (s) => {
  if (!s) return null;
  const m = String(s).match(/([A-Za-z0-9_][A-Za-z0-9_\/-]*\.php)/);
  return m ? m[1] : null;
};

const clean = (s) => {
  if (s == null || s === 'NULL') return null;
  const t = String(s).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  return t ? repair(t) : null;
};

/** Sửa mojibake double-encoding (utf8 bytes bị đọc nhầm kiểu Windows-1252) của dump MySQL cũ. */
const CP1252_SPECIAL = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A,
  '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C,
  'ž': 0x9E, 'Ÿ': 0x9F,
};
const repair = (s) => {
  const bytes = [];
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code > 0xff) {
      const mapped = CP1252_SPECIAL[ch];
      if (mapped == null) return s; // ký tự không thuộc cp1252 → chuỗi sạch, bỏ qua
      bytes.push(mapped);
    } else bytes.push(code);
  }
  // Luôn dùng bản đã sửa — một số đoạn bị triple-encoding sẽ còn ký tự �
  // nhưng vẫn dễ đọc hơn mojibake nguyên vẹn.
  return Buffer.from(bytes).toString('utf8');
};

const sql = fs.readFileSync(SQL_FILE, 'utf8');
const news = [], email = [], recipes = [];

scanSql(sql, (table, cols, row) => {
  const rec = {};
  cols.forEach((c, idx) => { rec[c] = row[idx]; });
  if (table === 'news') {
    news.push({
      date: clean(rec.date)?.slice(0, 10) ?? null,
      title: clean(rec.title),
      link: clean(rec.link),
    });
  } else if (table === 'email' || table === 'email1') {
    email.push({
      id: clean(rec.emailid),
      table,
      title: clean(rec.title) ?? clean(rec.emailid),
      author: clean(rec.author),
      date: clean(rec.date)?.slice(0, 10) ?? null,
      link: firstUrl(rec.directions) ?? firstUrl(rec.shortdesc),
      articlePath: articlePathOf(rec.directions) ?? articlePathOf(rec.shortdesc),
      contentRaw: rec.directions || rec.shortdesc,
      thumb: clean(rec.thumb),
    });
  } else if (table === 'recipes' || table === 'recipes1') {
    recipes.push({
      id: clean(rec.recipeid),
      table,
      title: clean(rec.title),
      author: clean(rec.author),
      date: clean(rec.date)?.slice(0, 10) ?? null,
      category: clean(rec.category),
      link: firstUrl(rec.directions) ?? firstUrl(rec.shortdesc),
      articlePath: articlePathOf(rec.directions) ?? articlePathOf(rec.shortdesc),
      thumb: clean(rec.thumb),
    });
  }
});

const write = (name, data) => {
  const f = path.join(DATA_DIR, name);
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
  console.log(`  ${name}: ${data.length} dòng → ${f}`);
};
write('news.json', news.filter((n) => n.title));
write('recipes.json', recipes.filter((r) => r.title));

// Bảng ánh xạ link chức năng cũ index.php?content=showX&id=N → bài viết tĩnh
const dbMap = {};
// Email không có bài viết tương ứng → trỏ về trang Hộp thư mới (/hop-thu/<id>/)
const emailPageKey = (e) => (e.table === 'email1' ? `e${e.id}` : String(e.id));
for (const e of email) {
  if (e.id) dbMap[`${e.table === 'email1' ? 'showemailE' : 'showemail'}|${e.id}`] = e.articlePath ?? `hop-thu/${emailPageKey(e)}`;
}
for (const r of recipes) {
  if (r.id) dbMap[`${r.table === 'recipes1' ? 'showrecipeE' : 'showrecipe'}|${r.id}`] = r.articlePath ?? null;
}

// Xử lý nội dung thư: sửa mojibake (giữ thẻ HTML), chuyển \r\n → <br>,
// viết lại link nội bộ cũ về đường dẫn mới
const rewriteContentLink = (url) => {
  if (!url) return null;
  const fn = String(url).match(/index\.php\?content=(showemailE?|showrecipeE?)(?:&amp;|&)id=(\d+)/i);
  if (fn) {
    const target = dbMap[`${fn[1].toLowerCase()}|${fn[2]}`];
    return target ? `/${target.replace(/\.php$/i, '')}` : null;
  }
  const old = String(url).match(/^https?:\/\/(?:www\.)?sachhiem\.net\/(.*)$/i);
  if (old) return `/${old[1].replace(/\.php$/i, '')}`;
  return url;
};
const processEmailContent = (rawContent) => {
  if (!rawContent) return null;
  let html = repair(String(rawContent).replace(/\\r\\n/g, '<br>\n').replace(/\\"/g, '"'));
  html = html.replace(/href=("?)([^" >]+)\1/gi, (m, q, url) => {
    const mapped = rewriteContentLink(url);
    return mapped ? `href="${mapped}"` : `href="${url}"`;
  });
  // gom <br> thừa và loại thẻ rác
  html = html.replace(/(<br>\s*){3,}/g, '<br><br>');
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  return html;
};
for (const e of email) {
  e.contentHtml = processEmailContent(e.contentRaw) ?? null;
  e.lang = e.table === 'email1' ? 'en' : 'vi';
}
// lọc thư không có nội dung
const emailWithContent = email.filter((e) => e.contentHtml);
write('db-map.json', dbMap);
write('email.json', emailWithContent);

const resolved = Object.values(dbMap).filter(Boolean).length;
console.log(`db-map: ${Object.keys(dbMap).length} id (${resolved} trỏ được bài viết, ${Object.keys(dbMap).length - resolved} không có bài tương ứng)`);
