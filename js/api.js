// js/api.js
export class QwenClient {
  constructor({ apiBase, apiKey, model }) {
    this.apiBase = apiBase || "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
    this.apiKey = apiKey || "";
    this.model = model || "qwen-vl-max-latest"; // 支持图像理解
  }
  setConfig({ apiBase, apiKey, model }) {
    if (apiBase) this.apiBase = apiBase;
    if (apiKey !== undefined) this.apiKey = apiKey;
    if (model) this.model = model;
  }

  async chat(messages, { temperature = 0.2, response_format = { type: "json_object" } } = {}) {
    const body = JSON.stringify({ model: this.model, messages, temperature, response_format });
    const res = await fetch(this.apiBase, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`
      },
      body
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Qwen API error ${res.status}: ${text}`);
    }
    const json = await res.json();
    // OpenAI-compatible: json.choices[0].message.content
    const content = json?.choices?.[0]?.message?.content;
    return content;
  }
}

export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
