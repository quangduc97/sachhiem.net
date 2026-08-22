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
  } else if (table === 'email') {
    email.push({
      title: clean(rec.title) ?? clean(rec.emailid),
      author: clean(rec.author),
      date: clean(rec.date)?.slice(0, 10) ?? null,
      link: firstUrl(rec.directions) ?? firstUrl(rec.shortdesc),
      thumb: clean(rec.thumb),
    });
  } else if (table === 'recipes') {
    recipes.push({
      title: clean(rec.title),
      author: clean(rec.author),
      date: clean(rec.date)?.slice(0, 10) ?? null,
      category: clean(rec.category),
      link: firstUrl(rec.directions) ?? firstUrl(rec.shortdesc),
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
write('email.json', email.filter((e) => e.title));
write('recipes.json', recipes.filter((r) => r.title));
console.log('Xong import DB.');
