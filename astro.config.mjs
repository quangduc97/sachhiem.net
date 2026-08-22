import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Giai đoạn hiện tại: chạy ở URL tạm https://quangduc97.github.io/sachhiem.net/
// Khi trỏ domain sachhiem.net: đổi BASE=/ và SITE_URL=https://sachhiem.net
// (hoặc đặt biến môi trường BASE / SITE_URL khi build)
const base = process.env.BASE ?? '/sachhiem.net/';
const site = process.env.SITE_URL ?? 'https://quangduc97.github.io';

/** Prefix base vào mọi href/src tuyệt đối trong HTML đã build
 *  (Astro không tự xử lý base cho <a href> và một số asset ở template). */
function prefixBaseInHtml(dir) {
  if (!base || base === '/') return;
  const prefix = base.replace(/^\/|\/$/g, '');
  const re = /(href|src)="\/(?!\/)(?!sachhiem\.net\/)([^"]*)"/g;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) {
        const html = fs.readFileSync(p, 'utf8');
        const out = html.replace(re, (m, attr, url) => `${attr}="/${prefix}/${url}"`);
        if (out !== html) fs.writeFileSync(p, out);
      }
    }
  };
  walk(dir);
}

function prefixBaseIntegration() {
  return {
    name: 'prefix-base',
    hooks: {
      'astro:build:done': ({ dir }) => {
        prefixBaseInHtml(dir.pathname ?? dir);
      },
    },
  };
}

// https://astro.build/config
export default defineConfig({
  site,
  base,
  integrations: [sitemap(), prefixBaseIntegration()],
});
