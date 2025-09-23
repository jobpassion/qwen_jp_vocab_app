// js/storage.js
// 每个页单独一条 localStorage 记录，key 格式：jp_vocab_page_<页码>

const PREFIX = "jp_vocab_page_";  // 每个页的 key 前缀
const KEY_API = "jp_vocab_api_cfg_v1";  // API 配置还是集中存
const KEY_EXAM_HISTORY = "jp_vocab_exam_history_v1";  // 考试历史记录

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

// -------- 考试历史记录相关 --------

// 保存考试历史记录
export function saveExamHistory(examData) {
  console.log("saveExamHistory 接收到数据:", examData); // 调试信息
  
  const history = loadExamHistory();
  
  // 创建考试记录的唯一标识（页码+类型）
  const key = `${examData.page}_${examData.type}`;
  
  console.log("考试记录唯一标识:", key); // 调试信息
  
  // 如果已存在相同页码和类型的考试，则更新并增加次数
  if (history[key]) {
    history[key].count += 1;
    history[key].lastTime = examData.time;
    history[key].result = `${examData.correct}/${examData.total}`;
    history[key].accuracy = examData.accuracy;
    history[key].accuracyClass = getAccuracyClass(examData.accuracy);
  } else {
    // 新考试记录
    history[key] = {
      page: examData.page,
      type: examData.type,
      typeName: examData.typeName,
      result: `${examData.correct}/${examData.total}`,
      accuracy: examData.accuracy,
      accuracyClass: getAccuracyClass(examData.accuracy),
      time: examData.time,
      lastTime: examData.time,
      count: 1
    };
  }
  
  console.log("保存后的历史记录:", history); // 调试信息
  localStorage.setItem(KEY_EXAM_HISTORY, JSON.stringify(history));
}

// 读取考试历史记录
export function loadExamHistory() {
  try {
    return JSON.parse(localStorage.getItem(KEY_EXAM_HISTORY) || "{}");
  } catch {
    return {};
  }
}

// 获取正确率对应的CSS类名
function getAccuracyClass(accuracy) {
  if (accuracy >= 80) return "high";
  if (accuracy >= 60) return "medium";
  return "low";
}

// 获取考试历史记录列表（按时间排序）
export function getExamHistoryList() {
  const history = loadExamHistory();
  return Object.values(history)
    .sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));
}
