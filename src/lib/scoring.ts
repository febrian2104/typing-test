export type ScoreTypingAttemptInput = {
  targetWords: readonly string[];
  typedWords: readonly string[];
  durationSeconds: number;
};

export type TypingScore = {
  attemptedWords: number;
  correctCharacters: number;
  correctWords: number;
  typedCharacters: number;
  wrongWords: number;
  rawWpm: number;
  wpm: number;
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
  const typedCharacters = normalizedTypedWords.join(" ").length;
  const correctCharacters = normalizedTypedWords.reduce(
    (totalCharacters, typedWord, index) => {
      if (typedWord !== targetWords[index]) {
        return totalCharacters;
      }

      const separatorCharacter = index < normalizedTypedWords.length - 1 ? 1 : 0;

      return totalCharacters + typedWord.length + separatorCharacter;
    },
    0,
  );
  const durationMinutes = Math.max(durationSeconds, 1) / 60;

  return {
    attemptedWords,
    correctCharacters,
    correctWords,
    typedCharacters,
    wrongWords,
    rawWpm: Math.round(typedCharacters / 5 / durationMinutes),
    wpm: Math.round(correctCharacters / 5 / durationMinutes),
    accuracy:
      typedCharacters === 0
        ? 0
        : Math.round((correctCharacters / typedCharacters) * 100),
  };
}
