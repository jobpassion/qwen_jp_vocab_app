// js/extract.js
// 使用千问提取：严格只抽取图片中出现的词条（主词+关联/同音/反义/同类），并补充标准音调型
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
      "pos": "词性，如 名/动/形/副/连体/感/助/助动 等（忽略书中带圈数字的读音标注）",
      "cn": "中文释义（按照书上表述，简要即可）",
      "tag": "普通|关联|同音|反义",
      "accent": ["0","1","2"]  // 标准东京音调型；若有多种请全部给出
    }
  ]
}
  `.trim().replace("%d", String(pageNumber));

  const messages = [
    {
      role: "system",
      content: [
        {
          type: "text",
          text:
              "You are a strict JSON extractor. Output ONLY compact valid JSON (UTF-8, no markdown, no comments)."
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `
你是一名 OCR+NLP 助手。
根据词汇书页面图片，抽取“单词条目”。
【包含】
- 主词条, 也就是单词前标正方框的
- 明确标记的 关联词 / 同音词 / 反义词（带“对”）/ 同类词(带"类")
- 每个单词词性（如果能从版式或标注判断）, 请忽略书中词性前面的带圈数字是日语读音高低标注
- 请你根据该单词补充标准音调型. 多个的就返回多个

【必须排除】
- 不带词性的

${schemaTip}
`
        },
        { type: "image_url", image_url: { url: imageDataURL } }
      ]
    }
  ];

  const raw = await client.chat(messages, {
    temperature: 0.0,
    response_format: { type: "json_object" }
  });

  // 解析 JSON
  let data;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    // 尝试去掉代码围栏
    const cleaned = String(raw).replace(/^\s*```json\s*|\s*```\s*$/g, "").trim();
    data = JSON.parse(cleaned);
  }

  if (!data || !Array.isArray(data.items)) {
    throw new Error("模型未返回 items 列表。原始内容：" + String(raw).slice(0, 400));
  }

  // 归一化 accent 字段为字符串数组
  const normalizeAccent = (acc) => {
    if (acc == null) return [];
    if (Array.isArray(acc)) return acc.map(String).map(s => s.trim()).filter(Boolean);
    if (typeof acc === "number") return [String(acc)];
    if (typeof acc === "string") {
      return acc
          .split(/[,，\/\s]+/)
          .map(s => s.trim())
          .filter(Boolean);
    }
    return [];
  };

  // 清洗：必须包含 jp/pos/cn，reading 可空；tag 默认“普通”；accent 标准化为数组
  const items = data.items
      .map((it, i) => ({
        id: i + 1,
        jp: (it.jp || "").trim(),
        reading: (it.reading || "").trim(),
        pos: normalizeAccent(it.accent) + " " + (it.pos || "").trim(),
        cn: (it.cn || "").trim(),
        tag: (it.tag || "普通").trim(),
        accent: normalizeAccent(it.accent)
      }))
      .filter((x) => x.jp && x.pos && x.cn);

  return items;
}
