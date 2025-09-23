// js/extract.js
// 使用千问提取：严格只抽取图片中出现的词条（主词+关联/同音/反义）
import { QwenClient } from "./api.js";

export async function extractWordsFromImage(client, pageNumber, imageDataURL) {
  const schemaTip = `
输出严格 JSON（不要多余文本）：
{
  "page": %d,
  "items": [
    {
      "jp": "日文原词，按书上写法（可能是汉字或假名，严格还原）",
      "reading": "假名读音；若 jp 已为假名则留空字符串",
      "pos": "词性，如 名/动/形/副/连体/感/助/助动 等；如果书上有①②小序号可带上",
      "cn": "中文释义（按照书上表述，简要即可）",
      "tag": "普通|关联|同音|反义" 
    }
  ]
}
  `.trim().replace("%d", String(pageNumber));

  const messages = [
    { role: "system", content: [{ type: "text", text: "You are a strict JSON extractor. Output ONLY compact valid JSON (UTF-8, no markdown)." }]},
    { role: "user", content: [
        { type: "text", text: `你是一名 OCR+NLP 助手。根据提供的词汇书页面图片，**只**抽取书上真实出现的词条：包括主词条以及“关联”“同音”“反义（标记为‘对’）”等派生项。不要臆想，不要补充书上没有的词。为每个条目补充词性（如果能从版式或标注判断）。${schemaTip}` },
        { type: "image_url", image_url: { url: imageDataURL } }
      ]}
  ];

  const raw = await client.chat(messages, { temperature: 0.0, response_format: { type: "json_object" } });
  // 解析 JSON
  let data;
  try { data = JSON.parse(raw); }
  catch (e) {
    // 尝试去掉代码围栏
    const cleaned = raw.replace(/^```json|```$/g, "").trim();
    data = JSON.parse(cleaned);
  }

  if (!data || !Array.isArray(data.items)) {
    throw new Error("模型未返回 items 列表。原始内容：" + String(raw).slice(0, 400));
  }

  // 清洗
  const items = data.items.map((it, i) => ({
    id: i + 1,
    jp: (it.jp || "").trim(),
    reading: (it.reading || "").trim(),
    pos: (it.pos || "").trim(),
    cn: (it.cn || "").trim(),
    tag: (it.tag || "普通").trim()
  })).filter(x => x.jp && x.cn);

  return items;
}
