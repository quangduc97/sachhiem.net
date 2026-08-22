// Cấu hình dùng chung giữa các script (converter, index bài viết, admin config)

// Ánh xạ trang indexXX.php (link "Trang …" cuối bài cũ) → tên chuyên mục
export const CATEGORY_MAP = {
  baicu: 'Bài cũ',
  CT: 'Chính trị',
  DT: 'Đối thoại',
  EM: 'Email',
  KH: 'Khoa học',
  LS: 'Lịch sử',
  SN: 'Sách ngoại văn',
  SP: 'Sách phê bình',
  TG: 'Tác giả',
  TQ: 'Thời sự',
  VH: 'Văn hóa',
  XH: 'Xã hội',
};

/** Slug không dấu cho chuyên mục: "Lịch sử" → "lich-su". */
export const slugify = (s) =>
  s.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const CATEGORIES = () => {
  const map = {};
  for (const name of new Set(Object.values(CATEGORY_MAP))) {
    map[slugify(name)] = name;
  }
  return map;
};
