// js/app.js
import { QwenClient, fileToDataURL } from "./api.js";
import { savePage, getPage, listPages, deletePage, saveApiConfig, loadApiConfig, saveExamHistory, getExamHistoryList } from "./storage.js";
import { extractWordsFromImage, parseManualJson } from "./extract.js";
import { QuizEngine } from "./quiz.js";

const SKIPPED_ANSWER = "__SKIPPED__";
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
      <td>${it.jp}</td>
      <td>${it.pos || ""}</td>
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
  
  if (history.length === 0) {
    historyList.innerHTML = '<div class="no-history">暂无考试记录</div>';
    return;
  }
  
  // Sort by page number, ascending
  history.sort((a, b) => a.page - b.page);

  historyList.innerHTML = history.map(item => {
    const accuracyClass = item.accuracy >= 80 ? 'good' : item.accuracy >= 60 ? 'warn' : 'bad';
    const typeClass = item.type.includes('SEQ') ? 'type-seq' :
                     item.type.includes('READING') ? 'type-reading' :
                     item.type.includes('SHUFFLE') ? 'type-shuffle' : 'type-fuzzy';
    
    return `
      <div class="exam-history-item ${typeClass}">
        <div class="count">${item.count}</div>
        <div class="page">P. ${item.page}</div>
        <div class="type">${item.typeName}</div>
        <div class="result">${item.result}</div>
        <div class="accuracy ${accuracyClass}">${item.accuracy}%</div>
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
  const file = $("#pageImage").files?.[0];
  const status = $("#extractStatus");
  
  if (!file) {
    toastStatus(status, "请选择图片");
    return;
  }
  
  try {
    const dataURL = await fileToDataURL(file);
    status.textContent = "正在调用千问进行结构化提取…";
    const result = await extractWordsFromImage(client, dataURL);
    savePage(result.page, result.items);
    $("#pageNumber").value = String(result.page);
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
let isSubmitting = false;

async function startQuiz(mode) {
  let page = Number($("#pageNumber").value);
  let items = getPage(page);
  
  if ((!page || !items || !items.length) && $("#savedPages").value) {
    page = Number($("#savedPages").value);
    items = getPage(page);
    $("#pageNumber").value = String(page);
  }
  
  if (!items || !items.length) { 
    alert("当前页无词汇数据。请先提取或载入。"); 
    return; 
  }

  const judgeFuzzyBatch = async (pairs) => {
    const prompt = `你是日汉释义判定器。你将收到一个JSON数组，每个对象包含一个标准释义和一个用户答案。请判断每个用户答案是否与标准释义“基本一致/大致正确”，允许同义词和语序差异。你需要返回一个与输入等长的JSON数组，每个对象包含{"correct": true|false, "reason": "一句话理由"}。不要输出任何额外文本。请务必检查输出与输入的json等长. \n\n输入：\n${JSON.stringify(pairs, null, 2)}`;
    const messages = [
        { role: "system", content: [{ type: "text", text: "你是一个严格的JSON格式输出助理。" }] },
        { role: "user", content: [{ type: "text", text: prompt }] }
    ];
    try {
      const content = await client.chat(messages, { temperature: 0.0, response_format: { type: "json_object" } });
      const parsed = JSON.parse(content);
      
      const resultsArray = Array.isArray(parsed) ? parsed : parsed.results || parsed.data;

      if (!Array.isArray(resultsArray)) {
        console.error("API response did not contain a valid results array.", parsed);
        throw new Error("API返回格式无效");
      }
      if (resultsArray.length !== pairs.length) {
        console.error(`API returned ${resultsArray.length} results, but ${pairs.length} were expected.`, resultsArray);
        throw new Error(`API返回结果数量不匹配`);
      }

      return resultsArray;

    } catch (e) {
      console.error("调用千问批量判定API失败", e);
      throw new Error(`AI评分接口调用失败: ${e.message}`);
    }
  };

  engine = new QuizEngine(items, mode, { judgeFuzzyBatch });
  quizHistory = [];
  isSubmitting = false;
  $("#quizHistory").innerHTML = "";
  
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
  $("#quizControls").style.display = "block";
  $("#quizPostGradingControls").style.display = "none";
  
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

  setTimeout(() => {
    if (engine) {
        $("#btnSubmitAnswer").disabled = false;
        $("#btnSkip").disabled = false;
        isSubmitting = false;
    }
  }, 500);
}

async function submitAnswer(skip = false) {
    if (!engine || isSubmitting) return;
    isSubmitting = true;
    
    $("#btnSubmitAnswer").disabled = true;
    $("#btnSkip").disabled = true;

    const currentQuestion = engine.currentQuestion();
    const originalIndex = engine.index;
    const ans = $("#quizAnswer").value.trim();
    const answerPayload = skip ? SKIPPED_ANSWER : ans;

    const res = await engine.answer(answerPayload);

    const historyItem = {
        question: currentQuestion.text,
        answer: skip ? "(跳过)" : ans,
        correct: 'pending',
        reason: '',
        originalIndex: originalIndex
    };

    const isFuzzyMode = engine.mode === "JP_CN_FUZZY_SHUFFLE";

    if (isFuzzyMode) {
        if (skip) {
            historyItem.correct = 'skipped';
        }
    } else {
        historyItem.correct = skip ? 'skipped' : (res.ok ? 'correct' : 'incorrect');
        historyItem.reason = res.reason || '';
    }

    quizHistory.push(historyItem);
    updateQuizHistory();

    const el = $("#quizResult");
    if (historyItem.correct === 'pending') {
        el.textContent = "答案已记录";
        el.className = "result";
    } else if (historyItem.correct === 'skipped') {
        el.textContent = "已跳过";
        el.className = "result warn";
    } else if (res.ok) {
        el.textContent = "✅ 正确！";
        el.className = "result good";
    } else {
        el.textContent = "❌ 不正确。" + (res.reason ? " " + res.reason : "");
        el.className = "result bad";
    }

    $("#quizProgress").textContent = `进度：${res.progress.cur}/${res.progress.total}`;
    if (!isFuzzyMode) {
        $("#quizProgress").textContent += ` · 得分：${engine.correct}`;
    }
    
    const delay = isFuzzyMode ? 0 : 800;
    setTimeout(() => {
        if (res.done) {
            endQuiz(true);
        } else {
            nextQuestion();
        }
    }, delay);
}

function updateQuizHistory() {
  const historyContainer = $("#quizHistory");
  historyContainer.innerHTML = "";
  
  quizHistory.forEach((item) => {
    const div = document.createElement("div");
    div.className = `quiz-history-item ${item.correct}`;
    
    let resultText;
    switch (item.correct) {
      case "correct": resultText = "✓"; break;
      case "incorrect": resultText = "✗"; break;
      case "skipped": resultText = "跳过"; break;
      case "pending": resultText = "待评分"; break;
      default: resultText = "?";
    }
    
    div.innerHTML = `
      <div class="question">${item.question}</div>
      <div class="answer">${item.answer}</div>
      <div class="result">${resultText}</div>
      <div class="reason">${item.reason}</div>
    `;
    
    historyContainer.appendChild(div);
  });
  
  historyContainer.scrollTop = historyContainer.scrollHeight;
}

async function endQuiz(isAutoEnd = false) {
  if (!engine || !currentExamInfo) return;

  const isFuzzyMode = engine.mode === "JP_CN_FUZZY_SHUFFLE";

  if (isFuzzyMode) {
    if (!isAutoEnd && !confirm("确认要提前结束并对已答题目进行评分吗？")) {
      isSubmitting = false;
      $("#btnSubmitAnswer").disabled = false;
      $("#btnSkip").disabled = false;
      return;
    }

    const el = $("#quizResult");
    el.textContent = "正在评分，请稍候...";
    el.className = "result";
    $("#quizControls").style.display = "none";

    try {
      console.log("--- Starting Batch Grading ---");
      const finalResults = await engine.gradeFuzzyAnswers();
      console.log("Raw results from engine:", JSON.stringify(finalResults));
      console.log("Quiz history before update:", JSON.stringify(quizHistory));

      quizHistory.forEach((historyItem) => {
        if (historyItem.correct === 'pending') {
          const result = finalResults[historyItem.originalIndex];
          if (result) {
            historyItem.correct = result.ok ? 'correct' : 'incorrect';
            historyItem.reason = result.reason;
          } else {
            console.error(`Result missing for pending item with original index ${historyItem.originalIndex}.`);
            historyItem.reason = "评分数据丢失或不匹配";
            historyItem.correct = 'incorrect';
          }
        }
      });
      
      console.log("Quiz history after update:", JSON.stringify(quizHistory));
      updateQuizHistory();

    } catch (e) {
        console.error("Grading failed:", e);
        el.textContent = `评分失败: ${e.message}`;
        el.className = "result bad";
        $("#quizPostGradingControls").style.display = "block";
        return;
    }
  }

  const finalScoreText = `测验结束：${engine.correct}/${engine.total}`;
  $("#quizResult").textContent = finalScoreText;
  $("#quizResult").className = "result";
  
  const examData = {
    ...currentExamInfo,
    total: engine.total,
    correct: engine.correct,
    accuracy: engine.total > 0 ? Math.round((engine.correct / engine.total) * 100) : 0,
    time: new Date().toISOString()
  };
  saveExamHistory(examData);
  refreshExamHistory();
  
  if (!isFuzzyMode && !isAutoEnd) {
    alert(finalScoreText);
  }
  
  if (!isFuzzyMode) {
      closeQuizPanel();
  } else {
    $("#quizControls").style.display = "none";
    $("#quizPostGradingControls").style.display = "block";
  }
}

function closeQuizPanel() {
    engine = null;
    currentExamInfo = null;
    quizHistory = [];
    isSubmitting = false;
    $("#quizPanel").classList.add("hidden");
}

function switchTab(tabName) {
  $$(".tab-btn").forEach(btn => btn.classList.remove("active"));
  $$(".tab-panel").forEach(panel => panel.classList.remove("active"));
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
  $("#tabImage").addEventListener("click", () => switchTab("Image"));
  $("#tabManual").addEventListener("click", () => switchTab("Manual"));
  $("#btnExtract").addEventListener("click", onExtract);
  $("#btnLoadPage").addEventListener("click", onLoadPage);
  $("#btnDeletePage").addEventListener("click", onDeletePage);
  $("#btnParseJson").addEventListener("click", onParseJson);
  $("#btnShowExample").addEventListener("click", toggleJsonExample);
  
  $("#btnQuizSeq").addEventListener("click", ()=>startQuiz("CN_JP_SEQ"));
  $("#btnQuizShuffle").addEventListener("click", ()=>startQuiz("CN_JP_SHUFFLE"));
  $("#btnQuizReading").addEventListener("click", ()=>startQuiz("JP_READING_SHUFFLE"));
  $("#btnQuizFuzzy").addEventListener("click", ()=>startQuiz("JP_CN_FUZZY_SHUFFLE"));
  
  $("#btnSubmitAnswer").addEventListener("click", () => {
    if (isSubmitting) return;
    submitAnswer(false);
  });
  $("#btnSkip").addEventListener("click", () => {
    if (isSubmitting) return;
    submitAnswer(true);
  });
  $("#btnEndQuiz").addEventListener("click", ()=>endQuiz(false));
  $("#quizAnswer").addEventListener("keydown", (e)=>{
    if (e.key === "Enter") {
        if (isSubmitting) return;
        submitAnswer(false);
    }
  });

  $("#btnCloseQuiz").addEventListener("click", closeQuizPanel);
}

document.addEventListener("DOMContentLoaded", () => {
  bindUI();
  loadApiCfgToUI();
  refreshSavedPages();
  refreshExamHistory();
});
