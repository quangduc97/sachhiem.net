#!/usr/bin/env node
/**
 * Sinh public/admin/config.yml cho Sveltia/Decap CMS: một collection cho
 * mỗi thư mục tác giả (danh sách bài dễ quản lý hơn một collection 6k bài).
 * Chạy khi danh sách tác giả thay đổi (sau convert hoặc thủ công).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { CATEGORY_MAP } from './shared.mjs';

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUTHORS_META_FILE = path.join(SITE_ROOT, 'src/data/authors-meta.json');
const OUT_FILE = path.join(SITE_ROOT, 'public/admin/config.yml');

const REPO = 'quangduc97/sachhiem.net';

const authors = JSON.parse(fs.readFileSync(AUTHORS_META_FILE, 'utf8'));
const categories = [...new Set(Object.values(CATEGORY_MAP))].sort((a, b) => a.localeCompare(b, 'vi'));

const commonFields = [
  { name: 'layout', label: 'Layout', widget: 'hidden', default: '../../layouts/Article.astro' },
  { name: 'title', label: 'Tiêu đề', widget: 'string' },
  { name: 'author', label: 'Tác giả (tên ký trong bài)', widget: 'string', required: false },
  {
    name: 'date', label: 'Ngày đăng', widget: 'datetime',
    date_format: 'YYYY-MM-DD', time_format: false, required: false,
  },
  {
    name: 'category', label: 'Chuyên mục', widget: 'select', required: false,
    options: categories,
  },
  { name: 'source', label: 'Nguồn (link bài gốc)', widget: 'string', required: false },
  {
    name: 'lang', label: 'Ngôn ngữ', widget: 'select', default: 'vi',
    options: [
      { label: 'Tiếng Việt', value: 'vi' },
      { label: 'Tiếng Anh', value: 'en' },
    ],
  },
  {
    name: 'image', label: 'Ảnh thumbnail (URL)', widget: 'string', required: false,
    hint: 'URL đầy đủ (vd https://pub-xxx.r2.dev/images/...) hoặc dùng nút ảnh để upload lên /uploads',
  },
  { name: 'body', label: 'Nội dung bài viết', widget: 'markdown' },
];

const collections = Object.entries(authors).map(([slug, info]) => ({
  name: slug.toLowerCase(),
  label: `${info.name} (${slug})`,
  label_singular: `bài của ${info.name}`,
  folder: `src/pages/${slug}`,
  create: true,
  nested: { depth: 100 },
  editor: { preview: false },
  summary: '{{title}} — {{date}}',
  fields: commonFields,
}));

const config = {
  backend: { name: 'github', repo: REPO, branch: 'main' },
  site_url: 'https://sachhiem.net',
  display_url: 'https://sachhiem.net',
  locale: 'vi',
  media_folder: 'public/uploads',
  public_folder: '/uploads',
  collections,
};

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, YAML.stringify(config));
console.log(`admin config: ${collections.length} collections → ${OUT_FILE}`);
