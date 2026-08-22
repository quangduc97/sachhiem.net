#!/usr/bin/env node
/**
 * Upload toàn bộ media của site cũ (ảnh, PDF, video...) lên storage
 * S3-compatible (Cloudflare R2 / Backblaze B2) bằng rclone.
 *
 * Cấu hình qua biến môi trường:
 *   R2_ACCOUNT_ID        (R2) hoặc R2_ENDPOINT (B2/S3 tuỳ chọn)
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET            tên bucket
 *
 * Ví dụ:
 *   R2_ACCOUNT_ID=abc123 R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
 *   R2_BUCKET=sachhiem-media node scripts/upload-media.mjs
 *
 * Yêu cầu: rclone (brew install rclone)
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.resolve(SITE_ROOT, '../public_html');

// ---------------------------------------------------------------- check

/** Chạy lệnh với mảng tham số (không qua shell — tránh lỗi trích dẫn). */
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error) {
    console.error(`❌ Không chạy được ${cmd}: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`❌ ${cmd} thoát với mã ${r.status}`);
    process.exit(r.status ?? 1);
  }
};

const versionCheck = spawnSync('rclone', ['version'], { stdio: 'pipe' });
if (versionCheck.error || versionCheck.status !== 0) {
  console.error('❌ Chưa cài rclone. Cài bằng: brew install rclone');
  process.exit(1);
}

const accountId = process.env.R2_ACCOUNT_ID;
const endpoint = process.env.R2_ENDPOINT ?? (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null);
const accessKey = process.env.R2_ACCESS_KEY_ID;
const secret = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET;

if (!endpoint || !accessKey || !secret || !bucket) {
  console.error('❌ Thiếu biến môi trường. Cần: R2_ACCOUNT_ID (hoặc R2_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET');
  process.exit(1);
}

// ---------------------------------------------------------------- rclone

console.log('▶ Tạo remote rclone "sh-media"...');
run('rclone', [
  'config', 'create', 'sh-media', 's3',
  'provider', accountId ? 'Cloudflare' : 'Other',
  'access_key_id', accessKey,
  'secret_access_key', secret,
  'endpoint', endpoint,
]);

// ---------------------------------------------------------------- sync

// Chỉ media, bỏ mọi thứ còn lại (.php, .LCK, thư mục rác, backup...)
// rclone 2.x không còn --exclude-dir → dùng pattern "/**" để loại cả thư mục
const mediaFilters = [
  '--include=*.{jpg,JPG,jpeg,png,PNG,gif,bmp,webp,svg}',
  '--include=*.{pdf,mp4,mp3,wav,avi,wmv,flv,mov,m4v}',
  '--include=*.{doc,docx,xls,xlsx,ppt,pptx,zip,rar}',
  '--exclude=*',
  '--exclude=.sucuriquarantine/**',
  '--exclude=.easyssl_backup/**',
  '--exclude=_vti_cnf/**',
  '--exclude=_overlay/**',
  '--exclude=cgi-bin/**',
  '--exclude=cgi/**',
  '--exclude=GODADDY/**',
  '--exclude=BACKUP FILES/**',
  '--exclude=*.LCK',
  '--exclude=.DS_Store',
  '--exclude=.zip',
  '--exclude=*.php',
  '--exclude=*.html',
  '--exclude=*.htm',
];

console.log(`▶ Đồng bộ media từ ${SOURCE_DIR} → sh-media:${bucket}/ ...`);
run('rclone', ['sync', SOURCE_DIR, `sh-media:${bucket}/`, ...mediaFilters, '--progress', '--transfers', '16']);

console.log('\n✅ Xong. Khi chuyển đổi lại bài viết, nhớ đặt MEDIA_BASE, ví dụ:');
console.log('   MEDIA_BASE=https://pub-xxxx.r2.dev node scripts/convert.mjs');
