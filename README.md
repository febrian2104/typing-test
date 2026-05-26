# KPM Lab

Project web typing test untuk mengukur kata per menit, akurasi, kata benar,
dan raw KPM. Fondasi awal memakai Next.js App Router, TypeScript, Tailwind CSS,
dan Vitest.

## Getting Started

Jalankan development server:

```bash
pnpm dev
```

Buka [http://localhost:3000](http://localhost:3000).

## Scripts

```bash
pnpm dev       # local development
pnpm lint      # ESLint
pnpm test:run  # unit test sekali jalan
pnpm build     # production build
```

## Struktur Awal

- `src/components/typing-test.tsx` - UI dan interaksi typing test.
- `src/lib/scoring.ts` - perhitungan KPM, raw KPM, dan akurasi.
- `src/lib/word-generator.ts` - generator antrean kata.
- `src/data/words-id.ts` - bank kata Indonesia untuk MVP.

## Roadmap Dekat

- Simpan hasil test ke database.
- Tambahkan auth user.
- Buat leaderboard berdasarkan durasi dan bahasa.
- Tambahkan profile berisi riwayat dan best score.
