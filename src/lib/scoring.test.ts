import { describe, expect, it } from "vitest";
import { scoreTypingAttempt } from "./scoring";

describe("scoreTypingAttempt", () => {
  it("menghitung KPM dari kata benar", () => {
    const score = scoreTypingAttempt({
      targetWords: ["aku", "suka", "belajar", "cepat"],
      typedWords: ["aku", "suka", "belajar"],
      durationSeconds: 30,
    });

    expect(score.kpm).toBe(6);
    expect(score.rawKpm).toBe(6);
    expect(score.correctWords).toBe(3);
    expect(score.accuracy).toBe(100);
  });

  it("memisahkan kata salah dari raw KPM", () => {
    const score = scoreTypingAttempt({
      targetWords: ["aku", "suka", "belajar", "cepat"],
      typedWords: ["aku", "suka", "salah", "cepat"],
      durationSeconds: 60,
    });

    expect(score.kpm).toBe(3);
    expect(score.rawKpm).toBe(4);
    expect(score.wrongWords).toBe(1);
    expect(score.accuracy).toBe(75);
  });

  it("aman saat belum ada kata yang diketik", () => {
    const score = scoreTypingAttempt({
      targetWords: ["aku", "suka"],
      typedWords: [],
      durationSeconds: 0,
    });

    expect(score.kpm).toBe(0);
    expect(score.rawKpm).toBe(0);
    expect(score.accuracy).toBe(0);
  });
});
