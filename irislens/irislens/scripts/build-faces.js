// Offline face-descriptor builder.
//
// USAGE:
//   1. Drop guest photos into public/faces/
//      Naming convention: FirstName_LastName_seat_NUMBER.jpg
//      Example: Andrew_Wevell_seat_12.jpg
//                Sarah_Jones_seat_7.png
//   2. Run:    node scripts/build-faces.js
//   3. Commit faces.json + the photos, push.
//
// The script reads every image in public/faces/, computes a 128-D descriptor
// using face-api.js, and writes public/faces.json:
//   [{ name, seat, descriptor: [128 floats] }, ...]
//
// The descriptors are tiny (~1KB per face) so 100 people is ~100KB total.
// Faces are never sent over the network at runtime — only descriptors.

const fs = require("fs");
const path = require("path");
const faceapi = require("@vladmandic/face-api");
const canvas = require("canvas");
const tf = require("@tensorflow/tfjs-node");

const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const FACES_DIR = path.join(__dirname, "..", "public", "faces");
const OUTPUT = path.join(__dirname, "..", "public", "faces.json");
const MODELS_DIR = path.join(__dirname, "..", "public", "face-models");

function parseFilename(file) {
  // Expects: FirstName_LastName_seat_NUMBER.ext  OR  FirstName_LastName_seat_admin.ext
  // Examples: Andrew_Wevell_seat_12.jpg
  //           Andrew_seat_admin.jpeg
  const base = file.replace(/\.(jpg|jpeg|png|webp)$/i, "");
  const match = base.match(/^(.+)_seat_(admin|\d+(?:[A-Za-z])?)$/i);
  if (!match) return null;
  return {
    name: match[1].replace(/_/g, " "),
    seat: match[2].toLowerCase() === "admin" ? "admin" : match[2],
  };
}

async function main() {
  if (!fs.existsSync(MODELS_DIR)) {
    console.error(`\nModels missing. Expected at: ${MODELS_DIR}`);
    console.error("Download from: https://github.com/vladmandic/face-api/tree/master/model");
    console.error("You need: ssd_mobilenetv1_model-*.* and face_landmark_68_model-*.* and face_recognition_model-*.*\n");
    process.exit(1);
  }

  console.log("Loading face-api models…");
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_DIR);

  if (!fs.existsSync(FACES_DIR)) {
    console.error(`Photos dir missing: ${FACES_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(FACES_DIR).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
  if (files.length === 0) {
    console.error("No images in public/faces/. Add photos and try again.");
    process.exit(1);
  }

  const out = [];
  for (const file of files) {
    const meta = parseFilename(file);
    if (!meta) {
      console.warn(`SKIP ${file} — filename does not match FirstName_LastName_seat_NUMBER.ext`);
      continue;
    }
    process.stdout.write(`Processing ${file}… `);
    const img = await canvas.loadImage(path.join(FACES_DIR, file));
    const detection = await faceapi
      .detectSingleFace(img)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      console.log("NO FACE DETECTED");
      continue;
    }
    out.push({
      name: meta.name,
      seat: meta.seat,
      descriptor: Array.from(detection.descriptor),
    });
    console.log(`ok (seat ${meta.seat})`);
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(out));
  console.log(`\nWrote ${out.length} face(s) to public/faces.json (${(fs.statSync(OUTPUT).size / 1024).toFixed(1)} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
