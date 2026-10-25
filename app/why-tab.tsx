import { FAIRNESS, RESEARCH, type Study } from "../lib/lighting/research";

const FACTORS: [string, string, string][] = [
  ["☀️", "Face brightness · 30%", "Enough light on your face, measured from the brightest parts so it's fair across skin tones."],
  ["🪟", "No glare behind you · 25%", "Nothing brighter behind you than you. A window behind you makes your camera darken your face."],
  ["⚖️", "Even light · 20%", "Both cheeks lit about the same. Half a face in shadow reads as less trustworthy."],
  ["💡", "Not washed out · 10%", "No pure-white patches. Too much light in your face loses detail."],
  ["🖼️", "Framing · 15%", "Your face centered and a good size in the picture."],
];

export default function WhyTab() {
  return (
    <div style={{ display: "grid", gap: 22 }}>
      <section className="glass" style={{ padding: "26px 28px" }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 600 }}>Why lighting matters</h2>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, maxWidth: 780, color: "var(--ink)" }}>
          In a remote interview, your video <em>is</em> your first impression. People decide how they feel about you within seconds, and they see
          you through a webcam that wasn&apos;t built for good lighting. Research shows that how you&apos;re lit, where your camera sits, and how
          your video looks all change how trustworthy and likable you seem, even when what you say is exactly the same.
        </p>
      </section>

      {RESEARCH.map((s, i) => (
        <StudyCard key={s.url} badge={`Study ${i + 1}`} s={s} />
      ))}

      <StudyCard badge="Fairness" s={FAIRNESS} />

      <section className="glass" style={{ padding: "24px 28px" }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 22, fontWeight: 600 }}>How your score works</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          {FACTORS.map(([icon, name, text]) => (
            <div key={name} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <Bubble>{icon}</Bubble>
              <div>
                <div style={{ fontWeight: 600 }}>{name}</div>
                <div style={{ fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.45 }}>{text}</div>
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.6, margin: "18px 0 0" }}>
          If any one of these is very poor, the total drops hard, so a dark face can&apos;t score well just because everything else is fine. The
          virtual light then tries hundreds of positions, strengths, and softness levels to find your best look, and the voice coaches you to get
          your real lighting closer to it.
        </p>
      </section>

      <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink)", opacity: 0.8, margin: "0 8px", textAlign: "center" }}>
        <strong>What we don&apos;t claim:</strong> no study we found shows that lighting alone changes hiring decisions. These studies show that
        lighting, camera angle, and video quality change how trustworthy and likable people seem. The virtual light is a 2D preview, not
        physically accurate relighting.
      </p>
    </div>
  );
}

function StudyCard({ s, badge }: { s: Study; badge: string }) {
  return (
    <section className="glass" style={{ padding: "24px 28px" }}>
      <span className="aero-badge">{badge}</span>
      <h3 style={{ margin: "10px 0 6px", fontSize: 22, fontWeight: 600 }}>{s.title}</h3>
      <p style={{ margin: "0 0 18px", fontSize: 16, lineHeight: 1.6 }}>{s.found}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18 }}>
        <Point icon="🔬" label="How they tested it" text={s.did} />
        <Point icon="💬" label="What it means for you" text={s.meaning} />
        <Point icon="✨" label="In Light Coach" text={s.inApp} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, marginTop: 18, fontSize: 13 }}>
        <span style={{ color: "var(--ink-soft)", fontStyle: "italic", maxWidth: 620 }}>Keep in mind: {s.limits}</span>
        <a href={s.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
          {s.cite} ↗
        </a>
      </div>
    </section>
  );
}

function Point({ icon, label, text }: { icon: string; label: string; text: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <Bubble>{icon}</Bubble>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 14, lineHeight: 1.55, color: "var(--ink-soft)" }}>{text}</div>
      </div>
    </div>
  );
}

// Small glossy bubble that holds an icon.
function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 38,
        height: 38,
        flexShrink: 0,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        fontSize: 18,
        background: "radial-gradient(circle at 32% 28%, #ffffff 0%, #d9f3ff 45%, #9fdcf7 100%)",
        border: "1px solid rgba(255,255,255,0.9)",
        boxShadow: "0 3px 8px rgba(0,90,150,0.2), inset 0 -3px 6px rgba(0,120,200,0.15)",
      }}
    >
      {children}
    </div>
  );
}