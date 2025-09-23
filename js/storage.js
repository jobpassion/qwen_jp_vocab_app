// js/storage.js
const KEY = "jp_vocab_pages_v1";
const KEY_API = "jp_vocab_api_cfg_v1";

function loadAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch { return {}; }
}

function saveAll(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function listPages() {
  const data = loadAll();
  return Object.keys(data).sort((a,b)=>Number(a)-Number(b));
}

export function getPage(page) {
  const data = loadAll();
  return data[String(page)] || [];
}

export function savePage(page, items) {
  const data = loadAll();
  data[String(page)] = items;
  saveAll(data);
}

export function deletePage(page) {
  const data = loadAll();
  delete data[String(page)];
  saveAll(data);
}

export function saveApiConfig(cfg) {
  localStorage.setItem(KEY_API, JSON.stringify(cfg));
}
export function loadApiConfig() {
  try { return JSON.parse(localStorage.getItem(KEY_API) || "{}"); }
  catch { return {}; }
}
