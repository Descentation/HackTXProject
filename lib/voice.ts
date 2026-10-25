// Picks the most natural-sounding voice the browser has, and varies the wording
// so the coach doesn't repeat the exact same robotic line every time.

// Best first. "Natural"/"Neural" voices (Edge on Windows) sound the most human.
const PREFERRED = [
  /Natural/i,
  /Neural/i,
  /Microsoft (Aria|Jenny|Guy|Ava|Andrew|Emma|Brian)/i,
  /Google US English/i,
  /Samantha/i,
  /Google UK English Female/i,
];

export function englishVoices(): SpeechSynthesisVoice[] {
  const all = window.speechSynthesis?.getVoices?.() ?? [];
  return all.filter((v) => v.lang?.toLowerCase().startsWith("en"));
}

export function pickVoice(name: string): SpeechSynthesisVoice | null {
  const en = englishVoices();
  if (name) {
    const chosen = en.find((v) => v.name === name);
    if (chosen) return chosen;
  }
  for (const re of PREFERRED) {
    const v = en.find((x) => re.test(x.name));
    if (v) return v;
  }
  return en.find((v) => v.lang === "en-US") ?? en[0] ?? null;
}

const pick = (options: string[]) => options[Math.floor(Math.random() * options.length)];

export const phrase = {
  start: () => pick(["Hi! Let's get your lighting looking great.", "Okay, let's check your lighting.", "Alright, let's see how your lighting looks."]),
  better: () => pick(["Nice, that's better. Keep going.", "Good, it's improving. A little more.", "That's helping. Keep going."]),
  worse: () => pick(["Hmm, that made it worse. Try the other way.", "Not quite. Go back the other way.", "That went the wrong way. Try the opposite direction."]),
  fixed: () => pick(["Nice, that's fixed.", "Perfect, that one's done.", "Great, that's sorted."]),
};