"use client";

import { Moon, RotateCcw, Sun } from "lucide-react";
import Link from "next/link";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { scoreTypingAttempt, type TypingScore } from "@/lib/scoring";
import { buildStableWordQueue, buildWordQueue } from "@/lib/word-generator";

const DURATION_OPTIONS = [
  { label: "1 menit", seconds: 60 },
  { label: "3 menit", seconds: 180 },
  { label: "5 menit", seconds: 300 },
] as const;
const WORD_BATCH_SIZE = 140;
const WORD_BUFFER_THRESHOLD = 36;
const VISIBLE_WORD_COUNT = 72;
const LINE_TOP_TOLERANCE = 6;
const CHART_WIDTH = 1000;
const CHART_HEIGHT = 280;
const CHART_PADDING = {
  bottom: 52,
  left: 66,
  right: 18,
  top: 28,
} as const;

type TestStatus = "idle" | "running" | "finished";
type DurationSeconds = (typeof DURATION_OPTIONS)[number]["seconds"];
type ThemeMode = "light" | "dark";
const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

export type TypingLanguage = {
  id: string;
  label: string;
  nativeLabel: string;
  words: readonly string[];
};

type TypingTestProps = {
  defaultLanguageId?: string;
  languages: readonly TypingLanguage[];
};

type TypingStatsSample = {
  accuracy: number;
  errors: number;
  wpm: number;
  modifications: number;
  second: number;
};
type ChartMetric = "error" | "wpm" | "modification";

function subscribeSystemTheme(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);

  mediaQuery.addEventListener("change", onStoreChange);

  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getSystemThemeSnapshot(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? "dark" : "light";
}

function getServerThemeSnapshot(): ThemeMode {
  return "light";
}

function getTimestamp() {
  return Date.now();
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatChartTime(totalSeconds: number) {
  if (totalSeconds < 60) {
    return `${totalSeconds} detik`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (seconds === 0) {
    return `${minutes} menit`;
  }

  return `${minutes} menit ${seconds} detik`;
}

function hasTypingError(targetWord: string, typedWord: string) {
  return Array.from(typedWord).some(
    (typedCharacter, index) => typedCharacter !== targetWord[index],
  );
}

function countNewTypingErrors(
  targetWord: string,
  previousInput: string,
  nextInput: string,
) {
  if (nextInput.length <= previousInput.length) {
    return 0;
  }

  return Array.from(nextInput.slice(previousInput.length)).filter(
    (character, index) =>
      character !== targetWord[previousInput.length + index],
  ).length;
}

function upsertStatsSample(
  samples: TypingStatsSample[],
  nextSample: TypingStatsSample,
) {
  const lastSample = samples.at(-1);

  if (lastSample?.second === nextSample.second) {
    if (
      lastSample.accuracy === nextSample.accuracy &&
      lastSample.errors === nextSample.errors &&
      lastSample.wpm === nextSample.wpm &&
      lastSample.modifications === nextSample.modifications
    ) {
      return samples;
    }

    return [...samples.slice(0, -1), nextSample];
  }

  return [...samples, nextSample];
}

function getChartX(second: number, duration: number) {
  const chartWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;

  return CHART_PADDING.left + (second / Math.max(duration, 1)) * chartWidth;
}

function getChartY(value: number, maxValue: number) {
  const chartHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

  return (
    CHART_PADDING.top +
    chartHeight -
    (value / Math.max(maxValue, 1)) * chartHeight
  );
}

function getLinePath(
  samples: readonly TypingStatsSample[],
  duration: number,
  maxValue: number,
) {
  return samples
    .map((sample, index) => {
      const command = index === 0 ? "M" : "L";

      return `${command} ${getChartX(sample.second, duration).toFixed(2)} ${getChartY(sample.wpm, maxValue).toFixed(2)}`;
    })
    .join(" ");
}

export function TypingTest({
  defaultLanguageId,
  languages,
}: TypingTestProps) {
  const fallbackLanguage = languages[0];
  const initialLanguageId = defaultLanguageId ?? fallbackLanguage?.id ?? "id";
  const initialWordBank =
    languages.find((language) => language.id === initialLanguageId)?.words ??
    fallbackLanguage?.words ??
    [];
  const [duration, setDuration] = useState<DurationSeconds>(60);
  const [activeLanguageId, setActiveLanguageId] = useState(initialLanguageId);
  const [wordQueue, setWordQueue] = useState<string[]>(() =>
    buildStableWordQueue(initialWordBank, WORD_BATCH_SIZE, initialLanguageId),
  );
  const [submittedWords, setSubmittedWords] = useState<string[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [status, setStatus] = useState<TestStatus>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [themeMode, setThemeMode] = useState<ThemeMode | null>(null);
  const [visibleStart, setVisibleStart] = useState(0);
  const [typingErrors, setTypingErrors] = useState(0);
  const [typingModifications, setTypingModifications] = useState(0);
  const [statsSamples, setStatsSamples] = useState<TypingStatsSample[]>([]);
  const [needsTypingFocus, setNeedsTypingFocus] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wordRefs = useRef(new Map<number, HTMLSpanElement>());
  const hasLeftPageRef = useRef(false);
  const systemThemeMode = useSyncExternalStore(
    subscribeSystemTheme,
    getSystemThemeSnapshot,
    getServerThemeSnapshot,
  );

  const elapsedSeconds =
    startedAt === null
      ? 0
      : Math.min(duration, Math.max(0, (now - startedAt) / 1000));
  const remainingSeconds =
    status === "finished" ? 0 : Math.max(0, Math.ceil(duration - elapsedSeconds));
  const currentWordIndex = submittedWords.length;
  const activeLanguage =
    languages.find((language) => language.id === activeLanguageId) ??
    fallbackLanguage;
  const wordBank = activeLanguage?.words ?? [];
  const attemptedWords = useMemo(() => {
    const activeWord = currentInput.trim();
    return activeWord ? [...submittedWords, activeWord] : submittedWords;
  }, [currentInput, submittedWords]);
  const scoreDuration =
    status === "finished" ? duration : Math.max(1, Math.floor(elapsedSeconds));
  const score = scoreTypingAttempt({
    targetWords: wordQueue,
    typedWords: attemptedWords,
    durationSeconds: scoreDuration,
  });
  const sampleSecond =
    status === "finished"
      ? duration
      : Math.min(duration, Math.floor(elapsedSeconds));
  const resultSamples =
    statsSamples.length > 0
      ? statsSamples
      : [
          {
            accuracy: score.accuracy,
            errors: typingErrors,
            wpm: score.wpm,
            modifications: typingModifications,
            second: duration,
          },
        ];
  const visibleWords = wordQueue.slice(
    visibleStart,
    visibleStart + VISIBLE_WORD_COUNT,
  );
  const activeThemeMode = themeMode ?? systemThemeMode;
  const isDarkMode = activeThemeMode === "dark";
  const theme = isDarkMode
    ? {
        page: "bg-[#100f18] text-violet-50",
        headerBorder: "border-purple-400/30",
        languageText: "text-violet-50",
        languageMuted: "text-cyan-100/55",
        toolbarText: "text-violet-50",
        activeButton:
          "bg-purple-500 text-white shadow-sm ring-1 ring-purple-300/70",
        inactiveButton: "text-violet-50/75 hover:bg-purple-400/15 hover:text-white",
        iconButton: "text-violet-50/80 hover:bg-purple-400/15 hover:text-white",
        timer: "text-purple-200",
        wordArea: "text-violet-100/45",
        wordTyped: "text-violet-50",
        wordPending: "text-violet-100/45",
        wrongText: "text-rose-300",
        activeWrong: "text-violet-50",
        activeWord: "text-violet-50",
        currentLetter: "text-white before:bg-purple-500/45",
        extraWrong: "bg-orange-400",
        cursor: "bg-purple-300",
        resultBorder: "border-purple-400/30",
        resultGrid: "text-violet-50/65",
        footerBorder: "border-purple-400/20",
        footerText: "text-violet-100/55",
        footerLink:
          "text-purple-200 underline-offset-4 hover:text-purple-100 hover:underline focus:outline-none focus:ring-2 focus:ring-purple-400/70",
        focusOverlay: "bg-[#100f18]/70 text-violet-50",
        focusPrompt:
          "bg-purple-500/15 text-purple-100 shadow-purple-950/20 hover:bg-purple-500/25",
        brandText: "text-purple-300",
        brandBadge: "text-white shadow-sm shadow-purple-950/20",
        brandMuted: "text-violet-100/55",
      }
    : {
        page: "bg-[#eefaff] text-slate-950",
        headerBorder: "border-purple-300/70",
        languageText: "text-slate-800",
        languageMuted: "text-purple-500",
        toolbarText: "text-slate-800",
        activeButton:
          "bg-purple-600 text-white shadow-sm ring-1 ring-purple-300",
        inactiveButton: "text-slate-700 hover:bg-purple-100/70 hover:text-purple-900",
        iconButton: "text-slate-700 hover:bg-purple-100/70 hover:text-purple-900",
        timer: "text-purple-700",
        wordArea: "text-slate-500",
        wordTyped: "text-slate-950",
        wordPending: "text-slate-500",
        wrongText: "text-rose-600",
        activeWrong: "text-slate-950",
        activeWord: "text-slate-950",
        currentLetter: "text-slate-950 before:bg-purple-200",
        extraWrong: "bg-orange-500",
        cursor: "bg-purple-700",
        resultBorder: "border-purple-300/70",
        resultGrid: "text-slate-600",
        footerBorder: "border-purple-300/60",
        footerText: "text-slate-500",
        footerLink:
          "text-purple-700 underline-offset-4 hover:text-purple-900 hover:underline focus:outline-none focus:ring-2 focus:ring-purple-400/60",
        focusOverlay: "bg-[#eefaff]/75 text-slate-950",
        focusPrompt:
          "bg-white/80 text-purple-800 shadow-purple-100/80 hover:bg-purple-50",
        brandText: "text-purple-700",
        brandBadge: "bg-purple-600 text-white shadow-sm shadow-purple-300/40",
        brandMuted: "text-slate-500",
      };

  useEffect(() => {
    if (status !== "running" || startedAt === null) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const timestamp = getTimestamp();

      setNow(timestamp);

      if ((timestamp - startedAt) / 1000 >= duration) {
        hasLeftPageRef.current = false;
        setNeedsTypingFocus(false);
        setStatus("finished");
        window.clearInterval(intervalId);
      }
    }, 200);

    return () => window.clearInterval(intervalId);
  }, [duration, startedAt, status]);

  useEffect(() => {
    if (status === "idle") {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      setStatsSamples((samples) =>
        upsertStatsSample(samples, {
          accuracy: score.accuracy,
          errors: typingErrors,
          wpm: score.wpm,
          modifications: typingModifications,
          second: sampleSecond,
        }),
      );
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [
    sampleSecond,
    score.accuracy,
    score.wpm,
    status,
    typingErrors,
    typingModifications,
  ]);

  useEffect(() => {
    if (status === "finished") {
      hasLeftPageRef.current = false;
      return;
    }

    function markPageAsLeft() {
      hasLeftPageRef.current = true;
    }

    function requestFocusBeforeTyping() {
      if (
        document.visibilityState !== "hidden" &&
        hasLeftPageRef.current
      ) {
        setNeedsTypingFocus(true);
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        markPageAsLeft();
        return;
      }

      requestFocusBeforeTyping();
    }

    window.addEventListener("blur", markPageAsLeft);
    window.addEventListener("focus", requestFocusBeforeTyping);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("blur", markPageAsLeft);
      window.removeEventListener("focus", requestFocusBeforeTyping);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [status]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const activeElement = wordRefs.current.get(currentWordIndex);

      if (!activeElement) {
        return;
      }

      const visibleEntries = Array.from(wordRefs.current.entries())
        .filter(([wordIndex]) => wordIndex >= visibleStart)
        .sort(([firstIndex], [secondIndex]) => firstIndex - secondIndex);
      const firstElement = visibleEntries[0]?.[1];

      if (
        !firstElement ||
        Math.abs(activeElement.offsetTop - firstElement.offsetTop) <=
          LINE_TOP_TOLERANCE
      ) {
        return;
      }

      const nextVisibleStart = visibleEntries.find(
        ([, element]) =>
          Math.abs(element.offsetTop - activeElement.offsetTop) <=
          LINE_TOP_TOLERANCE,
      )?.[0];

      if (nextVisibleStart !== undefined && nextVisibleStart > visibleStart) {
        setVisibleStart(nextVisibleStart);
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [currentInput, currentWordIndex, visibleStart, wordQueue.length]);

  function focusInput() {
    if (status !== "finished" && !needsTypingFocus) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }

  function resumeTyping() {
    if (status !== "finished") {
      hasLeftPageRef.current = false;
      setNeedsTypingFocus(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  }

  function startTest() {
    const timestamp = getTimestamp();
    setStartedAt(timestamp);
    setNow(timestamp);
    setStatus("running");
  }

  function resetTest(nextDuration = duration, nextLanguageId = activeLanguageId) {
    const nextWordBank =
      languages.find((language) => language.id === nextLanguageId)?.words ??
      wordBank;

    setDuration(nextDuration);
    setActiveLanguageId(nextLanguageId);
    setWordQueue(buildWordQueue(nextWordBank, WORD_BATCH_SIZE));
    setSubmittedWords([]);
    setCurrentInput("");
    setStatus("idle");
    setStartedAt(null);
    setNow(getTimestamp());
    setVisibleStart(0);
    setTypingErrors(0);
    setTypingModifications(0);
    setStatsSamples([]);
    setNeedsTypingFocus(false);
    hasLeftPageRef.current = false;
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  function changeDuration(nextDuration: DurationSeconds) {
    setDuration(nextDuration);
    setSubmittedWords([]);
    setCurrentInput("");
    setStatus("idle");
    setStartedAt(null);
    setNow(getTimestamp());
    setVisibleStart(0);
    setTypingErrors(0);
    setTypingModifications(0);
    setStatsSamples([]);
    setNeedsTypingFocus(false);
    hasLeftPageRef.current = false;
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  function submitCurrentWord() {
    const word = currentInput.trim();

    if (!word || status === "finished" || needsTypingFocus) {
      return;
    }

    if (status === "idle") {
      startTest();
    }

    const nextWords = [...submittedWords, word];
    setSubmittedWords(nextWords);
    setCurrentInput("");

    if (wordQueue.length - nextWords.length < WORD_BUFFER_THRESHOLD) {
      setWordQueue((queue) => [
        ...queue,
        ...buildWordQueue(wordBank, WORD_BATCH_SIZE),
      ]);
    }
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (status === "finished" || needsTypingFocus) {
      return;
    }

    const nextValue = event.target.value.replace(/\s/g, "");
    const targetWord = wordQueue[currentWordIndex] ?? "";
    const newErrorCount = countNewTypingErrors(
      targetWord,
      currentInput,
      nextValue,
    );
    const isModification =
      nextValue.length < currentInput.length ||
      (nextValue.length === currentInput.length && nextValue !== currentInput);

    if (status === "idle" && nextValue.length > 0) {
      startTest();
    }

    if (newErrorCount > 0) {
      setTypingErrors((count) => count + newErrorCount);
    }

    if (isModification) {
      setTypingModifications((count) => count + 1);
    }

    setCurrentInput(nextValue);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (needsTypingFocus) {
      event.preventDefault();
      return;
    }

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      submitCurrentWord();
    }
  }

  function getWordClassName(index: number) {
    const absoluteIndex = visibleStart + index;
    const typedWord = submittedWords[absoluteIndex];
    const targetWord = wordQueue[absoluteIndex];
    const isActive = absoluteIndex === currentWordIndex;
    const isActiveWrong =
      isActive && currentInput.length > 0 && hasTypingError(targetWord, currentInput);
    const baseClass =
      "relative inline-flex min-w-0 items-baseline rounded-sm px-1 transition-colors duration-150";

    if (typedWord !== undefined) {
      return `${baseClass} ${theme.wordTyped}`;
    }

    if (isActiveWrong) {
      return `${baseClass} ${theme.activeWrong}`;
    }

    if (isActive) {
      return `${baseClass} ${theme.activeWord}`;
    }

    return `${baseClass} ${theme.wordPending}`;
  }

  function renderWord(word: string, index: number) {
    const absoluteIndex = visibleStart + index;
    const isActive = absoluteIndex === currentWordIndex;
    const submittedWord = submittedWords[absoluteIndex];
    const typedWord = submittedWord ?? (isActive ? currentInput : "");

    if (!isActive && !typedWord) {
      return word;
    }

    const wordCharacters = Array.from(word);

    return (
      <>
        {wordCharacters.map((character, characterIndex) => {
          const typedCharacter = typedWord[characterIndex];
          const isMissingCharacter =
            submittedWord !== undefined && typedCharacter === undefined;
          const isWrongCharacter =
            typedCharacter !== undefined && typedCharacter !== character;
          const isCurrentCharacter =
            isActive && typedWord.length === characterIndex;
          const characterClassName =
            isMissingCharacter || isWrongCharacter
              ? theme.wrongText
              : typedCharacter === character
                ? theme.wordTyped
                : theme.wordPending;

          return (
            <Fragment key={`${word}-${characterIndex}`}>
              <span
                className={
                  isCurrentCharacter
                    ? `relative isolate inline-block before:absolute before:-inset-x-0.5 before:inset-y-0 before:-z-10 ${theme.currentLetter}`
                    : `relative inline-block ${characterClassName}`
                }
              >
                {isCurrentCharacter ? (
                  <TypingCursor
                    className="-left-0.5"
                    colorClassName={theme.cursor}
                  />
                ) : null}
                {character}
              </span>
            </Fragment>
          );
        })}
        {typedWord.length > word.length ? (
          <span
            className={`ml-1 inline-block h-[0.75em] w-1 rounded-full align-baseline ${theme.extraWrong}`}
          />
        ) : null}
        {isActive && typedWord.length >= wordCharacters.length ? (
          <span className="relative inline-block h-[1em] w-0 align-baseline">
            <TypingCursor className="left-0" colorClassName={theme.cursor} />
          </span>
        ) : null}
      </>
    );
  }

  return (
    <section className={`min-h-screen px-4 py-10 transition-colors duration-300 sm:px-6 lg:px-8 ${theme.page}`}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <nav
          aria-label="Navigasi utama"
          className={`flex items-center justify-between border-b pb-5 transition-colors duration-300 ${theme.headerBorder}`}
        >
          <Link
            aria-label="WPM Lab"
            className="inline-flex items-center gap-2 rounded-sm focus:outline-none focus:ring-2 focus:ring-purple-400/70"
            href="/"
          >
            <span className={`text-2xl font-black uppercase tracking-normal ${theme.brandText}`}>
              WPM
            </span>
            <span className={`rounded-md px-2 py-1 text-2xl font-black uppercase tracking-normal ${theme.brandBadge}`}>
              Lab
            </span>
          </Link>
          <span className={`hidden text-sm font-medium sm:inline ${theme.brandMuted}`}>
            Typing speed test
          </span>
        </nav>

        <header className={`border-b pb-6 transition-colors duration-300 ${theme.headerBorder}`}>
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className={`inline-flex h-11 w-fit items-center gap-2 rounded-md px-1 text-sm font-medium ${theme.languageText}`}>
              <span>{activeLanguage?.nativeLabel ?? "Bahasa Indonesia"}</span>
              <span className={theme.languageMuted}>
                ({activeLanguage?.label ?? "indonesian"})
              </span>
            </div>

            <div className={`flex flex-wrap items-center gap-3 text-sm ${theme.toolbarText}`}>
              <div className="flex items-center gap-1">
                {languages.map((language) => (
                  <button
                    className={`h-9 rounded-md px-3 font-medium transition ${
                      activeLanguageId === language.id
                        ? theme.activeButton
                        : theme.inactiveButton
                    }`}
                    key={language.id}
                    onClick={() => resetTest(duration, language.id)}
                    type="button"
                  >
                    {language.id.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1">
                {DURATION_OPTIONS.map((option) => (
                  <button
                    className={`h-9 rounded-md px-3 font-medium transition ${
                      duration === option.seconds
                        ? theme.activeButton
                        : theme.inactiveButton
                    }`}
                    key={option.seconds}
                    onClick={() => changeDuration(option.seconds)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <span className={`w-14 text-center font-medium tabular-nums ${theme.timer}`}>
                {formatTime(remainingSeconds)}
              </span>

              <button
                aria-label={isDarkMode ? "Aktifkan mode terang" : "Aktifkan mode gelap"}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-md transition ${theme.iconButton}`}
                onClick={() => setThemeMode(isDarkMode ? "light" : "dark")}
                title={isDarkMode ? "Mode terang" : "Mode gelap"}
                type="button"
              >
                {isDarkMode ? (
                  <Sun aria-hidden="true" size={18} />
                ) : (
                  <Moon aria-hidden="true" size={18} />
                )}
              </button>

              <button
                aria-label="Ulang test"
                className={`inline-flex h-9 w-9 items-center justify-center rounded-md transition ${theme.iconButton}`}
                onClick={() => resetTest()}
                title="Ulang test"
                type="button"
              >
                <RotateCcw aria-hidden="true" size={18} />
              </button>

            </div>
          </div>
        </header>

        <main
          className="min-w-0 outline-none"
          onClick={resumeTyping}
          onFocus={focusInput}
        >
          <input
            aria-label="Kolom ketik"
            autoComplete="off"
            autoCorrect="off"
            autoFocus
            className="sr-only"
            disabled={status === "finished"}
            id="typing-input"
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={(event) => event.preventDefault()}
            ref={inputRef}
            spellCheck={false}
            value={currentInput}
          />

          {status === "finished" ? (
            <TypingResultChart
              duration={duration}
              errors={typingErrors}
              isDarkMode={isDarkMode}
              languageLabel={activeLanguage?.label ?? "indonesian"}
              modifications={typingModifications}
              samples={resultSamples}
              score={score}
            />
          ) : (
            <div className="relative min-w-0">
              <div
                aria-hidden={needsTypingFocus}
                className={`flex h-[290px] min-w-0 flex-wrap content-start gap-x-3 gap-y-4 overflow-hidden font-serif text-3xl leading-relaxed transition duration-200 sm:text-4xl ${
                  needsTypingFocus ? "blur-[3px] opacity-45" : "blur-0 opacity-100"
                } ${theme.wordArea}`}
              >
                {visibleWords.map((word, index) => (
                  <span
                    className={getWordClassName(index)}
                    key={`${visibleStart + index}-${word}`}
                    ref={(element) => {
                      const wordIndex = visibleStart + index;

                      if (element) {
                        wordRefs.current.set(wordIndex, element);
                      } else {
                        wordRefs.current.delete(wordIndex);
                      }
                    }}
                  >
                    {renderWord(word, index)}
                  </span>
                ))}
              </div>

              {needsTypingFocus ? (
                <button
                  className={`absolute inset-0 flex items-center justify-center rounded-md backdrop-blur-[1px] transition ${theme.focusOverlay}`}
                  onClick={resumeTyping}
                  type="button"
                >
                  <span
                    className={`rounded-md px-4 py-2 text-sm font-semibold shadow-sm transition ${theme.focusPrompt}`}
                  >
                    Klik di sini untuk melanjutkan
                  </span>
                </button>
              ) : null}
            </div>
          )}
        </main>

        <footer
          className={`border-t pt-6 text-sm transition-colors duration-300 ${theme.footerBorder} ${theme.footerText}`}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p>WPM Lab</p>
            <p>
              by{" "}
              <a
                aria-label="Kunjungi website devbyte"
                className={`rounded-sm ${theme.footerLink}`}
                href="https://devbyte-mu.vercel.app"
                rel="author"
                title="https://devbyte-mu.vercel.app"
              >
                devbyte
              </a>
            </p>
          </div>
        </footer>
      </div>
    </section>
  );
}

type TypingCursorProps = {
  className?: string;
  colorClassName: string;
};

function TypingCursor({
  className = "left-0",
  colorClassName,
}: TypingCursorProps) {
  return (
    <span
      aria-hidden="true"
      className={`typing-caret pointer-events-none absolute inset-y-0 w-[3px] rounded-full ${className} ${colorClassName}`}
    />
  );
}

type TypingResultChartProps = {
  duration: number;
  errors: number;
  isDarkMode: boolean;
  languageLabel: string;
  modifications: number;
  samples: readonly TypingStatsSample[];
  score: TypingScore;
};

function TypingResultChart({
  duration,
  errors,
  isDarkMode,
  languageLabel,
  modifications,
  samples,
  score,
}: TypingResultChartProps) {
  const [focusedMetric, setFocusedMetric] = useState<ChartMetric | null>(null);
  const baseSample =
    samples.at(-1) ??
    ({
      accuracy: score.accuracy,
      errors,
      wpm: score.wpm,
      modifications,
      second: duration,
    } satisfies TypingStatsSample);
  const firstSample = samples[0] ?? baseSample;
  const chartSamples = [
    ...(firstSample.second > 0
      ? [{ ...firstSample, wpm: 0, second: 0 }]
      : []),
    ...samples,
    ...(baseSample.second < duration ? [{ ...baseSample, second: duration }] : []),
  ];
  const maxWpm = Math.max(
    80,
    Math.ceil(
      Math.max(score.rawWpm, ...chartSamples.map((sample) => sample.wpm)) / 10,
    ) * 10,
  );
  const linePath = getLinePath(chartSamples, duration, maxWpm);
  const chartBottom = CHART_HEIGHT - CHART_PADDING.bottom;
  const firstX = getChartX(chartSamples[0]?.second ?? 0, duration);
  const lastX = getChartX(chartSamples.at(-1)?.second ?? duration, duration);
  const areaPath = `${linePath} L ${lastX.toFixed(2)} ${chartBottom} L ${firstX.toFixed(2)} ${chartBottom} Z`;
  const yTicks = Array.from({ length: 5 }, (_, index) =>
    Math.round((maxWpm / 4) * index),
  ).reverse();
  const xTicks = Array.from({ length: 7 }, (_, index) =>
    Math.round((duration / 6) * index),
  );
  const errorPoints = chartSamples.filter(
    (sample, index) => sample.errors > (chartSamples[index - 1]?.errors ?? 0),
  );
  const modificationPoints = chartSamples.filter(
    (sample, index) =>
      sample.modifications > (chartSamples[index - 1]?.modifications ?? 0),
  );
  const isWpmFocused = focusedMetric === null || focusedMetric === "wpm";
  const isErrorFocused = focusedMetric === null || focusedMetric === "error";
  const isModificationFocused =
    focusedMetric === null || focusedMetric === "modification";
  const palette = isDarkMode
    ? {
        axis: "#7dd3fc66",
        grid: "#7dd3fc24",
        wpm: "#a855f7",
        label: "#ccfbf1",
        muted: "#99f6e480",
        surface: "#101412",
      }
    : {
        axis: "#67e8f9",
        grid: "#94a3b833",
        wpm: "#9333ea",
        label: "#0f172a",
        muted: "#64748b",
        surface: "#e8f7fb",
      };

  return (
    <section className={`result-panel-in min-h-[430px] border-t pt-8 ${isDarkMode ? "border-purple-400/30" : "border-purple-300/70"}`}>
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <dl className="grid gap-8 sm:grid-cols-2">
          <div>
            <dt className={`text-xs font-bold uppercase tracking-normal ${isDarkMode ? "text-purple-100/60" : "text-purple-600/75"}`}>
              Word per minute
            </dt>
            <dd className="mt-1 text-5xl font-bold leading-none text-purple-500">
              {score.wpm} wpm
            </dd>
          </div>
          <div>
            <dt className={`text-xs font-bold uppercase tracking-normal ${isDarkMode ? "text-purple-100/60" : "text-purple-600/75"}`}>
              Akurasi
            </dt>
            <dd className="mt-1 text-5xl font-bold leading-none text-purple-500">
              {score.accuracy}%
            </dd>
          </div>
        </dl>

        <p className={`text-sm font-semibold ${isDarkMode ? "text-purple-100/60" : "text-purple-600/75"}`}>
          Tes Mengetik - Waktu {duration} - {languageLabel}
        </p>
      </div>

      <div className={`mt-7 border-t pt-4 ${isDarkMode ? "border-purple-400/30" : "border-purple-300/70"}`}>
        <div className="mb-3 flex flex-wrap items-center justify-center gap-4 text-sm">
          <ChartLegend
            active={focusedMetric === "wpm"}
            colorClassName="bg-purple-600"
            isDimmed={focusedMetric !== null && focusedMetric !== "wpm"}
            label="WPM"
            metric="wpm"
            onClearFocus={() => setFocusedMetric(null)}
            onFocusMetric={setFocusedMetric}
          />
          <ChartLegend
            active={focusedMetric === "error"}
            colorClassName="bg-rose-500"
            isDimmed={focusedMetric !== null && focusedMetric !== "error"}
            label="Error"
            metric="error"
            onClearFocus={() => setFocusedMetric(null)}
            onFocusMetric={setFocusedMetric}
          />
          <ChartLegend
            active={focusedMetric === "modification"}
            colorClassName="bg-orange-500"
            isDimmed={
              focusedMetric !== null && focusedMetric !== "modification"
            }
            label="Modifications"
            metric="modification"
            onClearFocus={() => setFocusedMetric(null)}
            onFocusMetric={setFocusedMetric}
          />
        </div>

        <svg
          aria-label="Grafik statistik hasil typing test"
          className="h-auto w-full overflow-visible"
          role="img"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        >
          <defs>
            <linearGradient id="wpm-area-gradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={palette.wpm} stopOpacity="0.45" />
              <stop offset="100%" stopColor={palette.wpm} stopOpacity="0.03" />
            </linearGradient>
          </defs>

          <rect
            fill={palette.surface}
            height={CHART_HEIGHT}
            width={CHART_WIDTH}
            x="0"
            y="0"
          />

          {yTicks.map((tick) => {
            const y = getChartY(tick, maxWpm);

            return (
              <g key={tick}>
                <line
                  stroke={palette.grid}
                  strokeWidth="1"
                  x1={CHART_PADDING.left}
                  x2={CHART_WIDTH - CHART_PADDING.right}
                  y1={y}
                  y2={y}
                />
                <text
                  fill={palette.label}
                  fontSize="12"
                  textAnchor="end"
                  x={CHART_PADDING.left - 10}
                  y={y + 4}
                >
                  {tick}
                </text>
              </g>
            );
          })}

          <text
            fill={palette.muted}
            fontSize="12"
            fontWeight="700"
            textAnchor="start"
            x={CHART_PADDING.left}
            y="14"
          >
            WORD PER MINUTE
          </text>

          <text
            fill={palette.muted}
            fontSize="12"
            fontWeight="700"
            textAnchor="middle"
            transform={`rotate(-90 ${26} ${CHART_HEIGHT / 2})`}
            x="26"
            y={CHART_HEIGHT / 2}
          >
            WPM
          </text>

          <path
            className="result-chart-area"
            d={areaPath}
            fill="url(#wpm-area-gradient)"
            opacity={isWpmFocused ? 1 : 0.16}
          />
          <path
            className="result-chart-line"
            d={linePath}
            fill="none"
            opacity={isWpmFocused ? 1 : 0.2}
            stroke={palette.wpm}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={focusedMetric === "wpm" ? 5 : 3}
          />

          {errorPoints.map((sample, index) => (
            <circle
              className="result-chart-point"
              cx={getChartX(sample.second, duration)}
              cy={getChartY(Math.max(sample.wpm, maxWpm * 0.2), maxWpm)}
              fill="#f43f5e"
              key={`error-${sample.second}-${sample.errors}`}
              opacity={isErrorFocused ? 1 : 0.2}
              r={focusedMetric === "error" ? 7 : 5}
              style={{ animationDelay: `${360 + index * 35}ms` }}
            />
          ))}

          {modificationPoints.map((sample, index) => (
            <circle
              className="result-chart-point"
              cx={getChartX(sample.second, duration)}
              cy={getChartY(Math.max(sample.wpm, maxWpm * 0.15), maxWpm)}
              fill="#f97316"
              key={`modification-${sample.second}-${sample.modifications}`}
              opacity={isModificationFocused ? 1 : 0.2}
              r={focusedMetric === "modification" ? 7 : 5}
              style={{ animationDelay: `${420 + index * 35}ms` }}
            />
          ))}

          <line
            stroke={palette.axis}
            strokeWidth="1"
            x1={CHART_PADDING.left}
            x2={CHART_WIDTH - CHART_PADDING.right}
            y1={chartBottom}
            y2={chartBottom}
          />

          {xTicks.map((tick) => {
            const x = getChartX(tick, duration);
            const timeLabel = formatChartTime(tick);

            return (
              <g key={tick}>
                <line
                  stroke={palette.grid}
                  strokeWidth="2"
                  x1={x}
                  x2={x}
                  y1={chartBottom}
                  y2={chartBottom + 6}
                />
                <text
                  fill={palette.label}
                  fontSize="12"
                  textAnchor="middle"
                  x={x}
                  y={chartBottom + 28}
                >
                  {timeLabel}
                </text>
              </g>
            );
          })}

          <text
            fill={palette.muted}
            fontSize="12"
            fontWeight="700"
            textAnchor="middle"
            x={(CHART_WIDTH + CHART_PADDING.left - CHART_PADDING.right) / 2}
            y={CHART_HEIGHT - 4}
          >
            Waktu
          </text>
        </svg>
      </div>
    </section>
  );
}

type ChartLegendProps = {
  active: boolean;
  colorClassName: string;
  isDimmed: boolean;
  label: string;
  metric: ChartMetric;
  onClearFocus: () => void;
  onFocusMetric: (metric: ChartMetric) => void;
};

function ChartLegend({
  active,
  colorClassName,
  isDimmed,
  label,
  metric,
  onClearFocus,
  onFocusMetric,
}: ChartLegendProps) {
  return (
    <button
      aria-pressed={active}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2 font-medium transition focus:outline-none focus:ring-2 focus:ring-purple-400/70 ${
        active ? "bg-purple-400/20 shadow-sm" : "hover:bg-purple-400/10"
      } ${isDimmed ? "opacity-35" : "opacity-100"}`}
      onBlur={onClearFocus}
      onFocus={() => onFocusMetric(metric)}
      onMouseEnter={() => onFocusMetric(metric)}
      onMouseLeave={onClearFocus}
      type="button"
    >
      <span className={`h-3.5 w-3.5 rounded-full ${colorClassName}`} />
      <span>{label}</span>
    </button>
  );
}
