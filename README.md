# 日语红蓝宝书 · 千问提取+测验

> 纯前端（浏览器）运行：上传某页照片 → 调用千问（Qwen）图文模型 → 提取“该页出现的词条/关联/同音/反义” → 本地保存（localStorage） → 三种测验模式。

## 结构
- `index.html` — 主页面
- `css/styles.css` — UI 样式
- `js/api.js` — 千问 OpenAI 兼容接口封装（浏览器 `fetch` 直连）。
- `js/storage.js` — 本地存储（localStorage）。
- `js/extract.js` — 从图片调用千问进行结构化抽取（严格 JSON）。
- `js/quiz.js` — 三种测验：
  1. 顺序：问中文→答日文（附词性）
  2. 乱序：问中文→答日文（附词性）
  3. 乱序：问日文→答中文（调用千问做“模糊判定”）
- `js/util.js` — 工具函数。
- `js/app.js` — 事件绑定与页面逻辑。

## 使用
1. 打开 `index.html`。
2. 配置 API Base（默认 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`）、模型（建议 `qwen-vl-max` 或支持图像的 Qwen 模型）、API Key（可勾选记住）。
3. 选择页码 + 上传对应图片（整页清晰）。点“从图片用千问提取词汇并保存”。
4. 下方表格显示抽取结果，并自动以“页码→词条数组”的形式保存到 localStorage。
5. 右侧可选择已保存页码并载入。
6. 在“测验”区域选择模式即可开始。

## 安全提示
- 该示例**直接在浏览器中持有 API Key**，仅供个人本地使用，**不要**部署到公网。生产建议：将 API 调用放到你自己的后端，前端不接触密钥。

## 自定义
- 抽取提示词在 `js/extract.js`，可根据你的书籍版式细调。
- 判题提示词在 `js/app.js` 的 `judgeFuzzy`。

祝使用愉快！
