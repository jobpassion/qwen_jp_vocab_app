import {
  listBluebookPages,
  getBluebookPage,
  saveBluebookPage,
  deleteBluebookPage,
  savePdfDataBinary,
  loadPdfDataBinary,
} from "./storage.js";

const $ = (selector) => document.querySelector(selector);

const PROMPT_TEMPLATE = `你是日语语法蓝宝书的整理助手。请根据我提供的书页图片，严格输出以下 JSON 格式，只返回 JSON（不要任何解释、注释、Markdown）。

要求：
1) 例文一定是日文+中文成对输出。
2) underline 为例文中画线部分，按出现顺序输出数组；没有画线则给空数组。
3) notes 只放“注意”的内容；extras 只放“如/例”的例句。
4) 所有字段必须存在，缺失则用空字符串/空数组。

JSON 格式：
{
  "pageMeta": {
    "unitTitle": "单元标题",
    "pageNumber": 229
  },
  "grammarItems": [
    {
      "index": "1",
      "title": "语法点标题",
      "explanation": "中文说明",
      "examples": [
        {
          "jp": "日文例句",
          "cn": "中文翻译",
          "source": "出处（如 2007年真题）",
          "underline": ["画线内容1", "画线内容2"]
        }
      ],
      "notes": ["注意事项1", "注意事项2"],
      "extras": [
        {"jp": "补充例句日文", "cn": "补充例句中文"}
      ]
    }
  ]
}`;

const DEFAULT_EXAM_STATE = {
  questions: [],
  index: 0,
  answered: false,
};

let currentPageData = null;
let currentPageNumber = null;
let examState = { ...DEFAULT_EXAM_STATE };

let pdfDoc = null;
let pdfPageCount = 0;
let pdfData = null;
let isPdfModalOpen = false;
let lastPdfPreviewPage = null;
const pdfRenderCache = new Map();
const pdfRenderTasks = new Map();
let pdfModalRenderTask = null;
let pdfModalTextLayerTask = null;
const PDF_MODAL_MAX_SCALE = 2.5;
const PDF_MODAL_MIN_WIDTH = 360;
const PDF_MODAL_MIN_HEIGHT = 320;
const PDF_MODAL_MAX_WIDTH_RATIO = 0.95;
const PDF_MODAL_MAX_HEIGHT_RATIO = 0.95;

function toastStatus(el, text) {
  if (!el) return;
  el.textContent = text;
  if (!text) return;
  setTimeout(() => {
    el.textContent = "";
  }, 3200);
}

function updateSavedPagesSelect() {
  const select = $("#savedPages");
  if (!select) return;
  const pages = listBluebookPages();
  select.innerHTML = pages.length
    ? pages.map(page => `<option value="${page}">${page}</option>`).join("")
    : "";
  select.disabled = pages.length === 0;
}

function sanitizePageNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function validateBluebookData(data) {
  if (!data || typeof data !== "object") {
    return "JSON 根节点必须是对象。";
  }
  if (!data.pageMeta || typeof data.pageMeta !== "object") {
    return "缺少 pageMeta。";
  }
  const pageNumber = sanitizePageNumber(data.pageMeta.pageNumber);
  if (!pageNumber) {
    return "pageMeta.pageNumber 必须是正整数。";
  }
  if (!Array.isArray(data.grammarItems)) {
    return "grammarItems 必须是数组。";
  }
  return null;
}

function normalizeBluebookData(data) {
  const pageNumber = sanitizePageNumber(data.pageMeta.pageNumber);
  const unitTitle = String(data.pageMeta.unitTitle || "");
  const grammarItems = data.grammarItems.map(item => ({
    index: String(item.index || ""),
    title: String(item.title || ""),
    explanation: String(item.explanation || ""),
    examples: Array.isArray(item.examples)
      ? item.examples.map(example => ({
          jp: String(example.jp || ""),
          cn: String(example.cn || ""),
          source: String(example.source || ""),
          underline: Array.isArray(example.underline) ? example.underline.map(text => String(text || "")) : [],
        }))
      : [],
    notes: Array.isArray(item.notes) ? item.notes.map(text => String(text || "")) : [],
    extras: Array.isArray(item.extras)
      ? item.extras.map(example => ({
          jp: String(example.jp || ""),
          cn: String(example.cn || ""),
        }))
      : [],
  }));

  return {
    pageMeta: { unitTitle, pageNumber },
    grammarItems,
  };
}

function parseJsonInput() {
  const input = $("#jsonInput");
  const status = $("#parseStatus");
  if (!input) return;

  let payload;
  try {
    payload = JSON.parse(input.value);
  } catch (err) {
    toastStatus(status, "JSON 解析失败，请检查格式。");
    return;
  }

  const error = validateBluebookData(payload);
  if (error) {
    toastStatus(status, error);
    return;
  }

  const normalized = normalizeBluebookData(payload);
  saveBluebookPage(normalized.pageMeta.pageNumber, normalized);
  updateSavedPagesSelect();
  const select = $("#savedPages");
  if (select) select.value = String(normalized.pageMeta.pageNumber);
  currentPageNumber = normalized.pageMeta.pageNumber;
  currentPageData = normalized;
  renderCurrentPage();
  toastStatus(status, `已保存页码 ${normalized.pageMeta.pageNumber}，数据已覆盖。`);
}

function loadSelectedPage() {
  const select = $("#savedPages");
  const status = $("#parseStatus");
  if (!select || !select.value) return;
  const pageNumber = sanitizePageNumber(select.value);
  if (!pageNumber) return;
  const data = getBluebookPage(pageNumber);
  if (!data) {
    toastStatus(status, "未找到该页数据。");
    return;
  }
  currentPageNumber = pageNumber;
  currentPageData = data;
  
  const jsonInput = $("#jsonInput");
  if (jsonInput) {
    jsonInput.value = JSON.stringify(data, null, 2);
  }
  
  renderCurrentPage();
}

function deleteSelectedPage() {
  const select = $("#savedPages");
  if (!select || !select.value) return;
  const pageNumber = sanitizePageNumber(select.value);
  if (!pageNumber) return;
  const ok = confirm(`确认删除页码 ${pageNumber} 的数据吗？`);
  if (!ok) return;
  deleteBluebookPage(pageNumber);
  updateSavedPagesSelect();
  if (currentPageNumber === pageNumber) {
    currentPageNumber = null;
    currentPageData = null;
    renderCurrentPage();
  }
}

function buildMarkedText(container, text, segments) {
  container.innerHTML = "";
  if (!text) return;
  if (!Array.isArray(segments) || segments.length === 0) {
    container.textContent = text;
    return;
  }

  let cursor = 0;
  segments.forEach(segment => {
    if (!segment) return;
    const index = text.indexOf(segment, cursor);
    if (index === -1) return;
    container.append(document.createTextNode(text.slice(cursor, index)));
    const marker = document.createElement("span");
    marker.className = "underline";
    marker.textContent = segment;
    container.append(marker);
    cursor = index + segment.length;
  });
  container.append(document.createTextNode(text.slice(cursor)));
}

function enterEditMode(li, grammarItem, exampleIndex) {
  const example = grammarItem.examples[exampleIndex];
  li.innerHTML = "";
  
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "background: rgba(0,0,0,0.2); padding: 8px; border-radius: 8px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 4px;";
  
  const createField = (label, val) => {
    const lbl = document.createElement("label");
    lbl.textContent = label;
    lbl.style.cssText = "font-size: 12px; color: #9aa6cf;";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = val;
    inp.style.width = "100%";
    return { lbl, inp };
  };

  const fJp = createField("日文例句", example.jp);
  const fUl = createField("画线部分 (按出现顺序，逗号分隔)", (example.underline || []).join("，"));
  const fCn = createField("中文翻译", example.cn);
  
  wrapper.append(fJp.lbl, fJp.inp, fUl.lbl, fUl.inp, fCn.lbl, fCn.inp);
  
  const actions = document.createElement("div");
  actions.className = "actions-inline";
  actions.style.cssText = "justify-content: flex-end; margin-top: 4px;";
  
  const btnSave = document.createElement("button");
  btnSave.textContent = "保存";
  btnSave.className = "small";
  btnSave.style.cssText = "padding: 4px 8px; font-size: 13px;";
  
  const btnCancel = document.createElement("button");
  btnCancel.textContent = "取消";
  btnCancel.className = "small secondary";
  btnCancel.style.cssText = "padding: 4px 8px; font-size: 13px;";
  
  actions.append(btnSave, btnCancel);
  wrapper.append(actions);
  li.append(wrapper);
  
  fJp.inp.focus();
  
  const saveHandler = () => {
    const newJp = fJp.inp.value.trim();
    const newUlStr = fUl.inp.value.trim();
    const newCn = fCn.inp.value.trim();
    
    // Split by comma (fullwidth or halfwidth)
    const newUl = newUlStr.split(/[，,]/).map(s => s.trim()).filter(s => s);
    
    // Update Data
    example.jp = newJp;
    example.underline = newUl;
    example.cn = newCn;
    
    // Save
    saveBluebookPage(currentPageData.pageMeta.pageNumber, currentPageData);
    
    // Re-render
    renderCurrentPage();
  };
  
  btnSave.onclick = saveHandler;
  btnCancel.onclick = () => renderCurrentPage();
  
  wrapper.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        saveHandler();
    }
    if (e.key === "Escape") {
        renderCurrentPage();
    }
  });
}

function renderCurrentPage() {
  const meta = $("#pageMeta");
  const list = $("#grammarList");
  if (!meta || !list) return;

  list.innerHTML = "";
  meta.innerHTML = "";
  resetExam();

  if (!currentPageData) {
    meta.innerHTML = "<div class=\"note\">请先导入或选择一个页码。</div>";
    showPdfPreview(null);
    return;
  }

  const { unitTitle, pageNumber } = currentPageData.pageMeta;
  const metaCard = document.createElement("div");
  metaCard.className = "page-meta-card";
  metaCard.innerHTML = `
    <div>
      <div class="meta-title">${unitTitle || "（无单元标题）"}</div>
      <div class="meta-sub">页码：${pageNumber}</div>
    </div>
    <button id="btnOpenPdfPage" class="secondary">查看原文书页</button>
  `;
  meta.appendChild(metaCard);

  const openBtn = $("#btnOpenPdfPage");
  if (openBtn) {
    openBtn.addEventListener("click", () => {
      if (pageNumber) openPdfPreviewForPage(pageNumber);
    });
  }

  currentPageData.grammarItems.forEach(item => {
    const card = document.createElement("article");
    card.className = "grammar-card";

    const header = document.createElement("div");
    header.className = "grammar-header";
    header.innerHTML = `
      <div class="grammar-index">${item.index}</div>
      <div>
        <div class="grammar-title">${item.title || "（无标题）"}</div>
        <div class="grammar-expl">${item.explanation || ""}</div>
      </div>
    `;
    card.appendChild(header);

    const exampleBlock = document.createElement("div");
    exampleBlock.className = "grammar-block";
    exampleBlock.innerHTML = "<h4>例文</h4>";
    if (item.examples.length === 0) {
      exampleBlock.innerHTML += "<div class=\"note\">暂无例文</div>";
    } else {
      const list = document.createElement("ol");
      list.className = "example-list";
      item.examples.forEach((example, exIdx) => {
        const li = document.createElement("li");
        const jp = document.createElement("div");
        jp.className = "example-jp";
        
        const jpText = document.createElement("span");
        buildMarkedText(jpText, example.jp, example.underline);
        jp.appendChild(jpText);

        const editBtn = document.createElement("span");
        editBtn.textContent = " ✎";
        editBtn.style.cssText = "cursor: pointer; font-size: 14px; opacity: 0.5; margin-left: 6px;";
        editBtn.title = "修改";
        editBtn.onclick = () => enterEditMode(li, item, exIdx);
        jp.appendChild(editBtn);

        const cn = document.createElement("div");
        cn.className = "example-cn";
        cn.textContent = example.cn || "";
        const source = document.createElement("div");
        source.className = "example-source";
        source.textContent = example.source ? `出处：${example.source}` : "";
        li.appendChild(jp);
        li.appendChild(cn);
        if (example.source) li.appendChild(source);
        list.appendChild(li);
      });
      exampleBlock.appendChild(list);
    }
    card.appendChild(exampleBlock);

    const notesBlock = document.createElement("div");
    notesBlock.className = "grammar-block";
    notesBlock.innerHTML = "<h4>注意</h4>";
    if (item.notes.length === 0) {
      notesBlock.innerHTML += "<div class=\"note\">暂无注意事项</div>";
    } else {
      const list = document.createElement("ul");
      list.className = "note-list";
      item.notes.forEach(text => {
        const li = document.createElement("li");
        li.textContent = text;
        list.appendChild(li);
      });
      notesBlock.appendChild(list);
    }
    card.appendChild(notesBlock);

    const extraBlock = document.createElement("div");
    extraBlock.className = "grammar-block";
    extraBlock.innerHTML = "<h4>如 / 例</h4>";
    if (item.extras.length === 0) {
      extraBlock.innerHTML += "<div class=\"note\">暂无补充例句</div>";
    } else {
      const list = document.createElement("ul");
      list.className = "extra-list";
      item.extras.forEach(example => {
        const li = document.createElement("li");
        li.innerHTML = `
          <div class="example-jp">${example.jp || ""}</div>
          <div class="example-cn">${example.cn || ""}</div>
        `;
        list.appendChild(li);
      });
      extraBlock.appendChild(list);
    }
    card.appendChild(extraBlock);

    list.appendChild(card);
  });

  showPdfPreview(pageNumber);
}

function buildExamQuestions(data) {
  if (!data) return [];
  const questions = [];
  data.grammarItems.forEach(item => {
    item.examples.forEach((example, exampleIndex) => {
      const underline = Array.isArray(example.underline) ? example.underline.filter(Boolean) : [];
      if (underline.length === 0) return;
      questions.push({
        index: item.index,
        exampleIndex: exampleIndex + 1,
        jp: example.jp,
        cn: example.cn,
        underline,
      });
    });
  });
  return questions;
}

function normalizeAnswer(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s。、，,．.！？!?「」『』（）()［］\[\]【】・：:；;’'“”"…—\-]/g, "");
}

function renderExamQuestion() {
  const panel = $("#examPanel");
  const questionEl = $("#examQuestion");
  const progressEl = $("#examProgress");
  const sourceEl = $("#examSource");
  const resultEl = $("#examResult");
  if (!panel || !questionEl || !progressEl || !sourceEl || !resultEl) return;

  if (examState.questions.length === 0) {
    panel.classList.add("hidden");
    return;
  }

  const question = examState.questions[examState.index];
  questionEl.innerHTML = "";
  resultEl.textContent = "";
  resultEl.className = "result";
  examState.answered = false;

  const sentenceWrapper = document.createElement("div");
  sentenceWrapper.className = "exam-sentence";
  let cursor = 0;
  question.underline.forEach((segment, idx) => {
    if (!segment) return;
    let foundIndex = question.jp.indexOf(segment, cursor);
    if (foundIndex === -1) {
      foundIndex = question.jp.length;
    }
    sentenceWrapper.append(document.createTextNode(question.jp.slice(cursor, foundIndex)));
    const input = document.createElement("input");
    input.type = "text";
    input.className = "exam-blank";
    input.dataset.answer = segment;
    input.placeholder = `空${idx + 1}`;
    sentenceWrapper.append(input);
    cursor = foundIndex + (foundIndex === question.jp.length ? 0 : segment.length);
  });
  sentenceWrapper.append(document.createTextNode(question.jp.slice(cursor)));
  questionEl.appendChild(sentenceWrapper);

  if (question.cn) {
    const hint = document.createElement("div");
    hint.className = "exam-hint";
    hint.textContent = `中文：${question.cn}`;
    questionEl.appendChild(hint);
  }

  progressEl.textContent = `第 ${examState.index + 1} / ${examState.questions.length} 题`;
  sourceEl.textContent = `语法点 ${question.index} · 例文 ${question.exampleIndex}`;
  panel.classList.remove("hidden");
}

function startExam() {
  if (!currentPageData) {
    alert("请先导入或选择书页数据。");
    return;
  }
  examState.questions = buildExamQuestions(currentPageData);
  examState.index = 0;
  examState.answered = false;
  if (examState.questions.length === 0) {
    alert("当前页没有可练习的例文画线内容。");
    return;
  }
  renderExamQuestion();
}

function resetExam() {
  examState = { ...DEFAULT_EXAM_STATE };
  const panel = $("#examPanel");
  const resultEl = $("#examResult");
  if (panel) panel.classList.add("hidden");
  if (resultEl) resultEl.textContent = "";
}

function submitAnswer() {
  const resultEl = $("#examResult");
  if (!resultEl || examState.questions.length === 0) return;
  if (examState.answered) return;

  const blanks = Array.from(document.querySelectorAll(".exam-blank"));
  if (!blanks.length) return;

  const results = blanks.map(input => {
    const answer = input.dataset.answer || "";
    const user = input.value || "";
    return {
      correct: normalizeAnswer(answer) === normalizeAnswer(user),
      answer,
      user,
    };
  });

  const allCorrect = results.every(item => item.correct);
  examState.answered = true;

  if (allCorrect) {
    resultEl.textContent = "✅ 全部正确";
    resultEl.className = "result good";
  } else {
    const answersText = results.map((item, idx) => `空${idx + 1}: ${item.answer}`).join(" | ");
    resultEl.textContent = `❌ 有错误，正确答案：${answersText}`;
    resultEl.className = "result bad";
  }
}

function nextQuestion() {
  if (examState.questions.length === 0) return;
  if (examState.index + 1 >= examState.questions.length) {
    const resultEl = $("#examResult");
    if (resultEl) {
      resultEl.textContent = "已完成全部题目。";
      resultEl.className = "result warn";
    }
    return;
  }
  examState.index += 1;
  renderExamQuestion();
}

function bindPrompt() {
  const promptBox = $("#promptTemplate");
  if (promptBox) promptBox.textContent = PROMPT_TEMPLATE;

  const copyBtn = $("#btnCopyPrompt");
  const status = $("#promptStatus");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(PROMPT_TEMPLATE);
        toastStatus(status, "提示词已复制。");
      } catch (err) {
        console.warn("复制失败", err);
        toastStatus(status, "复制失败，请手动复制。");
      }
    });
  }
}

function setPdfPreviewVisibility(show) {
  const section = $("#pdfPreviewSection");
  if (!section) return;
  section.classList.toggle("hidden", !show);
}

function setPdfPreviewInfo(text) {
  const info = $("#pdfPreviewInfo");
  if (info) info.textContent = text || "";
}

function setPdfPreviewMessage(text) {
  const container = $("#pdfPreviewContainer");
  if (!container) return;
  container.classList.remove("has-thumb");
  container.innerHTML = text
    ? `<div class="pdf-preview-message">${text}</div>`
    : "";
}

function resetPdfState() {
  if (pdfDoc) {
    pdfDoc.destroy();
    pdfDoc = null;
  }
  pdfPageCount = 0;
  pdfData = null;
  pdfRenderCache.clear();
  pdfRenderTasks.clear();
}

async function loadPersistedPdf() {
  if (!window.pdfjsLib) return;
  const stored = await loadPdfDataBinary();
  if (!stored) {
    hidePdfPreview();
    return;
  }

  try {
    let baseBuffer;
    if (stored instanceof ArrayBuffer) {
      baseBuffer = stored;
    } else if (ArrayBuffer.isView(stored)) {
      const view = stored;
      baseBuffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    } else {
      baseBuffer = new Uint8Array(stored).buffer;
    }
    const bufferForDoc = baseBuffer.slice(0);
    const bufferForState = baseBuffer.slice(0);
    const bytesForDoc = new Uint8Array(bufferForDoc);
    pdfData = new Uint8Array(bufferForState);
    pdfDoc = await pdfjsLib.getDocument({ data: bytesForDoc }).promise;
    pdfPageCount = pdfDoc.numPages;
    setPdfPreviewVisibility(true);
    setPdfPreviewInfo(`共 ${pdfPageCount} 页`);
    setPdfPreviewMessage("");
    if (currentPageNumber) {
      showPdfPreview(currentPageNumber);
    }
  } catch (err) {
    console.error("恢复 PDF 失败", err);
    resetPdfState();
    hidePdfPreview();
  }
}

async function renderPdfPageAssets(pageNumber) {
  if (!pdfDoc) throw new Error("PDF 尚未加载");
  if (pdfRenderCache.has(pageNumber)) return pdfRenderCache.get(pageNumber);
  if (pdfRenderTasks.has(pageNumber)) return pdfRenderTasks.get(pageNumber);

  const task = (async () => {
    const page = await pdfDoc.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });

    try {
      const makeRender = async (targetWidth) => {
        const scale = Math.min(targetWidth / baseViewport.width, 2);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const dataURL = canvas.toDataURL("image/png");
        canvas.width = canvas.height = 0;
        return dataURL;
      };

      const thumb = await makeRender(160);
      const full = await makeRender(900);
      const assets = { thumb, full };
      pdfRenderCache.set(pageNumber, assets);
      pdfRenderTasks.delete(pageNumber);
      return assets;
    } finally {
      page.cleanup();
    }
  })().catch(err => {
    pdfRenderTasks.delete(pageNumber);
    throw err;
  });

  pdfRenderTasks.set(pageNumber, task);
  return task;
}

async function showPdfPreview(pageNumber) {
  if (!$("#pdfPreviewSection")) return;

  if (!pageNumber) {
    setPdfPreviewVisibility(!!pdfDoc);
    if (pdfDoc) {
      setPdfPreviewInfo(`共 ${pdfPageCount} 页`);
      setPdfPreviewMessage("请从已保存页中选择页码。");
    }
    return;
  }

  if (!pdfDoc) {
    setPdfPreviewVisibility(true);
    setPdfPreviewInfo("");
    setPdfPreviewMessage("请先上传整本 PDF 文件。");
    return;
  }

  if (pageNumber < 1 || pageNumber > pdfPageCount) {
    setPdfPreviewVisibility(true);
    setPdfPreviewInfo(`共 ${pdfPageCount} 页`);
    setPdfPreviewMessage("PDF 中未找到对应的页码。");
    return;
  }

  setPdfPreviewVisibility(true);
  setPdfPreviewInfo(`第 ${pageNumber} 页 / 共 ${pdfPageCount} 页`);
  setPdfPreviewMessage("正在渲染预览…");

  try {
    const assets = await renderPdfPageAssets(pageNumber);
    const container = $("#pdfPreviewContainer");
    if (!container) return;
    container.innerHTML = "";
    container.classList.add("has-thumb");
    const wrapper = document.createElement("div");
    wrapper.className = "pdf-preview-thumb active";
    const img = document.createElement("img");
    img.src = assets.thumb;
    img.alt = `PDF 第 ${pageNumber} 页`;
    wrapper.appendChild(img);
    wrapper.addEventListener("click", () => openPdfModal(pageNumber));
    container.appendChild(wrapper);
    lastPdfPreviewPage = pageNumber;
  } catch (err) {
    console.error("渲染 PDF 预览失败", err);
    setPdfPreviewMessage("渲染失败，请稍后重试。");
  }
}

function hidePdfPreview() {
  setPdfPreviewVisibility(false);
  setPdfPreviewInfo("");
  setPdfPreviewMessage("");
}

function getPdfModalElements() {
  const modal = $("#pdfModal");
  const modalContent = modal?.querySelector(".pdf-modal-content") ?? null;
  const viewer = $("#pdfModalViewer");
  return {
    modal,
    modalContent,
    viewer,
    canvasWrapper: viewer?.querySelector(".pdf-modal-canvas-wrapper") ?? null,
    canvas: $("#pdfModalCanvas"),
    textLayer: $("#pdfModalTextLayer"),
    loading: $("#pdfModalLoading"),
    handles: modalContent?.querySelectorAll("[data-resize-corner]") ?? null,
  };
}

function resetPdfModalViewer() {
  if (pdfModalRenderTask?.cancel) {
    try {
      pdfModalRenderTask.cancel();
    } catch (_) {
      // ignore
    }
  }
  if (pdfModalTextLayerTask?.cancel) {
    try {
      pdfModalTextLayerTask.cancel();
    } catch (_) {
      // ignore
    }
  }
  pdfModalRenderTask = null;
  pdfModalTextLayerTask = null;

  const { canvas, textLayer, loading, canvasWrapper } = getPdfModalElements();
  if (canvas) {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    canvas.width = 0;
    canvas.height = 0;
    canvas.style.width = "";
    canvas.style.height = "";
  }
  if (canvasWrapper) {
    canvasWrapper.style.width = "";
    canvasWrapper.style.height = "";
  }
  if (textLayer) {
    textLayer.innerHTML = "";
    textLayer.style.width = "";
    textLayer.style.height = "";
  }
  if (loading) {
    loading.textContent = "";
    loading.classList.add("hidden");
  }
}

async function renderPdfPageInModal(pageNumber) {
  if (!pdfDoc) throw new Error("PDF 尚未加载");

  const { viewer, canvasWrapper, canvas, textLayer, loading, modalContent } = getPdfModalElements();
  if (!viewer || !canvas || !textLayer) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;

  if (loading) {
    loading.textContent = "正在加载…";
    loading.classList.remove("hidden");
  }

  let page = null;
  try {
    page = await pdfDoc.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const containerWidth = Math.max(
      viewer.clientWidth || 0,
      modalContent?.clientWidth || 0,
      baseViewport.width
    );
    const scale = Math.min(
      PDF_MODAL_MAX_SCALE,
      Math.max(containerWidth / baseViewport.width, 0.5)
    );
    const viewport = page.getViewport({ scale });
    const outputScale = window.devicePixelRatio || 1;

    if (canvasWrapper) {
      canvasWrapper.style.width = `${viewport.width}px`;
      canvasWrapper.style.height = `${viewport.height}px`;
    }

    canvas.width = viewport.width * outputScale;
    canvas.height = viewport.height * outputScale;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    textLayer.innerHTML = "";
    textLayer.style.width = `${viewport.width}px`;
    textLayer.style.height = `${viewport.height}px`;

    ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);
    ctx.clearRect(0, 0, viewport.width, viewport.height);

    const renderTask = page.render({ canvasContext: ctx, viewport });
    pdfModalRenderTask = renderTask;

    const textContent = await page.getTextContent();
    const textLayerTask = pdfjsLib.renderTextLayer({
      textContent,
      container: textLayer,
      viewport,
      textDivs: [],
      enhanceTextSelection: true,
    });
    pdfModalTextLayerTask = textLayerTask;

    await Promise.all([renderTask.promise, textLayerTask.promise]);

    if (loading) {
      loading.textContent = "";
      loading.classList.add("hidden");
    }
  } catch (err) {
    if (err?.name === "RenderingCancelledException") {
      return;
    }
    console.error("渲染 PDF 模态窗口失败", err);
    if (loading) {
      loading.textContent = "渲染失败，请重试。";
      loading.classList.remove("hidden");
    }
  } finally {
    pdfModalRenderTask = null;
    pdfModalTextLayerTask = null;
    if (page) {
      try {
        page.cleanup();
      } catch (_) {
        // ignore
      }
    }
  }
}

function openPdfModal(pageNumber) {
  const { modal, modalContent } = getPdfModalElements();
  if (!modal || !modalContent) return;

  resetPdfModalViewer();
  modalContent.style.left = "50%";
  modalContent.style.top = "50%";
  modalContent.style.transform = "translate(-50%, -50%)";
  modalContent.style.cursor = "default";
  modal.classList.remove("hidden");
  lastPdfPreviewPage = pageNumber;
  isPdfModalOpen = true;

  renderPdfPageInModal(pageNumber).catch(err => {
    console.error("渲染 PDF 页面失败", err);
  });
}

function closePdfModal() {
  const { modal, modalContent } = getPdfModalElements();
  if (!modal || !modalContent || !isPdfModalOpen) return;

  resetPdfModalViewer();
  modal.classList.add("hidden");
  modal.classList.remove("dragging");
  modalContent.style.left = "50%";
  modalContent.style.top = "50%";
  modalContent.style.transform = "translate(-50%, -50%)";
  modalContent.style.cursor = "default";
  isPdfModalOpen = false;
}

async function openPdfPreviewForPage(pageNumber) {
  if (!pdfDoc) {
    alert("请先上传整本 PDF 文件。");
    return;
  }
  if (pageNumber < 1 || pageNumber > pdfPageCount) {
    alert("PDF 中没有找到该页码。");
    return;
  }
  try {
    await renderPdfPageAssets(pageNumber);
    openPdfModal(pageNumber);
  } catch (err) {
    console.error("打开 PDF 预览失败", err);
    alert("打开 PDF 预览失败，请稍后重试。");
  }
}

async function onPdfFileSelected(event) {
  const input = event.target;
  const file = input?.files?.[0];
  if (!file) return;

  if (!window.pdfjsLib) {
    alert("未能加载 PDF.js，无法预览 PDF。");
    return;
  }

  let hasPrevious = false;
  try {
    const prev = await loadPdfDataBinary();
    hasPrevious = !!prev;
  } catch {
    hasPrevious = false;
  }
  resetPdfState();
  setPdfPreviewVisibility(true);
  setPdfPreviewInfo("");
  setPdfPreviewMessage("正在解析 PDF…");

  try {
    const originalBuffer = await file.arrayBuffer();
    const bufferForDoc = originalBuffer.slice(0);
    const bufferForStore = originalBuffer.slice(0);
    const bytesForDoc = new Uint8Array(bufferForDoc);
    const doc = await pdfjsLib.getDocument({ data: bytesForDoc }).promise;
    pdfDoc = doc;
    pdfData = new Uint8Array(bufferForStore);
    pdfPageCount = doc.numPages;
    try {
      await savePdfDataBinary(bufferForStore);
    } catch (storageErr) {
      console.warn("持久化 PDF 失败：", storageErr);
    }
    setPdfPreviewInfo(`共 ${pdfPageCount} 页`);
    if (currentPageNumber) {
      await showPdfPreview(currentPageNumber);
    } else {
      setPdfPreviewMessage("");
    }
  } catch (err) {
    console.error("加载 PDF 失败", err);
    setPdfPreviewInfo("");
    setPdfPreviewMessage("PDF 打开失败，请确认文件是否有效。");
    resetPdfState();
    if (hasPrevious) {
      await loadPersistedPdf();
    }
  } finally {
    if (input) input.value = "";
  }
}

function bindPdfModalEvents() {
  document.querySelectorAll("[data-close-pdf-modal]").forEach(el => {
    el.addEventListener("click", closePdfModal);
  });

  document.addEventListener("keydown", async (e) => {
    if (e.key !== "Escape") return;
    if (isPdfModalOpen) {
      e.preventDefault();
      closePdfModal();
      return;
    }
    if (lastPdfPreviewPage) {
      e.preventDefault();
      try {
        await renderPdfPageAssets(lastPdfPreviewPage);
        openPdfModal(lastPdfPreviewPage);
      } catch (err) {
        console.error("重新打开 PDF 预览失败", err);
      }
    }
  });

  const modalElement = $("#pdfModal");
  const modalContent = modalElement?.querySelector(".pdf-modal-content");
  if (!modalElement || !modalContent) return;

  let isDragging = false;
  let isResizing = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let modalStartLeft = 0;
  let modalStartTop = 0;
  let resizeCorner = null;
  let resizeStart = null;
  const resizeHandles = modalContent.querySelectorAll("[data-resize-corner]");

  const startDrag = (event) => {
    if (!modalContent) return;
    if (isResizing) return;
    if (event.target.closest?.("[data-resize-corner]")) return;

    const rect = modalContent.getBoundingClientRect();
    let clientX;
    let clientY;
    if (event.type === "mousedown") {
      clientX = event.clientX;
      clientY = event.clientY;
    } else {
      const touch = event.touches[0];
      if (!touch) return;
      clientX = touch.clientX;
      clientY = touch.clientY;
    }

    const relativeX = clientX - rect.left;
    const relativeY = clientY - rect.top;
    const BORDER_SIZE = 18;
    const nearEdge =
      relativeX <= BORDER_SIZE ||
      relativeY <= BORDER_SIZE ||
      relativeX >= rect.width - BORDER_SIZE ||
      relativeY >= rect.height - BORDER_SIZE;

    if (!nearEdge) {
      return;
    }

    isDragging = true;
    modalElement.classList.add("dragging");
    modalContent.style.cursor = "grabbing";
    modalStartLeft = rect.left;
    modalStartTop = rect.top;
    modalContent.style.transform = "none";
    modalContent.style.left = `${rect.left}px`;
    modalContent.style.top = `${rect.top}px`;
    if (event.type === "mousedown") {
      dragStartX = clientX;
      dragStartY = clientY;
      document.addEventListener("mousemove", onDrag);
      document.addEventListener("mouseup", endDrag);
    } else if (event.type === "touchstart") {
      dragStartX = clientX;
      dragStartY = clientY;
      document.addEventListener("touchmove", onDrag, { passive: false });
      document.addEventListener("touchend", endDrag);
      document.addEventListener("touchcancel", endDrag);
    }
    event.preventDefault();
  };

  const onDrag = (event) => {
    if (!isDragging || !modalContent) return;
    let clientX;
    let clientY;
    if (event.type === "mousemove") {
      clientX = event.clientX;
      clientY = event.clientY;
    } else {
      const touch = event.touches[0];
      if (!touch) return;
      clientX = touch.clientX;
      clientY = touch.clientY;
    }

    const deltaX = clientX - dragStartX;
    const deltaY = clientY - dragStartY;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const contentRect = modalContent.getBoundingClientRect();
    const width = contentRect.width;
    const height = contentRect.height;
    const nextLeft = Math.min(Math.max(modalStartLeft + deltaX, 0), Math.max(0, viewportWidth - width));
    const nextTop = Math.min(Math.max(modalStartTop + deltaY, 0), Math.max(0, viewportHeight - height));
    modalContent.style.left = `${nextLeft}px`;
    modalContent.style.top = `${nextTop}px`;
    modalContent.style.margin = "0";
    event.preventDefault();
  };

  const endDrag = () => {
    if (!isDragging) return;
    isDragging = false;
    modalElement.classList.remove("dragging");
    document.removeEventListener("mousemove", onDrag);
    document.removeEventListener("mouseup", endDrag);
    document.removeEventListener("touchmove", onDrag);
    document.removeEventListener("touchend", endDrag);
    document.removeEventListener("touchcancel", endDrag);
    if (modalContent) {
      modalContent.style.cursor = "default";
    }
  };

  const startResize = (event) => {
    if (!modalContent) return;
    const target = event.currentTarget ?? event.target;
    const corner = target?.dataset?.resizeCorner;
    if (!corner) return;

    let clientX;
    let clientY;
    if (event.type === "mousedown") {
      clientX = event.clientX;
      clientY = event.clientY;
    } else {
      const touch = event.touches[0];
      if (!touch) return;
      clientX = touch.clientX;
      clientY = touch.clientY;
    }

    const rect = modalContent.getBoundingClientRect();
    isResizing = true;
    resizeCorner = corner;
    resizeStart = {
      clientX,
      clientY,
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
    };

    modalElement.classList.add("dragging");
    modalContent.style.transform = "none";
    modalContent.style.left = `${rect.left}px`;
    modalContent.style.top = `${rect.top}px`;
    modalContent.style.width = `${rect.width}px`;
    modalContent.style.height = `${rect.height}px`;
    modalContent.style.margin = "0";
    const currentCursor = window.getComputedStyle(target).cursor;
    modalContent.style.cursor = currentCursor || "default";
    event.preventDefault();
    event.stopPropagation();

    if (event.type === "mousedown") {
      document.addEventListener("mousemove", handleResizeMove);
      document.addEventListener("mouseup", endResize);
    } else {
      document.addEventListener("touchmove", handleResizeMove, { passive: false });
      document.addEventListener("touchend", endResize);
      document.addEventListener("touchcancel", endResize);
    }
  };

  const handleResizeMove = (event) => {
    if (!isResizing || !modalContent || !resizeStart || !resizeCorner) return;

    let clientX;
    let clientY;
    if (event.type === "mousemove") {
      clientX = event.clientX;
      clientY = event.clientY;
    } else {
      const touch = event.touches[0];
      if (!touch) return;
      clientX = touch.clientX;
      clientY = touch.clientY;
    }

    const deltaX = clientX - resizeStart.clientX;
    const deltaY = clientY - resizeStart.clientY;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxWidth = Math.max(PDF_MODAL_MIN_WIDTH, Math.floor(viewportWidth * PDF_MODAL_MAX_WIDTH_RATIO));
    const maxHeight = Math.max(PDF_MODAL_MIN_HEIGHT, Math.floor(viewportHeight * PDF_MODAL_MAX_HEIGHT_RATIO));

    let newWidth = resizeStart.width;
    let newHeight = resizeStart.height;
    let newLeft = resizeStart.left;
    let newTop = resizeStart.top;

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    switch (resizeCorner) {
      case "nw": {
        const widthCandidate = resizeStart.width - deltaX;
        const heightCandidate = resizeStart.height - deltaY;
        newWidth = clamp(widthCandidate, PDF_MODAL_MIN_WIDTH, maxWidth);
        newHeight = clamp(heightCandidate, PDF_MODAL_MIN_HEIGHT, maxHeight);
        newLeft = resizeStart.left + (resizeStart.width - newWidth);
        newTop = resizeStart.top + (resizeStart.height - newHeight);
        break;
      }
      case "ne": {
        const widthCandidate = resizeStart.width + deltaX;
        const heightCandidate = resizeStart.height - deltaY;
        newWidth = clamp(widthCandidate, PDF_MODAL_MIN_WIDTH, maxWidth);
        newHeight = clamp(heightCandidate, PDF_MODAL_MIN_HEIGHT, maxHeight);
        newTop = resizeStart.top + (resizeStart.height - newHeight);
        break;
      }
      case "sw": {
        const widthCandidate = resizeStart.width - deltaX;
        const heightCandidate = resizeStart.height + deltaY;
        newWidth = clamp(widthCandidate, PDF_MODAL_MIN_WIDTH, maxWidth);
        newHeight = clamp(heightCandidate, PDF_MODAL_MIN_HEIGHT, maxHeight);
        newLeft = resizeStart.left + (resizeStart.width - newWidth);
        break;
      }
      case "se": {
        const widthCandidate = resizeStart.width + deltaX;
        const heightCandidate = resizeStart.height + deltaY;
        newWidth = clamp(widthCandidate, PDF_MODAL_MIN_WIDTH, maxWidth);
        newHeight = clamp(heightCandidate, PDF_MODAL_MIN_HEIGHT, maxHeight);
        break;
      }
      default:
        break;
    }

    newWidth = clamp(newWidth, PDF_MODAL_MIN_WIDTH, maxWidth);
    newHeight = clamp(newHeight, PDF_MODAL_MIN_HEIGHT, maxHeight);
    newLeft = clamp(newLeft, 0, Math.max(0, viewportWidth - newWidth));
    newTop = clamp(newTop, 0, Math.max(0, viewportHeight - newHeight));

    modalContent.style.width = `${newWidth}px`;
    modalContent.style.height = `${newHeight}px`;
    modalContent.style.left = `${newLeft}px`;
    modalContent.style.top = `${newTop}px`;
    modalContent.style.margin = "0";
    event.preventDefault();
  };

  const endResize = () => {
    if (!isResizing) return;
    isResizing = false;
    resizeCorner = null;
    resizeStart = null;
    modalElement.classList.remove("dragging");
    document.removeEventListener("mousemove", handleResizeMove);
    document.removeEventListener("mouseup", endResize);
    document.removeEventListener("touchmove", handleResizeMove);
    document.removeEventListener("touchend", endResize);
    document.removeEventListener("touchcancel", endResize);
    if (modalContent) {
      modalContent.style.cursor = "default";
    }
    if (isPdfModalOpen && lastPdfPreviewPage) {
      renderPdfPageInModal(lastPdfPreviewPage).catch(err => {
        console.error("调整 PDF 模态窗口后重新渲染失败", err);
      });
    }
  };

  if (modalContent) {
    modalContent.addEventListener("mousedown", startDrag);
    modalContent.addEventListener("touchstart", startDrag, { passive: false });
  }

  if (resizeHandles?.length) {
    resizeHandles.forEach(handle => {
      handle.addEventListener("mousedown", startResize);
      handle.addEventListener("touchstart", startResize, { passive: false });
    });
  }

  const handleWheel = (event) => {
    const target = event.target.closest(".pdf-modal-content");
    if (!target) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = target;
    const atTop = scrollTop === 0;
    const atBottom = Math.ceil(scrollTop + clientHeight) >= scrollHeight;
    const goingUp = event.deltaY < 0;
    const goingDown = event.deltaY > 0;

    if ((atTop && goingUp) || (atBottom && goingDown)) {
      event.preventDefault();
    }
  };

  let lastTouchY = null;

  const handleTouchMove = (event) => {
    const content = event.target.closest(".pdf-modal-content");
    if (!content) {
      lastTouchY = null;
      return;
    }

    const touch = event.touches[0];
    if (!touch) return;

    if (lastTouchY === null) {
      lastTouchY = touch.clientY;
      return;
    }

    const currentY = touch.clientY;
    const deltaY = lastTouchY - currentY;
    lastTouchY = currentY;

    const { scrollTop, scrollHeight, clientHeight } = content;
    const atTop = scrollTop === 0;
    const atBottom = Math.ceil(scrollTop + clientHeight) >= scrollHeight;
    const goingDown = deltaY > 0;
    const goingUp = deltaY < 0;

    if ((atTop && !goingDown) || (atBottom && goingDown)) {
      event.preventDefault();
    }
  };

  const resetTouch = () => {
    lastTouchY = null;
  };

  modalElement.addEventListener("wheel", handleWheel, { passive: false });
  modalElement.addEventListener("touchmove", handleTouchMove, { passive: false });
  modalElement.addEventListener("touchend", resetTouch);
  modalElement.addEventListener("touchcancel", resetTouch);
}

function bindUI() {
  bindPrompt();
  $("#btnParseJson")?.addEventListener("click", parseJsonInput);
  $("#btnLoadPage")?.addEventListener("click", loadSelectedPage);
  $("#btnDeletePage")?.addEventListener("click", deleteSelectedPage);
  $("#btnStartExam")?.addEventListener("click", startExam);
  $("#btnResetExam")?.addEventListener("click", resetExam);
  $("#btnSubmitAnswer")?.addEventListener("click", submitAnswer);
  $("#btnNextQuestion")?.addEventListener("click", nextQuestion);

  const pdfInput = $("#pdfFileInput");
  if (pdfInput) pdfInput.addEventListener("change", onPdfFileSelected);

  bindPdfModalEvents();
}

function init() {
  updateSavedPagesSelect();
  if ($("#savedPages")?.value) {
    loadSelectedPage();
  } else {
    renderCurrentPage();
  }
  loadPersistedPdf();
  bindUI();
}

init();
