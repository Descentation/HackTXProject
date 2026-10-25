// Light Coach extension.
// When any website asks for your camera, this asks if you want Light Coach.
// If yes, it lights your face with a virtual light BEFORE the website gets the video,
// and shows a tiny floating panel with your score and a tip.
// Everything runs on your computer. No video is sent anywhere.
(() => {
  if (window.__lightCoachLoaded) return;
  window.__lightCoachLoaded = true;

  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;
  const originalGetUserMedia = md.getUserMedia.bind(md);
  const CHOICE_KEY = "light-coach-choice";

  md.getUserMedia = async function (constraints) {
    const stream = await originalGetUserMedia(constraints);
    if (!constraints || !constraints.video || stream.getVideoTracks().length === 0) return stream;

    // Ask once per tab (call apps often ask for the camera more than once).
    let choice = null;
    try {
      choice = sessionStorage.getItem(CHOICE_KEY);
    } catch {}
    if (choice === null) {
      choice = (await askUser()) ? "yes" : "no";
      try {
        sessionStorage.setItem(CHOICE_KEY, choice);
      } catch {}
    }
    if (choice !== "yes") return stream;
    try {
      return startCoach(stream);
    } catch (e) {
      console.warn("Light Coach could not start, using your normal camera.", e);
      return stream;
    }
  };

  // ---------------- Lighting math (same ideas as the website) ----------------
  const FACE = { x: 0.35, y: 0.2, w: 0.3, h: 0.45 }; // the extension assumes your face is near the center
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  function measure(px, W, H) {
    const f = FACE;
    const fx0 = Math.floor((f.x + f.w * 0.15) * W), fx1 = Math.ceil((f.x + f.w * 0.85) * W);
    const fy0 = Math.floor((f.y + f.h * 0.1) * H), fy1 = Math.ceil((f.y + f.h * 0.9) * H);
    const mid = (fx0 + fx1) / 2;
    const hist = new Uint32Array(256);
    let n = 0, clipped = 0, ls = 0, ln = 0, rs = 0, rn = 0;
    for (let y = fy0; y < fy1; y++)
      for (let x = fx0; x < fx1; x++) {
        const i = (y * W + x) * 4;
        const v = lum(px[i], px[i + 1], px[i + 2]);
        hist[Math.min(255, Math.round(v))]++;
        n++;
        if (v > 245) clipped++;
        if (x < mid) (ls += v), ln++;
        else (rs += v), rn++;
      }
    let p90 = 0, seen = 0;
    for (let b = 0; b < 256; b++) {
      seen += hist[b];
      if (seen >= n * 0.9) {
        p90 = b;
        break;
      }
    }
    const cx = (f.x + f.w / 2) * W, cy = (f.y + f.h / 2) * H, hw = f.w * W * 0.8, hh = f.h * H * 0.8;
    let bs = 0, bn = 0;
    const rows = Math.floor(H * 0.65);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < W; x++)
        if (Math.abs(x - cx) > hw || Math.abs(y - cy) > hh) {
          const i = (y * W + x) * 4;
          bs += lum(px[i], px[i + 1], px[i + 2]);
          bn++;
        }
    return { p90, clip: n ? clipped / n : 0, bg: bn ? bs / bn : 128, left: ln ? ls / ln : 0, right: rn ? rs / rn : 0 };
  }

  function score(m) {
    const brightness = m.p90 >= 120 ? 1 : clamp01((m.p90 - 45) / 75);
    const notBlown = 1 - clamp01((m.clip - 0.03) / 0.17);
    const backlight = clamp01((m.p90 / Math.max(m.bg, 1) - 0.55) / 0.45);
    const asym = Math.abs(m.left - m.right) / Math.max(m.left, m.right, 1);
    const evenness = 1 - clamp01((asym - 0.12) / 0.33);
    const weighted = (0.3 * brightness + 0.25 * backlight + 0.2 * evenness + 0.1 * notBlown) / 0.85;
    const worst = Math.min(brightness, backlight, evenness, notBlown);
    return { total: Math.round(100 * weighted * (0.4 + 0.6 * worst)), brightness, backlight, evenness, notBlown };
  }

  function tip(m, s) {
    const asym = (m.right - m.left) / Math.max(m.left, m.right, 1); // + = light from YOUR left (raw image-right)
    const side = Math.abs(asym) > 0.08 ? (asym > 0 ? "left" : "right") : null;
    if (s.backlight < 0.7) return ["Bright light behind you", "Cover the window or lamp behind you, or turn to face it."];
    if (s.brightness < 0.7)
      return ["Your face is too dark", side ? `Turn a little toward your ${side}, where the light is.` : "Turn your screen brightness up, or add a lamp in front of you."];
    if (s.notBlown < 0.7) return ["Your face is too bright", "Lean back from the light, or dim it."];
    if (s.evenness < 0.7) return [`Brighter on your ${side || "left"} side`, `Turn slightly to your ${side || "left"}, toward the light.`];
    return s.total >= 80 ? ["Lighting looks great", "You're ready."] : ["Almost there", "Face your brightest light a little more."];
  }

  // Head-as-ellipsoid shading (same as the website's relight.ts), done in place.
  function relight(px, W, H, L) {
    if (L.intensity <= 0.01) return;
    const f = FACE;
    const cx = (f.x + f.w / 2) * W, cy = (f.y + f.h * 0.45) * H, rx = f.w * W * 0.62, ry = f.h * H * 0.78;
    const lx = (L.x * W - cx) / rx, ly = (L.y * H - cy) / ry, lz = 0.6 + L.distance * 1.4;
    const len = Math.hypot(lx, ly, lz), Lx = lx / len, Ly = ly / len, Lz = lz / len;
    const wrap = 0.15 + L.softness * 0.85;
    const power = L.intensity * (1.25 - L.distance * 0.55);
    const shadow = (1 - L.softness) * 0.35 * Math.min(1, L.intensity);
    const FE = 0.35, outer = 1 + FE;
    const x0 = Math.max(0, Math.floor(cx - rx * outer)), x1 = Math.min(W, Math.ceil(cx + rx * outer));
    const y0 = Math.max(0, Math.floor(cy - ry * outer)), y1 = Math.min(H, Math.ceil(cy + ry * outer));
    for (let y = y0; y < y1; y++) {
      const ny0 = (y - cy) / ry;
      for (let x = x0; x < x1; x++) {
        const nx0 = (x - cx) / rx, d2 = nx0 * nx0 + ny0 * ny0;
        if (d2 >= outer * outer) continue;
        const d = Math.sqrt(d2);
        let nx = nx0, ny = ny0, nz = 0;
        if (d < 1) nz = Math.sqrt(1 - d2);
        else (nx /= d), (ny /= d);
        const t = d <= 1 ? 1 : 1 - (d - 1) / FE, mask = t * t * (3 - 2 * t);
        const lit = Math.max(0, (nx * Lx + ny * Ly + nz * Lz + wrap) / (1 + wrap));
        const g = mask * lit * power, dim = 1 - mask * shadow * (1 - lit);
        const i = (y * W + x) * 4;
        px[i] = px[i] * dim * (1 + g) + g * 22;
        px[i + 1] = px[i + 1] * dim * (1 + g * 0.97) + g * 21;
        px[i + 2] = px[i + 2] * dim * (1 + g * 0.92) + g * 20;
      }
    }
  }

  // Try light spots around the face and strengths; keep the best score.
  const SPOTS = [[0, -0.25]];
  for (const r of [0.7, 1.3]) for (let k = 0; k < 8; k++) SPOTS.push([Math.cos((k * Math.PI) / 4) * r, Math.sin((k * Math.PI) / 4) * r]);
  function lightFor(aim) {
    const cx = FACE.x + FACE.w / 2, cy = FACE.y + FACE.h * 0.45;
    return { x: clamp01(cx + aim.ox * FACE.w), y: clamp01(cy + aim.oy * FACE.h), intensity: aim.i, distance: aim.d, softness: aim.s };
  }
  function bestAim(px, W, H, current) {
    const scratch = new Uint8ClampedArray(px.length);
    const evalAim = (a) => {
      scratch.set(px);
      relight(scratch, W, H, lightFor(a));
      return score(measure(scratch, W, H)).total;
    };
    let best = current, bestT = evalAim(current);
    const currentT = bestT;
    const consider = (a) => {
      const t = evalAim(a);
      if (t > bestT || (t === bestT && a.i < best.i)) (best = a), (bestT = t);
    };
    for (const [ox, oy] of SPOTS) consider({ ...best, ox, oy });
    for (const i of [0, 0.4, 0.7, 1, 1.3, 1.6, 2]) consider({ ...best, i });
    for (const d of [0.15, 0.45, 0.8]) consider({ ...best, d });
    for (const s of [0.15, 0.55, 0.9]) consider({ ...best, s });
    return { aim: best, total: bestT, currentTotal: currentT };
  }

  // ---------------- The camera pipeline ----------------
  function startCoach(src) {
    const camTrack = src.getVideoTracks()[0];
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([camTrack]);
    video.play().catch(() => {});

    const canvas = document.createElement("canvas");
    const st0 = camTrack.getSettings();
    canvas.width = Math.min(640, st0.width || 640);
    canvas.height = Math.round((canvas.width * (st0.height || 480)) / (st0.width || 640));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const small = document.createElement("canvas");
    const sctx = small.getContext("2d", { willReadFrequently: true });

    const state = { on: true, aim: { ox: 0.8, oy: -0.6, i: 1, d: 0.45, s: 0.55 }, shown: null, running: true, lastAnalyze: 0 };
    const panel = makePanel(state);

    function frame() {
      if (!state.running) return;
      const vw = video.videoWidth, vh = video.videoHeight;
      if (vw && vh) {
        const W = Math.min(640, vw), H = Math.round((W * vh) / vw);
        if (canvas.width !== W || canvas.height !== H) (canvas.width = W), (canvas.height = H);
        ctx.drawImage(video, 0, 0, W, H);

        const now = performance.now();
        if (now - state.lastAnalyze > 400) {
          state.lastAnalyze = now;
          analyze(W, H);
        }
        // Glide the drawn light toward the target so it never jumps.
        const target = lightFor(state.aim);
        const s = state.shown || target;
        const k = 0.2;
        state.shown = {
          x: s.x + (target.x - s.x) * k,
          y: s.y + (target.y - s.y) * k,
          intensity: s.intensity + (target.intensity - s.intensity) * k,
          distance: s.distance + (target.distance - s.distance) * k,
          softness: s.softness + (target.softness - s.softness) * k,
        };
        if (state.on) {
          const img = ctx.getImageData(0, 0, W, H);
          relight(img.data, W, H, state.shown);
          ctx.putImageData(img, 0, 0);
        }
      }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(frame);
      else setTimeout(frame, 33);
    }

    function analyze(W, H) {
      small.width = 160;
      small.height = Math.max(1, Math.round((160 * H) / W));
      sctx.drawImage(video, 0, 0, small.width, small.height);
      const px = sctx.getImageData(0, 0, small.width, small.height).data;
      const m = measure(px, small.width, small.height);
      const real = score(m);
      const r = bestAim(px, small.width, small.height, state.aim);
      if (r.total >= r.currentTotal + 2) state.aim = r.aim;
      const withLight = state.on ? Math.max(r.currentTotal, r.total) : real.total;
      panel.update(real.total, withLight, tip(m, real));
    }

    const out = canvas.captureStream(30);
    src.getAudioTracks().forEach((t) => out.addTrack(t));
    const outTrack = out.getVideoTracks()[0];
        // Call apps (Meet, Teams) check the camera's name, settings, and controls.
    // A processed video has none of these, so they'd think the camera is broken.
    // Make our track report the real camera's details and pass controls through to it.
    const passthrough = {
      label: () => camTrack.label,
      getSettings: () => () => ({ ...camTrack.getSettings(), width: canvas.width, height: canvas.height }),
      getCapabilities: () => () => (camTrack.getCapabilities ? camTrack.getCapabilities() : {}),
      getConstraints: () => () => camTrack.getConstraints(),
      applyConstraints: () => (c) => camTrack.applyConstraints(c).catch(() => {}),
    };
    for (const [name, make] of Object.entries(passthrough)) {
      try {
        if (name === "label") Object.defineProperty(outTrack, "label", { get: make, configurable: true });
        else Object.defineProperty(outTrack, name, { value: make(), configurable: true });
      } catch {}
    }
    // When the call app turns the camera off, turn the real camera off too.
    const stopOut = outTrack.stop.bind(outTrack);
    outTrack.stop = () => {
      state.running = false;
      camTrack.stop();
      panel.remove();
      stopOut();
    };
    camTrack.addEventListener("ended", () => {
      state.running = false;
      panel.remove();
    });
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(frame);
    else setTimeout(frame, 33);
    return out;
  }

  // ---------------- UI (Frutiger Aero, in a shadow root so the page's styles can't break it) ----------------
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Segoe UI", Frutiger, "Helvetica Neue", Arial, sans-serif; }
    .card { position: fixed; z-index: 2147483647; color: #0b3a5c; border-radius: 22px; padding: 14px 16px;
      background: linear-gradient(180deg, rgba(255,255,255,.95), rgba(225,245,255,.9));
      border: 1px solid rgba(255,255,255,.95); box-shadow: 0 12px 30px rgba(0,70,130,.3), inset 0 1px 0 #fff; }
    .orb { width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
      background: radial-gradient(circle at 60% 62%, #ffe27a 0 22%, transparent 34%), radial-gradient(circle at 50% 60%, #bff0ff, #36aef0 55%, #0a6fb3);
      box-shadow: inset 0 6px 6px -3px rgba(255,255,255,.9), 0 3px 6px rgba(0,80,140,.35); }
    .row { display: flex; align-items: center; gap: 10px; }
    .title { font-weight: 700; font-size: 15px; }
    .muted { color: #3d6680; font-size: 12px; }
    .btn { font: inherit; font-weight: 600; font-size: 13px; cursor: pointer; border-radius: 999px; padding: 7px 14px; color: #fff;
      border: 1px solid rgba(0,90,150,.45); text-shadow: 0 1px 1px rgba(0,60,110,.45);
      background: linear-gradient(180deg,#8fdcff 0%,#36aef0 48%,#128bd6 52%,#4cc0f7 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,.75); }
    .btn.silver { color: #0b3a5c; text-shadow: none; border-color: rgba(80,120,150,.35);
      background: linear-gradient(180deg,#fff 0%,#eef6fb 48%,#dce9f2 52%,#f4f9fc 100%); }
    .scores { display: flex; align-items: center; gap: 8px; margin: 10px 0 6px; }
    .num { font-size: 26px; font-weight: 700; line-height: 1; }
    .head { cursor: move; user-select: none; }
    .x { margin-left: auto; cursor: pointer; border: 0; background: none; font-size: 16px; color: #3d6680; }
  `;
  const color = (t) => (t == null ? "#8fb3c9" : t >= 80 ? "#3cb043" : t >= 50 ? "#f2a71b" : "#ef5b5b");

  function mount() {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);
    (document.body || document.documentElement).appendChild(host);
    return { host, root };
  }

  function askUser() {
    return new Promise((resolve) => {
      const { host, root } = mount();
      const card = document.createElement("div");
      card.className = "card";
      card.style.cssText = "right:20px;bottom:20px;width:300px;";
      card.innerHTML = `
        <div class="row"><div class="orb"></div><div class="title">Use Light Coach?</div></div>
        <div class="muted" style="margin:8px 0 12px;font-size:13px">This site wants your camera. Light Coach can light your face with a virtual light and coach you live. Video stays on your computer.</div>
        <div class="row"><button class="btn" data-a="yes">Use Light Coach</button><button class="btn silver" data-a="no">No thanks</button></div>`;
      root.appendChild(card);
      const done = (v) => {
        clearTimeout(timer);
        host.remove();
        resolve(v);
      };
      card.querySelector('[data-a="yes"]').onclick = () => done(true);
      card.querySelector('[data-a="no"]').onclick = () => done(false);
      const timer = setTimeout(() => done(false), 20000); // don't block the call forever
    });
  }

  function makePanel(state) {
    const { host, root } = mount();
    const card = document.createElement("div");
    card.className = "card";
    card.style.cssText = "right:20px;top:20px;width:270px;";
    card.innerHTML = `
      <div class="row head"><div class="orb"></div><div class="title">Light Coach</div><button class="x" title="Minimize">–</button></div>
      <div class="body">
        <div class="scores">
          <div style="text-align:center"><div class="num" data-real>--</div><div class="muted">your camera</div></div>
          <div style="color:#1e9be0;font-size:20px">→</div>
          <div style="text-align:center"><div class="num" data-lit>--</div><div class="muted">with light</div></div>
        </div>
        <div style="font-weight:700;font-size:14px;margin-top:6px" data-tip>Checking your lighting…</div>
        <div class="muted" style="margin:2px 0 10px" data-detail></div>
        <button class="btn" data-toggle>Virtual light: on</button>
      </div>`;
    root.appendChild(card);
    const $ = (s) => card.querySelector(s);
    $("[data-toggle]").onclick = () => {
      state.on = !state.on;
      $("[data-toggle]").textContent = `Virtual light: ${state.on ? "on" : "off"}`;
      $("[data-toggle]").className = state.on ? "btn" : "btn silver";
    };
    $(".x").onclick = () => {
      const body = $(".body");
      const hidden = body.style.display === "none";
      body.style.display = hidden ? "" : "none";
      $(".x").textContent = hidden ? "–" : "+";
    };
    // Drag by the header so it never covers the call controls.
    const head = $(".head");
    head.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const r = card.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
      const move = (ev) => {
        card.style.left = `${Math.max(0, ev.clientX - ox)}px`;
        card.style.top = `${Math.max(0, ev.clientY - oy)}px`;
        card.style.right = "auto";
      };
      const up = () => (removeEventListener("pointermove", move), removeEventListener("pointerup", up));
      addEventListener("pointermove", move);
      addEventListener("pointerup", up);
    });
    return {
      update(real, lit, [headline, detail]) {
        $("[data-real]").textContent = real;
        $("[data-real]").style.color = color(real);
        $("[data-lit]").textContent = lit;
        $("[data-lit]").style.color = color(lit);
        $("[data-tip]").textContent = headline;
        $("[data-detail]").textContent = detail;
      },
      remove() {
        host.remove();
      },
    };
  }
})();
