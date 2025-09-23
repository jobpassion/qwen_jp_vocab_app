// js/storage.js
// 每个页单独一条 localStorage 记录，key 格式：jp_vocab_page_<页码>

const PREFIX = "jp_vocab_page_";  // 每个页的 key 前缀
const KEY_API = "jp_vocab_api_cfg_v1";  // API 配置还是集中存

// 列出所有已保存的页码（按数字大小排序）
export function listPages() {
  const keys = Object.keys(localStorage);
  return keys
      .filter(k => k.startsWith(PREFIX))
      .map(k => k.substring(PREFIX.length))
      .sort((a, b) => Number(a) - Number(b));
}

// 读取某一页的数据（返回数组）
export function getPage(page) {
  try {
    return JSON.parse(localStorage.getItem(PREFIX + page) || "[]");
  } catch {
    return [];
  }
}

// 保存某一页的数据（items 是数组）
export function savePage(page, items) {
  localStorage.setItem(PREFIX + page, JSON.stringify(items));
}

// 删除某一页的数据
export function deletePage(page) {
  localStorage.removeItem(PREFIX + page);
}

// -------- API 配置相关 --------

// 保存 API 配置（对象：{apiBase, model, apiKey}）
export function saveApiConfig(cfg) {
  localStorage.setItem(KEY_API, JSON.stringify(cfg));
}

// 读取 API 配置
export function loadApiConfig() {
  try {
    return JSON.parse(localStorage.getItem(KEY_API) || "{}");
  } catch {
    return {};
  }
}
