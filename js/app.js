// js/app.js
import { QwenClient, fileToDataURL } from "./api.js";
import { savePage, getPage, listPages, deletePage, saveApiConfig, loadApiConfig, saveExamHistory, getExamHistoryList, savePdfDataBinary, loadPdfDataBinary, exportAllData, importAllData, saveAuthSession, loadAuthSession, clearAuthSession } from "./storage.js";
import { extractWordsFromImage, parseManualJson } from "./extract.js";
import { QuizEngine } from "./quiz.js";

const SKIPPED_ANSWER = "__SKIPPED__";
let client = new QwenClient({});
let authSession = null;

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const DEFAULT_STATE = { page: null, search: "" };
let currentState = { ...DEFAULT_STATE };

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

function normalizeState(state = {}) {
  const rawSearch = state.search != null ? String(state.search).trim() : "";
  if (rawSearch) {
    return { page: null, search: rawSearch };
  }

  const rawPage = state.page;
  let page = null;
  if (rawPage !== undefined && rawPage !== null && rawPage !== "") {
    const parsedPage = Number(rawPage);
    if (!Number.isNaN(parsedPage) && parsedPage > 0) {
      page = parsedPage;
    }
  }
  return { page, search: "" };
}

function statesEqual(a, b) {
  return a.page === b.page && a.search === b.search;
}

function buildURLFromState(state) {
  const params = new URLSearchParams();
  if (state.page) params.set("page", String(state.page));
  if (state.search) params.set("search", state.search);
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}`;
}

function setViewState(nextState, { replace = false } = {}) {
  const normalized = normalizeState(nextState);
  const url = buildURLFromState(normalized);
  const method = replace ? "replaceState" : "pushState";

  if (!replace && statesEqual(normalized, currentState)) {
    return;
  }

  history[method](normalized, "", url);
  currentState = normalized;
}

function parseStateFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const pageParam = params.get("page");
  const searchParam = params.get("search");
  return normalizeState({ page: pageParam, search: searchParam });
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
    setPdfPreviewMessage("请先上传参考 PDF 文件。");
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
    alert("请先上传参考 PDF 文件。");
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
    const currentPage = Number($("#pageNumber").value) || Number($("#savedPages").value);
    if (currentPage) {
      await showPdfPreview(currentPage);
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

function toastStatus(el, text) {
  el.textContent = text;
  setTimeout(()=>{ el.textContent=""; }, 3500);
}

function renderTable(items, options = {}) {
  const { showPageColumn = false } = options;
  const table = $("#wordTable");
  const tbody = table?.querySelector("tbody");
  const theadRow = table?.querySelector("thead tr");
  const shouldShowPageColumn = showPageColumn || items.some(it => it.page !== undefined && it.page !== null);

  if (!tbody || !theadRow) return;

  const headers = shouldShowPageColumn
    ? ["#", "页码", "日文", "词性", "读音", "中文释义", "标签"]
    : ["#", "日文", "词性", "读音", "中文释义", "标签"];

  theadRow.innerHTML = headers.map(text => `<th>${text}</th>`).join("");

    tbody.innerHTML = "";
  items.forEach((it, idx) => {
    const tr = document.createElement("tr");
    tr.appendChild(createCell(idx + 1));

    if (shouldShowPageColumn) {
      const pageTd = document.createElement("td");
      if (it.page != null) {
        const page = Number(it.page);
        const jumpBtn = document.createElement("button");
        jumpBtn.type = "button";
        jumpBtn.className = "page-link";
        jumpBtn.dataset.page = String(page);
        jumpBtn.textContent = `P. ${page}`;

        pageTd.appendChild(jumpBtn);

        const previewBtn = document.createElement("button");
        previewBtn.type = "button";
        previewBtn.className = "page-preview-btn";
        previewBtn.dataset.page = String(page);
        previewBtn.title = "查看 PDF 预览";
        previewBtn.innerHTML = "🔍";

        pageTd.appendChild(previewBtn);
      }
      tr.appendChild(pageTd);
    }

    tr.appendChild(createCell(it.jp));
    tr.appendChild(createCell(it.pos || ""));
    tr.appendChild(createCell(it.reading || ""));
    tr.appendChild(createCell(it.cn));
    tr.appendChild(createCell(it.tag || "普通"));
    tbody.appendChild(tr);
  });
}

function createCell(content) {
  const td = document.createElement("td");
  td.textContent = content;
  return td;
}

function onWordTableClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.classList.contains("page-link")) {
    const page = Number(target.dataset.page);
    if (page) {
      loadPageByNumber(page);
    }
    return;
  }

  if (target.classList.contains("page-preview-btn")) {
    const page = Number(target.dataset.page);
    if (page) {
      openPdfPreviewForPage(page);
    }
  }
}

function loadPageByNumber(page, { updateHistory = true } = {}) {
  if (!page) return false;
  const items = getPage(page) || [];
  $("#pageNumber").value = String(page);
  $("#savedPages").value = String(page);
  $("#searchInput").value = "";
  renderTable(items);
  $("#wordSectionTitle").textContent = `本页词汇 (P. ${page})`;
  showPdfPreview(page);
  lastPdfPreviewPage = page;

  if (updateHistory) {
    setViewState({ page, search: "" });
  }
  return true;
}

function executeSearch(rawQuery, { updateHistory = true } = {}) {
  const query = (rawQuery || "").trim();
  $("#searchInput").value = query;

  if (!query) {
    renderTable([]);
    $("#wordSectionTitle").textContent = "本页词汇";
    if (updateHistory) {
      setViewState(DEFAULT_STATE);
    }
    if (pdfDoc) {
      const page = Number($("#pageNumber").value) || Number($("#savedPages").value);
      if (page) {
        showPdfPreview(page);
        lastPdfPreviewPage = page;
      } else {
        showPdfPreview(null);
        lastPdfPreviewPage = null;
      }
    } else {
      hidePdfPreview();
      lastPdfPreviewPage = null;
    }
    return;
  }

  const compare = query.toLowerCase();
  const results = [];
  const pageKeys = listPages();

  pageKeys.forEach(pageKey => {
    const items = getPage(pageKey);
    items.forEach(item => {
      const jp = (item.jp || "").toLowerCase();
      const reading = (item.reading || "").toLowerCase();
      const cn = (item.cn || "").toLowerCase();
      if (jp.includes(compare) || reading.includes(compare) || cn.includes(compare)) {
        results.push({ ...item, page: Number(pageKey) });
      }
    });
  });

  renderTable(results, { showPageColumn: true });
  $("#wordSectionTitle").textContent = `搜索结果：找到 ${results.length} 条`;

  if (updateHistory) {
    setViewState({ search: query });
  }
  if (pdfDoc) {
    const activePage = Number($("#pageNumber").value) || Number($("#savedPages").value);
    if (activePage) {
      showPdfPreview(activePage);
      lastPdfPreviewPage = activePage;
    } else {
      showPdfPreview(null);
      lastPdfPreviewPage = null;
    }
  } else {
    hidePdfPreview();
    lastPdfPreviewPage = null;
  }
}

function setLoginStatus(text, timeout = 0) {
  const status = $("#loginStatus");
  if (!status) return;
  status.textContent = text;
  if (timeout > 0) {
    setTimeout(() => {
      if (status.textContent === text) {
        status.textContent = "";
      }
    }, timeout);
  }
}

function setSyncStatus(text, timeout = 0) {
  const status = $("#syncStatus");
  if (!status) return;
  status.textContent = text;
  if (timeout > 0) {
    setTimeout(() => {
      if (status.textContent === text) {
        status.textContent = "";
      }
    }, timeout);
  }
}

function updateAuthUI() {
  const info = $("#loginInfo");
  const emailInput = $("#loginEmail");
  const pwdInput = $("#loginPassword");
  const loginBtn = $("#btnLogin");
  const registerBtn = $("#btnRegister");
  const logoutBtn = $("#btnLogout");
  const syncButtons = $$("#btnSyncPush, #btnSyncPull");

  const isLoggedIn = !!authSession?.token;
  if (info) {
    info.textContent = isLoggedIn
      ? `已登录：${authSession.user.email}`
      : "未登录";
  }
  if (emailInput) emailInput.disabled = isLoggedIn;
  if (pwdInput) pwdInput.disabled = isLoggedIn;
  if (loginBtn) loginBtn.disabled = isLoggedIn;
  if (registerBtn) registerBtn.disabled = isLoggedIn;
  if (logoutBtn) logoutBtn.disabled = !isLoggedIn;
  syncButtons.forEach(btn => btn.disabled = !isLoggedIn);
}

function readAuthFromStorage() {
  authSession = loadAuthSession();
  updateAuthUI();
}

async function onLogin(event) {
  event?.preventDefault();
  const email = $("#loginEmail").value.trim();
  const password = $("#loginPassword").value;
  if (!email || !password) {
    setLoginStatus("请输入邮箱和密码");
    return;
  }
  setLoginStatus("正在登录…");
  try {
    const res = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || `登录失败 (${res.status})`);
    }
    const data = await res.json();
    authSession = data;
    saveAuthSession(data);
    setLoginStatus("登录成功", 3000);
    updateAuthUI();
    $("#loginPassword").value = "";
  } catch (err) {
    console.error(err);
    setLoginStatus(err.message || "登录失败");
  }
}

async function onRegister(event) {
  event?.preventDefault();
  const email = $("#loginEmail").value.trim();
  const password = $("#loginPassword").value;
  if (!email || !password) {
    setLoginStatus("请输入邮箱和密码");
    return;
  }
  setLoginStatus("正在注册…");
  try {
    const res = await fetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = body?.error || (res.status === 409 ? "邮箱已被注册" : `注册失败 (${res.status})`);
      throw new Error(message);
    }
    setLoginStatus("注册成功，正在登录…");
    await onLogin();
  } catch (err) {
    console.error(err);
    setLoginStatus(err.message || "注册失败");
  }
}

async function onLogout() {
  if (!authSession?.token) {
    clearAuthSession();
    authSession = null;
    updateAuthUI();
    return;
  }
  try {
    await fetch("/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${authSession.token}` },
    });
  } catch (err) {
    console.warn("退出登录请求失败", err);
  } finally {
    clearAuthSession();
    authSession = null;
    setLoginStatus("已退出登录", 2000);
    updateAuthUI();
  }
}

async function syncToServer() {
  if (!authSession?.token) {
    setSyncStatus("请先登录");
    return;
  }
  setSyncStatus("正在上传本地数据…");
  try {
    const snapshot = await exportAllData({ includePdf: false, includeAudioCache: false });
    const res = await fetch("/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authSession.token}`,
      },
      body: JSON.stringify(snapshot),
    });
    if (res.status === 401) {
      await onLogout();
      throw new Error("登录已失效，请重新登录");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || `上传失败 (${res.status})`);
    }
    setSyncStatus("上传成功", 3500);
  } catch (err) {
    console.error(err);
    setSyncStatus(err.message || "上传失败");
  }
}

async function syncFromServer() {
  if (!authSession?.token) {
    setSyncStatus("请先登录");
    return;
  }
  setSyncStatus("正在从后端获取数据…");
  try {
    const res = await fetch("/sync", {
      headers: { Authorization: `Bearer ${authSession.token}` },
    });
    if (res.status === 401) {
      await onLogout();
      throw new Error("登录已失效，请重新登录");
    }
    if (res.status === 404) {
      setSyncStatus("后端暂无同步数据", 3500);
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || `获取失败 (${res.status})`);
    }
    const record = await res.json();
    if (!record?.snapshot) {
      throw new Error("返回数据不完整");
    }
    const result = await importAllData(record.snapshot, { clearExisting: false, preservePdf: true });
    loadApiCfgToUI();
    refreshSavedPages();
    refreshExamHistory();
    const nextPage = result.pages?.[0] ?? null;
    const nextState = nextPage ? { page: nextPage } : { page: null, search: "" };
    const normalized = normalizeState(nextState);
    setViewState(normalized, { replace: true });
    applyStateToUI(normalized);
    const detail = result.pages?.length ? `共同步 ${result.pages.length} 个页码` : "同步完成";
    setSyncStatus(detail, 5000);
  } catch (err) {
    console.error(err);
    setSyncStatus(err.message || "同步失败");
  }
}

function applyStateToUI(state) {
  if (state.search) {
    executeSearch(state.search, { updateHistory: false });
    return;
  }
  if (state.page) {
    if (!loadPageByNumber(state.page, { updateHistory: false })) {
      renderTable([]);
      $("#wordSectionTitle").textContent = "本页词汇";
      hidePdfPreview();
      lastPdfPreviewPage = null;
    }
    return;
  }

  renderTable([]);
  $("#wordSectionTitle").textContent = "本页词汇";
  $("#savedPages").value = "";
  $("#searchInput").value = "";
  hidePdfPreview();
  lastPdfPreviewPage = null;
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
    showPdfPreview(result.page);
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
  loadPageByNumber(page);
}

function onDeletePage() {
  const sel = $("#savedPages");
  const page = Number(sel.value);
  if (!page) return;
  if (confirm(`确认删除页 ${page} 的数据？`)) {
    deletePage(page);
    refreshSavedPages();
    $("#wordTable tbody").innerHTML = "";
    hidePdfPreview();
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
    showPdfPreview(finalPage);
    toastStatus(status, `解析成功，已保存页 ${finalPage}（${items.length} 条）`);
  } catch (e) {
    console.error(e);
    toastStatus(status, "JSON解析失败：" + e.message);
  }
}

function setBackupStatus(text, timeout = 0) {
  const status = $("#backupStatus");
  if (!status) return;
  status.textContent = text;
  if (timeout > 0) {
    setTimeout(() => {
      if (status.textContent === text) {
        status.textContent = "";
      }
    }, timeout);
  }
}

async function onExportBackup() {
  setBackupStatus("正在导出…");
  try {
    const snapshot = await exportAllData();
    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `jp_vocab_backup_${timestamp}.json`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setBackupStatus("导出成功，备份文件已下载。", 4000);
  } catch (err) {
    console.error("导出数据失败", err);
    setBackupStatus(`导出失败：${err.message || err}`, 6000);
  }
}

function onTriggerImportBackup(event) {
  if (event) event.preventDefault();
  const input = $("#importBackupInput");
  if (input) {
    input.click();
  }
}

async function onImportBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    setBackupStatus(`正在读取 ${file.name}…`);
    const content = await file.text();
    let snapshot;
    try {
      snapshot = JSON.parse(content);
    } catch (err) {
      throw new Error("备份文件不是有效的 JSON");
    }
    if (!confirm(`导入备份会覆盖当前浏览器中的词汇、测验记录与 PDF 缓存。\n\n是否继续导入文件 “${file.name}”？`)) {
      setBackupStatus("已取消导入。", 3000);
      return;
    }
    setBackupStatus("正在导入数据…");
    const result = await importAllData(snapshot, { clearExisting: false });
    loadApiCfgToUI();
    refreshSavedPages();
    refreshExamHistory();
    resetPdfState();
    await loadPersistedPdf();
    const nextPage = result.pages?.[0] ?? null;
    const nextState = nextPage ? { page: nextPage } : { page: null, search: "" };
    const normalized = normalizeState(nextState);
    setViewState(normalized, { replace: true });
    applyStateToUI(normalized);
    const detail = result.pages?.length ? `共导入 ${result.pages.length} 个页码${result.hasPdf ? "，含 PDF 缓存" : ""}` : (result.hasPdf ? "仅导入了 PDF 缓存" : "备份为空");
    setBackupStatus(`导入成功：${detail}。`, 5000);
  } catch (err) {
    console.error("导入数据失败", err);
    setBackupStatus(`导入失败：${err.message || err}`, 7000);
  } finally {
    event.target.value = "";
  }
}

function onSearch() {
  executeSearch($("#searchInput").value);
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
  const pdfInput = $("#pdfFileInput");
  if (pdfInput) pdfInput.addEventListener("change", onPdfFileSelected);
  const exportBtn = $("#btnExportData");
  if (exportBtn) exportBtn.addEventListener("click", onExportBackup);
  const importBtn = $("#btnImportData");
  if (importBtn) importBtn.addEventListener("click", onTriggerImportBackup);
  const importInput = $("#importBackupInput");
  if (importInput) importInput.addEventListener("change", onImportBackup);
  const loginBtn = $("#btnLogin");
  if (loginBtn) loginBtn.addEventListener("click", onLogin);
  const registerBtn = $("#btnRegister");
  if (registerBtn) registerBtn.addEventListener("click", onRegister);
  const logoutBtn = $("#btnLogout");
  if (logoutBtn) logoutBtn.addEventListener("click", onLogout);
  const syncPushBtn = $("#btnSyncPush");
  if (syncPushBtn) syncPushBtn.addEventListener("click", syncToServer);
  const syncPullBtn = $("#btnSyncPull");
  if (syncPullBtn) syncPullBtn.addEventListener("click", syncFromServer);
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
  if (modalElement && modalContent) {
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
  
  // Search
  $("#btnSearch").addEventListener("click", onSearch);
  $("#searchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") onSearch();
  });

  // Quiz Buttons
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
  const wordTable = $("#wordTable");
  if (wordTable) {
    wordTable.addEventListener("click", onWordTableClick);
  }
}

window.addEventListener("popstate", (event) => {
  const state = normalizeState(event.state ?? parseStateFromLocation());
  currentState = state;
  applyStateToUI(state);
});

document.addEventListener("DOMContentLoaded", async () => {
  bindUI();
  readAuthFromStorage();
  loadApiCfgToUI();
  refreshSavedPages();
  refreshExamHistory();
  await loadPersistedPdf();
  const initialState = parseStateFromLocation();
  currentState = initialState;
  history.replaceState(initialState, "", buildURLFromState(initialState));
  applyStateToUI(initialState);
});
