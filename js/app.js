// js/app.js
import { QwenClient, fileToDataURL } from "./api.js";
import { savePage, getPage, listPages, deletePage, saveApiConfig, loadApiConfig } from "./storage.js";
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
    
    const items = await extractWordsFromImage(client, dataURL);
    savePage(items.page, items.items);
    renderTable(items);
    refreshSavedPages();
    toastStatus(status, `提取成功，已保存页 ${page}（${items.length} 条）`);
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

async function startQuiz(mode) {
  const page = Number($("#pageNumber").value);
  let items = getPage(page);
  if (!items || !items.length) {
    // 如果表格里有内容，也可直接取表格
    items = getPage(Number($("#savedPages").value)) || [];
  }
  if (!items.length) { alert("当前页无词汇数据。请先提取或载入。"); return; }

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
  $("#quizPanel").classList.remove("hidden");
  $("#quizMode").textContent = mode === "CN_JP_SEQ" ? "顺序：问中文→答日文" :
                               mode === "CN_JP_SHUFFLE" ? "乱序：问中文→答日文" :
                               "乱序：问日文→答中文（模糊判定）";
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
  if (!engine) return;
  const final = `测验结束：${engine.correct}/${engine.total}`;
  $("#quizResult").textContent = final;
  $("#quizResult").className = "result";
  if (!auto) alert(final);
  engine = null;
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
});
