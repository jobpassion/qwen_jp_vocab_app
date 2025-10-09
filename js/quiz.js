// js/quiz.js
import { shuffle } from "./util.js";

export class QuizEngine {
  constructor(items, mode, { judgeFuzzy, judgeFuzzyBatch } = {}) {
    this.items = items.slice();
    this.mode = mode; // "CN_JP_SEQ" | "CN_JP_SHUFFLE" | "JP_READING_SHUFFLE" | "JP_CN_FUZZY_SHUFFLE"
    this.index = 0;
    this.correct = 0;
    this.total = this.items.length;

    this.judgeFuzzy = judgeFuzzy;
    this.judgeFuzzyBatch = judgeFuzzyBatch;
    this.userAnswers = new Array(this.items.length).fill(null);

    if (mode === "CN_JP_SHUFFLE" || mode === "JP_READING_SHUFFLE" || mode === "JP_CN_FUZZY_SHUFFLE") {
      this.items = shuffle(this.items);
    }
  }

  currentQuestion() {
    const it = this.items[this.index];
    if (!it) return null;
    if (this.mode === "JP_CN_FUZZY_SHUFFLE") {
      return { text: `【日文】${it.jp}　（词性：${it.pos || "—"}）`, hint: it.reading ? `读音：${it.reading}` : "" };
    } else if (this.mode === "JP_READING_SHUFFLE") {
      return { text: `【日文】${it.jp}　（词性：${it.pos || "—"}）`, hint: "请输入假名读音" };
    } else {
      return { text: `【中文释义】${it.cn}　（词性：${it.pos || "—"}）`, hint: it.tag ? `标签：${it.tag}` : "" };
    }
  }

  async answer(ans) {
    const it = this.items[this.index];
    if (!it) return { done: true };

    if (this.mode === "JP_CN_FUZZY_SHUFFLE") {
      this.userAnswers[this.index] = ans; // ans can be a real answer or "__SKIPPED__"
      this.index += 1;
      return {
        ok: 'pending',
        reason: "答案已记录",
        progress: { cur: this.index, total: this.total },
        done: this.index >= this.total
      };
    }

    let ok = false, reason = "";
    if (this.mode === "JP_READING_SHUFFLE") {
      const norm = s => (s || "").replace(/\s+/g, "").replace(/[\u3000]/g, "").trim();
      const expectedReading = it.reading || it.jp;
      ok = norm(ans) === norm(expectedReading);
      reason = ok ? "回答正确！" : `标准读音：${expectedReading}`;
    } else { // CN_JP_SEQ and CN_JP_SHUFFLE
      const norm = s => (s || "").replace(/\s+/g, "").replace(/[\u3000]/g, "").trim();
      ok = norm(ans) === norm(it.jp);
      reason = ok ? "回答正确！" : `标准答案：${it.jp}` + (it.reading ? `（${it.reading}）` : "");
    }

    if (ok) this.correct += 1;
    this.index += 1;
    return {
      ok, reason,
      progress: { cur: this.index, total: this.total },
      done: this.index >= this.total
    };
  }

  async gradeFuzzyAnswers() {
    if (this.mode !== "JP_CN_FUZZY_SHUFFLE" || !this.judgeFuzzyBatch) {
        throw new Error("Batch grading is not available for this mode or is not configured.");
    }

    const pairsToGrade = [];
    const originalIndices = [];
    this.items.forEach((item, i) => {
      const userAnswer = this.userAnswers[i];
      // Only grade questions that have been answered and were not skipped.
      if (userAnswer !== null && userAnswer !== "__SKIPPED__") {
        pairsToGrade.push({
          goldCN: item.cn,
          userCN: userAnswer || ""
        });
        originalIndices.push(i);
      }
    });

    if (pairsToGrade.length === 0) {
      console.log("No answers to grade.");
      return [];
    }

    console.log(`Grading ${pairsToGrade.length} answers in a batch...`);
    const batchResults = await this.judgeFuzzyBatch(pairsToGrade);

    if (batchResults.length !== pairsToGrade.length) {
        throw new Error(`Batch validation returned ${batchResults.length} results, but ${pairsToGrade.length} were expected.`);
    }

    this.correct = 0;
    const finalResults = new Array(this.total).fill(null);

    batchResults.forEach((res, i) => {
      const originalIndex = originalIndices[i];
      const ok = !!res.correct;
      if (ok) {
        this.correct++;
      }

      let reason = res.reason || "";
      if (!ok) {
        reason = `标准答案：${this.items[originalIndex].cn}` + (reason ? `（${reason}）` : "");
      } else if (!reason) {
        reason = "回答正确！";
      }
      finalResults[originalIndex] = { ok, reason };
    });

    console.log("Grading complete. Final score:", this.correct);
    return finalResults;
  }
}
