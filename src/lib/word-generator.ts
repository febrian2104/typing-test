export function buildWordQueue(
  wordBank: readonly string[],
  size: number,
): string[] {
  const fallbackWords = ["kata", "cepat", "tepat", "latih"];
  const source = wordBank.length > 0 ? wordBank : fallbackWords;

  return Array.from({ length: size }, () => {
    const index = Math.floor(Math.random() * source.length);
    return source[index];
  });
}
