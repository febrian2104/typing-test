import { TypingTest } from "@/components/typing-test";
import { indonesianWords } from "@/data/words-id";

export default function Home() {
  return <TypingTest wordBank={indonesianWords} />;
}
