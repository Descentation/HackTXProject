import "./globals.css";

export const metadata = { title: "Light Coach", description: "Live lighting score and spoken directions for video calls" };

// Bubbles: [left %, size px, seconds to rise, delay seconds]
const BUBBLES: [number, number, number, number][] = [
  [4, 46, 19, 0],
  [11, 22, 14, 6],
  [19, 70, 24, 3],
  [28, 30, 16, 11],
  [37, 18, 12, 2],
  [46, 54, 21, 8],
  [55, 26, 15, 14],
  [63, 80, 27, 5],
  [71, 34, 17, 1],
  [79, 20, 13, 9],
  [86, 60, 23, 12],
  [93, 28, 16, 4],
];

const CLOUDS: [number, number, number, number][] = [
  // [top %, width px, seconds to cross, delay seconds]
  [8, 260, 90, 0],
  [18, 180, 120, 40],
  [30, 220, 105, 70],
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Decorative animated background: sky, sun, rays, clouds, hills, bubbles */}
        <div className="aero-scene" aria-hidden="true">
          <div className="aero-rays" />
          <div className="aero-sun" />
          {CLOUDS.map(([top, w, dur, delay], i) => (
            <div key={i} className="aero-cloud" style={{ top: `${top}%`, width: w, animationDuration: `${dur}s`, animationDelay: `-${delay}s` }} />
          ))}
          <svg className="aero-hills" viewBox="0 0 1440 320" preserveAspectRatio="none">
            <defs>
              <linearGradient id="hillBack" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#a7e07a" />
                <stop offset="1" stopColor="#4fae3a" />
              </linearGradient>
              <linearGradient id="hillFront" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#8fdc5a" />
                <stop offset="1" stopColor="#2f8f2a" />
              </linearGradient>
            </defs>
            <path d="M0,170 C240,90 480,110 720,150 C960,190 1200,120 1440,90 L1440,320 L0,320 Z" fill="url(#hillBack)" opacity="0.85" />
            <path d="M0,230 C300,160 560,200 820,220 C1080,240 1260,180 1440,170 L1440,320 L0,320 Z" fill="url(#hillFront)" />
            {/* Glossy highlight along the front hill */}
            <path d="M0,232 C300,162 560,202 820,222 C1080,242 1260,182 1440,172" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="3" />
            {/* The classic white swooshes */}
            <path d="M-20,120 C300,40 700,210 1460,60" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="10" strokeLinecap="round" />
            <path d="M-20,150 C360,80 760,230 1460,100" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="5" strokeLinecap="round" />
          </svg>
          {BUBBLES.map(([left, size, dur, delay], i) => (
            <div
              key={i}
              className="aero-bubble"
              style={{ left: `${left}%`, width: size, height: size, animationDuration: `${dur}s`, animationDelay: `-${delay}s` }}
            />
          ))}
        </div>
        <div className="aero-content">{children}</div>
      </body>
    </html>
  );
}