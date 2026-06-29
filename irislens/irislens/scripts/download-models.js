// Downloads the three face-api.js model files needed for recognition.
// Run once after cloning: node scripts/download-models.js
const fs = require("fs");
const path = require("path");
const https = require("https");

const BASE = "https://raw.githubusercontent.com/vladmandic/face-api/master/model/";
const FILES = [
  "ssd_mobilenetv1_model-weights_manifest.json",
  "ssd_mobilenetv1_model.bin",
  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model.bin",
  "face_recognition_model-weights_manifest.json",
  "face_recognition_model.bin",
];

const DEST = path.join(__dirname, "..", "public", "face-models");
fs.mkdirSync(DEST, { recursive: true });

function download(url, file) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return download(res.headers.location, file).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      res.pipe(out);
      out.on("finish", () => out.close(resolve));
    }).on("error", reject);
  });
}

(async () => {
  for (const f of FILES) {
    const dest = path.join(DEST, f);
    process.stdout.write(`Downloading ${f}… `);
    await download(BASE + f, dest);
    console.log("ok");
  }
  console.log(`\nModels saved to ${DEST}`);
})().catch((e) => { console.error(e); process.exit(1); });
