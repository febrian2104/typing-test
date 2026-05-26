export type ScoreTypingAttemptInput = {
  targetWords: readonly string[];
  typedWords: readonly string[];
  durationSeconds: number;
};

export type TypingScore = {
  attemptedWords: number;
  correctWords: number;
  wrongWords: number;
  kpm: number;
  rawKpm: number;
  accuracy: number;
};

export function scoreTypingAttempt({
  targetWords,
  typedWords,
  durationSeconds,
}: ScoreTypingAttemptInput): TypingScore {
  const normalizedTypedWords = typedWords
    .map((word) => word.trim())
    .filter(Boolean);
  const attemptedWords = normalizedTypedWords.length;
  const correctWords = normalizedTypedWords.filter(
    (word, index) => word === targetWords[index],
  ).length;
  const wrongWords = attemptedWords - correctWords;
  const durationMinutes = Math.max(durationSeconds, 1) / 60;

  return {
    attemptedWords,
    correctWords,
    wrongWords,
    kpm: Math.round(correctWords / durationMinutes),
    rawKpm: Math.round(attemptedWords / durationMinutes),
    accuracy:
      attemptedWords === 0
        ? 0
        : Math.round((correctWords / attemptedWords) * 100),
  };
}
