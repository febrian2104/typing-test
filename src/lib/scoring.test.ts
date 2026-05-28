import { describe, expect, it } from "vitest";
import { scoreTypingAttempt } from "./scoring";

describe("scoreTypingAttempt", () => {
  it("menghitung WPM dari karakter benar per 5 karakter", () => {
    const score = scoreTypingAttempt({
      targetWords: ["internasional", "bahasa"],
      typedWords: ["internasional", "bahasa"],
      durationSeconds: 60,
    });

    expect(score.wpm).toBe(4);
    expect(score.rawWpm).toBe(4);
    expect(score.correctCharacters).toBe(20);
    expect(score.typedCharacters).toBe(20);
    expect(score.correctWords).toBe(2);
    expect(score.accuracy).toBe(100);
  });

  it("memisahkan karakter kata salah dari raw WPM", () => {
    const score = scoreTypingAttempt({
      targetWords: ["aku", "suka", "belajar", "cepat"],
      typedWords: ["aku", "suka", "salah", "cepat"],
      durationSeconds: 60,
    });

    expect(score.wpm).toBe(3);
    expect(score.rawWpm).toBe(4);
    expect(score.correctCharacters).toBe(14);
    expect(score.typedCharacters).toBe(20);
    expect(score.wrongWords).toBe(1);
    expect(score.accuracy).toBe(70);
  });

  it("aman saat belum ada kata yang diketik", () => {
    const score = scoreTypingAttempt({
      targetWords: ["aku", "suka"],
      typedWords: [],
      durationSeconds: 0,
    });

    expect(score.wpm).toBe(0);
    expect(score.rawWpm).toBe(0);
    expect(score.accuracy).toBe(0);
  });
});
