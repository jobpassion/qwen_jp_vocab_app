// js/app.js
import { QwenClient, fileToDataURL } from "./api.js";
import { savePage, getPage, listPages, deletePage, saveApiConfig, loadApiConfig, saveExamHistory, getExamHistoryList } from "./storage.js";
import { extractWordsFromImage, parseManualJson } from "./extract.js";
import { QuizEngine } from "./quiz.js";

let client = new QwenClient({});

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function toastStatus(el, text) {
  el.textContent = text;
  setTimeout(()=>{ el.textContent=""; }, 3500);
}

function renderTable(items) {
  const tbody = $("#wordTable tbody");
  tbody.innerHTML = "";
  items.forEach((it, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx+1}</td>
      <td>${it.pos || ""}</td>
      <td>${it.jp}</td>
      <td>${it.reading || ""}</td>
      <td>${it.cn}</td>
      <td>${it.tag || "普通"}</td>
    `;
    tbody.appendChild(tr);
  });
}

function refreshSavedPages() {
  const sel = $("#savedPages");
  const pages = listPages();
  sel.innerHTML = pages.length ? pages.map(p => `<option value="${p}">${p}</option>`).join("") : `<option value="">（暂无）</option>`;
}

function refreshExamHistory() {
  const historyList = $("#examHistoryList");
  const history = getExamHistoryList();
  
  console.log("考试历史记录:", history); // 调试信息
  
  if (history.length === 0) {
    historyList.innerHTML = '<div class="no-history">暂无考试记录</div>';
    return;
  }
  
  historyList.innerHTML = history.map(item => {
    const typeClass = item.type.includes('SEQ') ? 'type-seq' : 
                     item.type.includes('READING') ? 'type-reading' :
                     item.type.includes('SHUFFLE') ? 'type-shuffle' : 'type-fuzzy';
    
    return `
      <div class="exam-history-item ${typeClass}">
        <div class="count">${item.count}</div>
        <div class="page">${item.page}</div>
        <div class="type">${item.typeName}</div>
        <div class="result">${item.result}</div>
        <div class="accuracy ${item.accuracyClass}">${item.accuracy}%</div>
        <div class="time">${formatTime(item.lastTime)}</div>
      </div>
    `;
  }).join('');
}

function formatTime(timeStr) {
  const date = new Date(timeStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;
  
  return date.toLocaleDateString();
}

function loadApiCfgToUI() {
  const cfg = loadApiConfig();
  if (cfg.apiBase) $("#apiBase").value = cfg.apiBase;
  if (cfg.model) $("#apiModel").value = cfg.model;
  if (cfg.apiKey) {
    $("#apiKey").value = cfg.apiKey;
    $("#rememberKey").checked = true;
  }
  client.setConfig({ apiBase: $("#apiBase").value, apiKey: $("#apiKey").value, model: $("#apiModel").value });
}

function readApiCfgFromUI() {
  const apiBase = $("#apiBase").value.trim();
  const model = $("#apiModel").value.trim();
  const apiKey = $("#apiKey").value.trim();
  client.setConfig({ apiBase, apiKey, model });
  if ($("#rememberKey").checked) {
    saveApiConfig({ apiBase, model, apiKey });
  } else {
    saveApiConfig({ apiBase, model, apiKey: "" });
  }
}

async function onExtract() {
  readApiCfgFromUI();
  // let page = Number($("#pageNumber").value);
  const file = $("#pageImage").files?.[0];
  const status = $("#extractStatus");
  
  if (!file) {
    toastStatus(status, "请选择图片");
    return;
  }
  
  try {
    const dataURL = await fileToDataURL(file);
    
    // 如果没有输入页码，尝试自动检测
    // if (!page) {
    //   status.textContent = "正在检测页码…";
    //   page = await detectPageNumber(client, dataURL);
    //   if (!page) {
    //     toastStatus(status, "无法自动检测页码，请手动输入");
    //     return;
    //   }
    //   $("#pageNumber").value = String(page);
    //   status.textContent = `检测到页码：${page}，正在进行词汇提取…`;
    // } else {
    //   status.textContent = "正在调用千问进行结构化提取…";
    // }
    
    const result = await extractWordsFromImage(client, dataURL);
    savePage(result.page, result.items);
    $("#pageNumber").value = String(result.page); // 更新页码输入框
    renderTable(result.items);
    refreshSavedPages();
    toastStatus(status, `提取成功，已保存页 ${result.page}（${result.items.length} 条）`);
  } catch (e) {
    console.error(e);
    toastStatus(status, "提取失败：" + e.message);
  }
}

function onLoadPage() {
  const sel = $("#savedPages");
  const page = Number(sel.value);
  if (!page) return;
  const items = getPage(page);
  $("#pageNumber").value = String(page);
  renderTable(items);
}

function onDeletePage() {
  const sel = $("#savedPages");
  const page = Number(sel.value);
  if (!page) return;
  if (confirm(`确认删除页 ${page} 的数据？`)) {
    deletePage(page);
    refreshSavedPages();
    $("#wordTable tbody").innerHTML = "";
  }
}

function onParseJson() {
  const page = Number($("#manualPageNumber").value);
  const jsonText = $("#manualJson").value.trim();
  const status = $("#parseStatus");
  
  try {
    const result = parseManualJson(jsonText);
    const items = result.items;
    
    if (!items || items.length === 0) {
      toastStatus(status, "JSON中没有找到有效的词汇数据");
      return;
    }
    
    // 如果JSON中有页码且与输入的不同，使用JSON中的页码
    const finalPage = result.page || page;
    if (result.page && result.page !== page) {
      $("#manualPageNumber").value = String(finalPage);
    }
    
    savePage(finalPage, items);
    renderTable(items);
    refreshSavedPages();
    toastStatus(status, `解析成功，已保存页 ${finalPage}（${items.length} 条）`);
  } catch (e) {
    console.error(e);
    toastStatus(status, "JSON解析失败：" + e.message);
  }
}

let engine = null;
let quizHistory = [];
let currentExamInfo = null;

async function startQuiz(mode) {
  let page = Number($("#pageNumber").value);
  let items = getPage(page);
  
  // 如果页码输入框为空或没有数据，尝试从已保存页面中选择
  if (!page || !items || !items.length) {
    const savedPage = Number($("#savedPages").value);
    if (savedPage) {
      page = savedPage;
      items = getPage(savedPage);
      $("#pageNumber").value = String(savedPage); // 更新页码输入框
    }
  }
  
  if (!items || !items.length) { 
    alert("当前页无词汇数据。请先提取或载入。"); 
    return; 
  }

  const judgeFuzzy = async (goldCN, userCN) => {
    // 调用千问进行模糊判定（仅在 JP→CN 模式使用）
    const messages = [
      { role: "system", content: [{ type: "text", text: "你是日汉释义判定器。仅返回 JSON，不要多余文本。" }] },
      { role: "user", content: [
        { type: "text", text:
`标准中文释义：${goldCN}
用户答案：${userCN}

判断用户答案与标准释义是否“基本一致/大致正确”，允许常见同义词、措辞差异。
输出严格 JSON：{"correct": true|false, "reason": "一句话理由（中文）"}` }
      ]}
    ];
    try {
      const content = await client.chat(messages, { temperature: 0.0, response_format: { type: "json_object" } });
      return JSON.parse(content);
    } catch (e) {
      console.warn("判定失败，回退到简单包含匹配", e);
      const ok = userCN && goldCN && (userCN === goldCN || goldCN.includes(userCN) || userCN.includes(goldCN));
      return { correct: ok, reason: ok ? "近似匹配" : "不匹配" };
    }
  };

  engine = new QuizEngine(items, mode, { judgeFuzzy });
  quizHistory = []; // 清空答题历史
  $("#quizHistory").innerHTML = ""; // 清空历史显示
  
  // 记录当前考试信息
  const typeName = mode === "CN_JP_SEQ" ? "顺序考（问中文→答日文）" :
                   mode === "CN_JP_SHUFFLE" ? "乱序考（问中文→答日文）" :
                   mode === "JP_READING_SHUFFLE" ? "乱序考（问日文→答假名读音）" :
                   "乱序考（问日文→答中文）";
  
  currentExamInfo = {
    page: page,
    type: mode,
    typeName: typeName,
    startTime: new Date().toISOString()
  };
  
  $("#quizPanel").classList.remove("hidden");
  $("#quizMode").textContent = typeName;
  nextQuestion();
}

function nextQuestion() {
  const q = engine.currentQuestion();
  if (!q) { endQuiz(true); return; }
  $("#quizQuestion").textContent = q.text;
  $("#quizHint").textContent = q.hint || "";
  $("#quizAnswer").value = "";
  $("#quizAnswer").focus();
  $("#quizProgress").textContent = `进度：${engine.index+1}/${engine.total}`;
  $("#quizResult").textContent = "";
  $("#quizResult").className = "result";
}

async function submitAnswer(skip=false) {
  if (!engine) return;
  const ans = skip ? "" : $("#quizAnswer").value.trim();
  const currentQuestion = engine.currentQuestion();
  const res = await engine.answer(ans);
  const el = $("#quizResult");
  
  // 记录答题历史
  const historyItem = {
    question: currentQuestion.text,
    answer: ans || "(跳过)",
    correct: skip ? "skipped" : res.ok ? "correct" : "incorrect",
    reason: res.reason || ""
  };
  quizHistory.push(historyItem);
  updateQuizHistory();
  
  if (skip) {
    el.textContent = "已跳过";
    el.className = "result warn";
  } else if (res.ok) {
    el.textContent = "✅ 正确！";
    el.className = "result good";
  } else {
    el.textContent = "❌ 不正确。" + (res.reason ? " " + res.reason : "");
    el.className = "result bad";
  }
  $("#quizProgress").textContent = `进度：${Math.min(res.progress.cur, engine.total)}/${engine.total} · 得分：${engine.correct}`;
  setTimeout(()=>{
    if (res.done) endQuiz();
    else nextQuestion();
  }, 600);
}

function updateQuizHistory() {
  const historyContainer = $("#quizHistory");
  historyContainer.innerHTML = "";
  
  quizHistory.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = `quiz-history-item ${item.correct}`;
    
    const resultText = item.correct === "correct" ? "✓" : 
                      item.correct === "incorrect" ? "✗" : "跳过";
    
    div.innerHTML = `
      <div class="question">${item.question}</div>
      <div class="answer">${item.answer}</div>
      <div class="result">${resultText}</div>
    `;
    
    historyContainer.appendChild(div);
  });
  
  // 滚动到底部显示最新记录
  historyContainer.scrollTop = historyContainer.scrollHeight;
}

function endQuiz(auto=false) {
  if (!engine || !currentExamInfo) return;
  
  const final = `测验结束：${engine.correct}/${engine.total}`;
  $("#quizResult").textContent = final;
  $("#quizResult").className = "result";
  
  // 保存考试历史记录
  const examData = {
    ...currentExamInfo,
    correct: engine.correct,
    total: engine.total,
    accuracy: Math.round((engine.correct / engine.total) * 100),
    time: new Date().toISOString()
  };
  
  console.log("保存考试数据:", examData); // 调试信息
  saveExamHistory(examData);
  refreshExamHistory();
  
  if (!auto) alert(final);
  
  // 清理
  engine = null;
  currentExamInfo = null;
  $("#quizPanel").classList.add("hidden");
}

function switchTab(tabName) {
  // 移除所有活动状态
  $$(".tab-btn").forEach(btn => btn.classList.remove("active"));
  $$(".tab-panel").forEach(panel => panel.classList.remove("active"));
  
  // 激活选中的选项卡
  $(`#tab${tabName}`).classList.add("active");
  $(`#panel${tabName}`).classList.add("active");
}

function toggleJsonExample() {
  const example = $("#jsonExample");
  const btn = $("#btnShowExample");
  
  if (example.classList.contains("hidden")) {
    example.classList.remove("hidden");
    btn.textContent = "隐藏JSON格式示例";
  } else {
    example.classList.add("hidden");
    btn.textContent = "查看JSON格式示例";
  }
}

function bindUI() {
  // 选项卡切换
  $("#tabImage").addEventListener("click", () => switchTab("Image"));
  $("#tabManual").addEventListener("click", () => switchTab("Manual"));
  
  // 原有功能
  $("#btnExtract").addEventListener("click", onExtract);
  $("#btnLoadPage").addEventListener("click", onLoadPage);
  $("#btnDeletePage").addEventListener("click", onDeletePage);
  
  // 新增功能
  $("#btnParseJson").addEventListener("click", onParseJson);
  $("#btnShowExample").addEventListener("click", toggleJsonExample);
  
  // 测验功能
  $("#btnQuizSeq").addEventListener("click", ()=>startQuiz("CN_JP_SEQ"));
  $("#btnQuizShuffle").addEventListener("click", ()=>startQuiz("CN_JP_SHUFFLE"));
  $("#btnQuizReading").addEventListener("click", ()=>startQuiz("JP_READING_SHUFFLE"));
  $("#btnQuizFuzzy").addEventListener("click", ()=>startQuiz("JP_CN_FUZZY_SHUFFLE"));
  $("#btnSubmitAnswer").addEventListener("click", ()=>submitAnswer(false));
  $("#btnSkip").addEventListener("click", ()=>submitAnswer(true));
  $("#btnEndQuiz").addEventListener("click", ()=>endQuiz(false));
  $("#quizAnswer").addEventListener("keydown", (e)=>{
    if (e.key === "Enter") submitAnswer(false);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindUI();
  loadApiCfgToUI();
  refreshSavedPages();
  refreshExamHistory();
});
