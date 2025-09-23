// js/quiz.js
import { shuffle } from "./util.js";

export class QuizEngine {
  constructor(items, mode, { judgeFuzzy } = {}) {
    this.items = items.slice();
    this.mode = mode; // "CN_JP_SEQ" | "CN_JP_SHUFFLE" | "JP_CN_FUZZY_SHUFFLE"
    this.index = 0;
    this.correct = 0;
    this.total = this.items.length;
    this.judgeFuzzy = judgeFuzzy;
    if (mode === "CN_JP_SHUFFLE" || mode === "JP_CN_FUZZY_SHUFFLE") {
      this.items = shuffle(this.items);
    }
  }

  currentQuestion() {
    const it = this.items[this.index];
    if (!it) return null;
    if (this.mode === "JP_CN_FUZZY_SHUFFLE") {
      return { text: `【日文】${it.jp}　（词性：${it.pos || "—"}）`, hint: it.reading ? `读音：${it.reading}` : "" };
    } else {
      return { text: `【中文释义】${it.cn}　（词性：${it.pos || "—"}）`, hint: it.tag ? `标签：${it.tag}` : "" };
    }
  }

  async answer(ans) {
    const it = this.items[this.index];
    if (!it) return { done: true };

    let ok = false, reason = "";
    if (this.mode === "JP_CN_FUZZY_SHUFFLE") {
      // 模糊判定：给出中文是否大致正确
      const res = await this.judgeFuzzy(it.cn, ans);
      ok = !!res.correct;
      reason = res.reason || "";
    } else {
      // 严格（但做些规范化）：期望输入日文
      const norm = s => (s || "").replace(/\s+/g, "").replace(/[\u3000]/g, "").trim();
      ok = norm(ans) === norm(it.jp);
      reason = ok ? "" : `标准答案：${it.jp}` + (it.reading ? `（${it.reading}）` : "");
    }

    if (ok) this.correct += 1;
    const cur = this.index + 1;
    this.index += 1;
    return {
      ok, reason,
      progress: { cur, total: this.total },
      done: this.index >= this.total
    };
  }
}
