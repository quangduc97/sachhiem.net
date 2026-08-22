#!/usr/bin/env node
/**
 * Sinh src/data/articles.json từ mọi file .md trong src/pages/ — chạy trước
 * khi build/dev để bài viết mới (kể cả bài tạo từ CMS) tự có mặt trong
 * trang chủ, trang tác giả và chuyên mục.
 *
 * articles.json = { authors: {SLUG: {name, bio}}, categories: {slug: name}, articles: [...] }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, CATEGORY_MAP } from './shared.mjs';

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES_DIR = path.join(SITE_ROOT, 'src/pages');
const AUTHORS_META_FILE = path.join(SITE_ROOT, 'src/data/authors-meta.json');
const OUT_FILE = path.join(SITE_ROOT, 'src/data/articles.json');

// ---------------------------------------------------------------- helpers

const stripTags = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Đọc frontmatter (khối YAML đơn giản key: value) + body của file .md. */
function parseMd(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const fm = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([A-Za-z_][\w]*):\s*(.*)$/);
      if (!kv) continue;
      let v = kv[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).replace(/\\"/g, '"');
      }
      fm[kv[1]] = v;
    }
  }
  const body = m ? raw.slice(m[0].length) : raw;
  return { fm, body };
}

/** Tóm tắt: ưu tiên .tomluoc, nếu không thì đoạn dài đầu tiên, nếu không thì đầu bài. */
function makeExcerpt(body) {
  const tom = body.match(/<div[^>]*class="[^"]*tomluoc[^"]*"[\s\S]*?<\/div>/i);
  const src = tom ? tom[0] : body;
  let best = '';
  const paras = src.split(/<p[^>]*>/i).slice(1);
  for (const p of paras) {
    const t = stripTags(p.split('</p>')[0]).replace(/&[a-z]+;/gi, ' ');
    if (t.length > 80) { best = t; break; }
  }
  if (!best) best = stripTags(src).replace(/&[a-z]+;/gi, ' ');
  return best.length > 220 ? `${best.slice(0, 220).trim()}…` : best;
}

// ---------------------------------------------------------------- chính

const pagesDir = PAGES_DIR;
const articles = [];
const authorsMeta = fs.existsSync(AUTHORS_META_FILE)
  ? JSON.parse(fs.readFileSync(AUTHORS_META_FILE, 'utf8'))
  : {};

/** Quét mọi file .md đệ quy. */
function walkMd(dir, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, `${rel}${e.name}/`);
    else if (e.name.endsWith('.md')) processMd(p, rel + e.name);
  }
}

function processMd(file, rel) {
  const raw = fs.readFileSync(file, 'utf8');
  const { fm, body } = parseMd(raw);
  if (!fm.title) return;
  const slugPath = rel.replace(/\.md$/, '');
  const authorSlug = slugPath.split('/')[0];
  articles.push({
    path: `/${slugPath}`,
    title: fm.title,
    author: fm.author ?? null,
    authorSlug,
    date: fm.date ?? null,
    category: fm.category ?? null,
    lang: fm.lang ?? 'vi',
    excerpt: fm.excerpt ?? makeExcerpt(body),
    source: fm.source ?? null,
    image: fm.image ?? null,
    wordCount: Number(fm.wordCount) || stripTags(body).split(/\s+/).filter(Boolean).length,
  });
}

walkMd(pagesDir);

// Gộp tác giả: metadata có sẵn + tác giả mới (thư mục mới từ CMS)
const authors = { ...authorsMeta };
for (const a of articles) {
  if (authors[a.authorSlug]) continue;
  const names = new Map();
  for (const x of articles) {
    if (x.authorSlug === a.authorSlug && x.author) names.set(x.author, (names.get(x.author) ?? 0) + 1);
  }
  const top = [...names.entries()].sort((x, y) => y[1] - x[1])[0];
  authors[a.authorSlug] = { name: top ? top[0] : a.authorSlug, bio: '' };
}

const data = { authors, categories: CATEGORIES(), articles };
fs.writeFileSync(OUT_FILE, JSON.stringify(data, null, 2));
console.log(`articles.json: ${articles.length} bài, ${Object.keys(authors).length} tác giả, ${Object.keys(data.categories).length} chuyên mục`);
