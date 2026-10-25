// Copies MediaPipe's WebAssembly files into public/ so face detection works without a CDN.
const fs = require("fs");
const path = require("path");
const src = path.join(__dirname, "..", "node_modules", "@mediapipe", "tasks-vision", "wasm");
const dest = path.join(__dirname, "..", "public", "mediapipe", "wasm");
fs.mkdirSync(dest, { recursive: true });
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dest, f));
console.log("Copied MediaPipe wasm files to public/mediapipe/wasm");
