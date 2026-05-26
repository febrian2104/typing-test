"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { scoreTypingAttempt } from "@/lib/scoring";
import { buildWordQueue } from "@/lib/word-generator";

const DURATIONS = [15, 30, 60] as const;
const WORD_BATCH_SIZE = 140;
const WORD_BUFFER_THRESHOLD = 36;

type TestStatus = "idle" | "running" | "finished";

type TypingTestProps = {
  wordBank: readonly string[];
};

function getTimestamp() {
  return Date.now();
}

export function TypingTest({ wordBank }: TypingTestProps) {
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>(60);
  const [wordQueue, setWordQueue] = useState<string[]>(() =>
    buildWordQueue(wordBank, WORD_BATCH_SIZE),
  );
  const [submittedWords, setSubmittedWords] = useState<string[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [status, setStatus] = useState<TestStatus>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => getTimestamp());
  const inputRef = useRef<HTMLInputElement>(null);

  const elapsedSeconds =
    startedAt === null ? 0 : Math.min(duration, Math.max(0, (now - startedAt) / 1000));
  const remainingSeconds =
    status === "finished" ? 0 : Math.max(0, Math.ceil(duration - elapsedSeconds));
  const currentWordIndex = submittedWords.length;
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
  const visibleStart = Math.max(0, currentWordIndex - 8);
  const visibleWords = wordQueue.slice(visibleStart, visibleStart + 72);

  useEffect(() => {
    if (status !== "running" || startedAt === null) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const timestamp = getTimestamp();

      setNow(timestamp);

      if ((timestamp - startedAt) / 1000 >= duration) {
        setStatus("finished");
        window.clearInterval(intervalId);
      }
    }, 200);

    return () => window.clearInterval(intervalId);
  }, [duration, startedAt, status]);

  function startTest() {
    const timestamp = getTimestamp();
    setStartedAt(timestamp);
    setNow(timestamp);
    setStatus("running");
  }

  function resetTest(nextDuration = duration) {
    setDuration(nextDuration);
    setWordQueue(buildWordQueue(wordBank, WORD_BATCH_SIZE));
    setSubmittedWords([]);
    setCurrentInput("");
    setStatus("idle");
    setStartedAt(null);
    setNow(getTimestamp());
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  function submitCurrentWord() {
    const word = currentInput.trim();

    if (!word || status === "finished") {
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
    if (status === "finished") {
      return;
    }

    const nextValue = event.target.value.replace(/\s/g, "");

    if (status === "idle" && nextValue.length > 0) {
      startTest();
    }

    setCurrentInput(nextValue);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
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
      isActive && currentInput.length > 0 && !targetWord.startsWith(currentInput);
    const baseClass =
      "rounded px-1.5 py-1 transition-colors duration-150";

    if (typedWord !== undefined) {
      return `${baseClass} ${
        typedWord === targetWord
          ? "text-emerald-700"
          : "text-rose-700 line-through decoration-rose-300"
      }`;
    }

    if (isActiveWrong) {
      return `${baseClass} bg-rose-100 text-rose-800 ring-1 ring-rose-300`;
    }

    if (isActive) {
      return `${baseClass} bg-zinc-950 text-white`;
    }

    return `${baseClass} text-zinc-500`;
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-5 border-b border-zinc-200 pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-700">
            Typing Test
          </p>
          <h1 className="mt-2 text-4xl font-semibold text-zinc-950 sm:text-5xl">
            KPM Lab
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="grid grid-cols-3 rounded-lg border border-zinc-300 bg-white p-1 shadow-sm">
            {DURATIONS.map((option) => (
              <button
                className={`h-10 rounded-md px-4 text-sm font-semibold transition ${
                  duration === option
                    ? "bg-zinc-950 text-white"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
                }`}
                key={option}
                onClick={() => resetTest(option)}
                type="button"
              >
                {option}s
              </button>
            ))}
          </div>

          <button
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-100"
            onClick={() => resetTest()}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={17} />
            Ulang
          </button>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="KPM" value={score.kpm} tone="dark" />
        <Stat label="Akurasi" value={`${score.accuracy}%`} tone="green" />
        <Stat label="Benar" value={score.correctWords} tone="amber" />
        <Stat label="Waktu" value={remainingSeconds} tone="red" />
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-6 flex items-center justify-between gap-4 border-b border-zinc-200 pb-4">
          <div>
            <p className="text-sm font-medium text-zinc-500">Mode</p>
            <p className="mt-1 text-lg font-semibold text-zinc-950">
              Indonesia - {duration} detik
            </p>
          </div>
          <div
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              status === "finished"
                ? "bg-emerald-100 text-emerald-800"
                : status === "running"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-zinc-100 text-zinc-700"
            }`}
          >
            {status === "finished"
              ? "Selesai"
              : status === "running"
                ? "Berjalan"
                : "Siap"}
          </div>
        </div>

        <div className="min-h-[220px] rounded-lg bg-zinc-50 p-5 text-2xl font-medium leading-relaxed text-zinc-500 sm:text-3xl">
          {visibleWords.map((word, index) => (
            <span className={getWordClassName(index)} key={`${visibleStart + index}-${word}`}>
              {word}
            </span>
          ))}
        </div>

        <div className="mt-5">
          <label className="sr-only" htmlFor="typing-input">
            Kolom ketik
          </label>
          <input
            autoComplete="off"
            autoCorrect="off"
            className="h-14 w-full rounded-lg border border-zinc-300 bg-white px-4 text-xl font-semibold text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-4 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
            disabled={status === "finished"}
            id="typing-input"
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={(event) => event.preventDefault()}
            placeholder="mulai mengetik"
            ref={inputRef}
            spellCheck={false}
            value={currentInput}
          />
        </div>

        {status === "finished" ? (
          <div className="mt-6 grid gap-4 border-t border-zinc-200 pt-5 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="text-sm font-medium text-zinc-500">Hasil akhir</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-950">
                {score.kpm} KPM, {score.accuracy}% akurasi
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                {score.correctWords} benar dari {score.attemptedWords} kata,
                raw {score.rawKpm} KPM.
              </p>
            </div>
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800"
              onClick={() => resetTest()}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={17} />
              Ulangi test
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

type StatProps = {
  label: string;
  value: number | string;
  tone: "dark" | "green" | "amber" | "red";
};

function Stat({ label, value, tone }: StatProps) {
  const toneClass = {
    dark: "border-zinc-900 bg-zinc-950 text-white",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-rose-200 bg-rose-50 text-rose-800",
  }[tone];

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <dt className="text-sm font-medium opacity-75">{label}</dt>
      <dd className="mt-2 text-3xl font-semibold">{value}</dd>
    </div>
  );
}
