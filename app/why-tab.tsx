import { FAIRNESS, RESEARCH, type Study } from "../lib/lighting/research";

const FACTORS: [string, string][] = [
  ["Face brightness (30%)", "Is there enough light on your face? Measured from the brightest parts of your face, so it's fair across skin tones."],
  ["No glare behind you (25%)", "Is the area behind you brighter than you? A window or lamp behind you makes your camera darken your face."],
  ["Even light on both sides (20%)", "Is one cheek much darker than the other? Side light that leaves half your face in shadow reads as less trustworthy."],
  ["Not washed out (10%)", "Is part of your face pure white? Too much light in your face loses detail."],
  ["Framing (15%)", "Is your face centered and a good size in the picture?"],
];

export default function WhyTab() {
  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: 4 }}>Why lighting matters</h2>
      <p style={{ marginTop: 0, fontSize: 16, lineHeight: 1.5, maxWidth: 820 }}>
        In a remote interview, your video is your first impression. Interviewers form a view of you within seconds, and they see you through a
        webcam that usually wasn&apos;t built for good lighting. Research shows that how you&apos;re lit, where your camera sits, and how your
        video looks all change how trustworthy and likable people think you are, even when what you say is exactly the same. Light Coach fixes
        the part you control.
      </p>

      <div style={{ display: "grid", gap: 16 }}>
        {RESEARCH.map((s, i) => (
          <StudyCard key={s.url} n={i + 1} s={s} />
        ))}
      </div>

      <h2 style={{ marginTop: 32, marginBottom: 4 }}>Built to be fair across skin tones</h2>
      <StudyCard s={FAIRNESS} />

      <h2 style={{ marginTop: 32, marginBottom: 8 }}>How Light Coach scores your lighting</h2>
      <div style={{ ...card, display: "grid", gap: 10 }}>
        {FACTORS.map(([name, text]) => (
          <div key={name}>
            <strong>{name}</strong>
            <div style={{ fontSize: 14, opacity: 0.85 }}>{text}</div>
          </div>
        ))}
        <div style={{ fontSize: 14, opacity: 0.85 }}>
          If any one of these is very bad, the total drops hard, so a dark face can&apos;t score well just because everything else is fine. The
          virtual light then searches hundreds of light positions, strengths, and softness levels to find the one that gives you the highest
          score, and the voice tells you how to get your real lighting closer to it.
        </div>
      </div>

      <p style={{ fontSize: 13, opacity: 0.75, marginTop: 16, maxWidth: 820 }}>
        <strong>What we don&apos;t claim:</strong> no study we found shows that lighting alone changes hiring decisions. These studies show that
        lighting, camera angle, and video quality change how trustworthy and likable people seem, which is part of every first impression. The
        virtual light is a 2D preview using a simple head model, not physically accurate relighting.
      </p>
    </div>
  );
}

function StudyCard({ s, n }: { s: Study; n?: number }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 13, opacity: 0.6 }}>{n ? `Study ${n}` : "Study"}</div>
      <h3 style={{ margin: "2px 0 10px" }}>{s.title}</h3>
      <Row label="What they did" text={s.did} />
      <Row label="What they found" text={s.found} />
      <Row label="What it means for you" text={s.meaning} />
      <Row label="In Light Coach" text={s.inApp} />
      <Row label="Limits" text={s.limits} muted />
      <a href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 14, color: "#8a5a00" }}>
        {s.cite}
      </a>
    </div>
  );
}

function Row({ label, text, muted }: { label: string; text: string; muted?: boolean }) {
  return (
    <p style={{ margin: "0 0 10px", fontSize: 15, lineHeight: 1.5, opacity: muted ? 0.7 : 1 }}>
      <strong>{label}: </strong>
      {text}
    </p>
  );
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid #e4d9bd", borderRadius: 12, padding: 16 };