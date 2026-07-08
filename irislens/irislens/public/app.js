var IrisLensBundle = (() => {
  const { useRef, useState, useEffect, useCallback } = React;
  const CDN_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
  const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
  const R_IRIS = [469, 470, 471, 472];
  const HOLD_MS = 1200;
  const ALIGN_TOL = 0.1;
  const CROP = 512;
  const BRAND_BG = "/assets/hero.jpg";
  const BRAND_DNA = "/assets/icy_blue_dna_helix_in_focus.png";
  const BRAND_LOGO = "/assets/IS_Clinical_Logo-1.png";
  const GUESTS = [
    { seat: "1", name: "Amber Wright" },
    { seat: "2", name: "Jamie Domburg" },
    { seat: "3", name: "Hannah Kruyer-Maritz" },
    { seat: "4", name: "Chelsea Jonathan" },
    { seat: "5", name: "Amy Lee Steenkamp" },
    { seat: "6", name: "Margot Rothman" },
    { seat: "7", name: "Zo\xEB Parker" },
    { seat: "8", name: "Joloving" },
    { seat: "9", name: "Monica van der Walt" },
    { seat: "10", name: "Anele Geqiwe" },
    { seat: "11", name: "Elle Curnow" },
    { seat: "12", name: "Kay-Anne De Vogeleer" },
    { seat: "13", name: "Patricia Dolz" },
    { seat: "14", name: "Fayazie Khan" },
    { seat: "15", name: "Christine Bekker" },
    { seat: "16", name: "Mari Biderman-Pam" },
    { seat: "17", name: "Liebe Heyns" },
    { seat: "18", name: "Sera Harper" },
    { seat: "19", name: "Amy Willcock" },
    { seat: "20", name: "Lee Willcock" },
    { seat: "21", name: "Dr. Monica Kantani" },
    { seat: "22", name: "Dourina Ritchewaldt" },
    { seat: "admin", name: "Andrew" },
    { seat: "admin", name: "Dirkie" },
    { seat: "admin", name: "Claudia" }
  ];
  function normalize(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.,\-']/g, " ").replace(/\s+/g, " ").trim();
  }
  function matchName(input) {
    const q = normalize(input);
    if (!q) return { entry: null };
    const all = GUESTS.map((g) => ({ ...g, n: normalize(g.name) }));
    const exact = all.find((g) => g.n === q);
    if (exact) return { entry: exact };
    const parts = q.split(" ");
    if (parts.length > 1) {
      const partialMatches = all.filter((g) => parts.every((p) => g.n.includes(p)));
      if (partialMatches.length === 1) return { entry: partialMatches[0] };
      if (partialMatches.length > 1) return { candidates: partialMatches };
    }
    const firstWord = parts[0];
    const firstWordMatches = all.filter((g) => g.n.split(" ")[0] === firstWord);
    if (firstWordMatches.length === 1) return { entry: firstWordMatches[0] };
    if (firstWordMatches.length > 1) return { candidates: firstWordMatches };
    const loose = all.filter((g) => g.n.includes(q));
    if (loose.length === 1) return { entry: loose[0] };
    if (loose.length > 1) return { candidates: loose };
    return { entry: null };
  }
  function classifyColor(h, s, l) {
    if (l < 0.14) return "dark brown";
    if (s < 0.07) return "gray";
    if (h < 40 || h > 330) {
      return l < 0.28 ? "dark brown" : "brown";
    }
    if (h >= 40 && h < 62 && s > 0.26) return "amber";
    if (h >= 55 && h < 95 && s > 0.1) return "hazel";
    if (h >= 95 && h < 168) return "green";
    if (h >= 168 && h < 205) return "blue-gray";
    if (h >= 205 && h < 265) return s < 0.11 ? "blue-gray" : "blue";
    if (s < 0.12) return "gray";
    return "brown";
  }
  const SWATCH = { "dark brown": "#3b2417", brown: "#6b4226", amber: "#c08a2e", hazel: "#8a7a3a", green: "#3f7a54", "blue-gray": "#5f7d8a", blue: "#3f6fb0", gray: "#7a7d82" };
  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function AppBackdrop({ dna = true, soft = false }) {
    return /* @__PURE__ */ React.createElement("div", { className: soft ? "app-backdrop app-backdrop-soft" : "app-backdrop", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("img", { className: "app-bg-img", src: BRAND_BG, alt: "" }), dna && /* @__PURE__ */ React.createElement("img", { className: "dna-img", src: BRAND_DNA, alt: "" }), /* @__PURE__ */ React.createElement("div", { className: "brand-vignette" }));
  }
  function BrandLogo({ small = false }) {
    return /* @__PURE__ */ React.createElement("img", { className: small ? "brand-logo brand-logo-small" : "brand-logo", src: BRAND_LOGO, alt: "iS Clinical" });
  }
  function EyeGlyph() {
    return /* @__PURE__ */ React.createElement("svg", { width: "58", height: "38", viewBox: "0 0 58 38", fill: "none", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "M3 19C3 19 12 5 29 5C46 5 55 19 55 19C55 19 46 33 29 33C12 33 3 19 3 19Z", stroke: "rgba(218,232,255,.78)", strokeWidth: "1.4" }), /* @__PURE__ */ React.createElement("circle", { cx: "29", cy: "19", r: "8", stroke: "rgba(218,232,255,.78)", strokeWidth: "1.4" }), /* @__PURE__ */ React.createElement("circle", { cx: "29", cy: "19", r: "2.2", fill: "rgba(218,232,255,.88)" }));
  }
  function HudOverlay({ state }) {
    const c = "#00d4ff", dim = "rgba(0,212,255,0.25)", lock = state === "locking" || state === "capturing";
    const ticks = [];
    for (let i = 0; i < 72; i++) {
      const a = i * 5 * Math.PI / 180, maj = i % 9 === 0;
      ticks.push(/* @__PURE__ */ React.createElement("line", { key: i, x1: 200 + (maj ? 151 : 155) * Math.cos(a), y1: 200 + (maj ? 151 : 155) * Math.sin(a), x2: 200 + 162 * Math.cos(a), y2: 200 + 162 * Math.sin(a), stroke: maj ? c : dim, strokeWidth: maj ? 1.2 : 0.6, opacity: "0.8" }));
    }
    return /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 400 400", style: { position: "absolute", top: "50%", left: "50%", width: "min(86vw,360px)", height: "min(86vw,360px)", transform: "translate(-50%,-55%)", pointerEvents: "none", overflow: "visible" } }, ticks, /* @__PURE__ */ React.createElement("circle", { cx: "200", cy: "200", r: "162", fill: "none", stroke: dim, strokeWidth: "0.8", strokeDasharray: "3 4" }), /* @__PURE__ */ React.createElement("circle", { cx: "200", cy: "200", r: "140", fill: "none", stroke: lock ? c : dim, strokeWidth: "0.8", opacity: "0.6" }), /* @__PURE__ */ React.createElement("circle", { cx: "200", cy: "200", r: "118", fill: "none", stroke: lock ? c : dim, strokeWidth: "2", strokeDasharray: state === "locking" ? "28 8" : state === "capturing" ? "none" : "56 18", style: { transition: "all 0.5s" } }), /* @__PURE__ */ React.createElement("circle", { cx: "200", cy: "200", r: "94", fill: "none", stroke: dim, strokeWidth: "0.8", strokeDasharray: "2 5" }), /* @__PURE__ */ React.createElement("path", { d: "M60 108 L60 60 L108 60", fill: "none", stroke: c, strokeWidth: "1.5", opacity: "0.9" }), /* @__PURE__ */ React.createElement("path", { d: "M292 60 L340 60 L340 108", fill: "none", stroke: c, strokeWidth: "1.5", opacity: "0.9" }), /* @__PURE__ */ React.createElement("path", { d: "M60 292 L60 340 L108 340", fill: "none", stroke: c, strokeWidth: "1.5", opacity: "0.9" }), /* @__PURE__ */ React.createElement("path", { d: "M292 340 L340 340 L340 292", fill: "none", stroke: c, strokeWidth: "1.5", opacity: "0.9" }), /* @__PURE__ */ React.createElement("line", { x1: "200", y1: "70", x2: "200", y2: "84", stroke: "rgba(0,212,255,0.5)", strokeWidth: "1.2" }), /* @__PURE__ */ React.createElement("line", { x1: "200", y1: "316", x2: "200", y2: "330", stroke: "rgba(0,212,255,0.5)", strokeWidth: "1.2" }), /* @__PURE__ */ React.createElement("line", { x1: "70", y1: "200", x2: "84", y2: "200", stroke: "rgba(0,212,255,0.5)", strokeWidth: "1.2" }), /* @__PURE__ */ React.createElement("line", { x1: "316", y1: "200", x2: "330", y2: "200", stroke: "rgba(0,212,255,0.5)", strokeWidth: "1.2" }), /* @__PURE__ */ React.createElement("text", { x: "112", y: "54", fill: c, fontSize: "8", fontFamily: "Inter,monospace", opacity: "0.6", letterSpacing: "2" }, "IRIS.SCAN"), /* @__PURE__ */ React.createElement("text", { x: "288", y: "54", fill: c, fontSize: "8", fontFamily: "Inter,monospace", opacity: "0.6", textAnchor: "end", letterSpacing: "2" }, state === "capturing" ? "CAPTURED" : state === "locking" ? "LOCKING" : "SCANNING"), [0, 90, 180, 270].map((deg) => {
      const a = deg * Math.PI / 180;
      return /* @__PURE__ */ React.createElement("circle", { key: deg, cx: 200 + 118 * Math.cos(a), cy: 200 + 118 * Math.sin(a), r: "3.5", fill: lock ? c : "none", stroke: c, strokeWidth: "1.2", opacity: "0.9" });
    }));
  }
  function IrisLens() {
    const [screen, setScreen] = useState("home");
    const [status, setStatus] = useState("Position your eye within the ring");
    const [hudState, setHudState] = useState("searching");
    const [permError, setPermError] = useState(null);
    const [showNamePrompt, setShowNamePrompt] = useState(false);
    const [showExplainer, setShowExplainer] = useState(false);
    const [nameInput, setNameInput] = useState("");
    const [disambigList, setDisambigList] = useState(null);
    const [currentGuest, setCurrentGuest] = useState(null);
    const currentGuestRef = useRef(null);
    const [result, setResult] = useState(null);
    const [gallery, setGallery] = useState([]);
    const [expanded, setExpanded] = useState(null);
    const [procMsg, setProcMsg] = useState("Reading iris geometry\u2026");
    const [genError, setGenError] = useState(null);
    const videoRef = useRef(null), streamRef = useRef(null), landmarkerRef = useRef(null);
    const rafRef = useRef(null), holdStartRef = useRef(null), capturedRef = useRef(false);
    const lastCropRef = useRef(null), lastColorRef = useRef("natural");
    const loadLandmarker = useCallback(async () => {
      if (landmarkerRef.current) return landmarkerRef.current;
      let v = window.visionTasks;
      if (!v) {
        await new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error("MediaPipe timeout")), 2e4);
          window.addEventListener("mp-ready", () => {
            clearTimeout(t);
            res();
          }, { once: true });
        });
        v = window.visionTasks;
      }
      const { FaceLandmarker, FilesetResolver } = v;
      const fs = await FilesetResolver.forVisionTasks(CDN_WASM);
      const lm = await FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" }, runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: false });
      landmarkerRef.current = lm;
      return lm;
    }, []);
    const startCamera = useCallback(async () => {
      setPermError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        await loadLandmarker();
        capturedRef.current = false;
        holdStartRef.current = null;
        setHudState("searching");
        loop();
      } catch (e) {
        if (e.name === "NotAllowedError") setPermError("Camera access was denied. Please enable it in your browser settings.");
        else if (e.name === "NotFoundError") setPermError("No camera detected on this device.");
        else setPermError("Camera unavailable: " + e.message);
      }
    }, [loadLandmarker]);
    const stopCamera = useCallback(() => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }, []);
    const loop = useCallback(() => {
      const video = videoRef.current, lm = landmarkerRef.current;
      if (!video || !lm || video.readyState < 2 || capturedRef.current) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      let res;
      try {
        res = lm.detectForVideo(video, performance.now());
      } catch {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      if (!res.faceLandmarks?.length) {
        setStatus("Position your eye within the ring");
        setHudState("searching");
        holdStartRef.current = null;
      } else {
        const pts = res.faceLandmarks[0], iris = R_IRIS.map((i) => pts[i]);
        const cx = iris.reduce((a, p) => a + p.x, 0) / 4, cy = iris.reduce((a, p) => a + p.y, 0) / 4;
        const rad = Math.max(...iris.map((p) => Math.hypot(p.x - cx, p.y - cy)));
        const dist = Math.hypot(cx - 0.5, cy - 0.5);
        if (dist > ALIGN_TOL * 1.6) {
          setStatus("Centre your eye");
          setHudState("searching");
          holdStartRef.current = null;
        } else if (rad < 0.018) {
          setStatus("Move closer");
          setHudState("searching");
          holdStartRef.current = null;
        } else if (rad > 0.09) {
          setStatus("Move back slightly");
          setHudState("searching");
          holdStartRef.current = null;
        } else if (dist > ALIGN_TOL) {
          setStatus("Align to centre");
          setHudState("aligning");
          holdStartRef.current = null;
        } else {
          if (!holdStartRef.current) holdStartRef.current = performance.now();
          if (performance.now() - holdStartRef.current >= HOLD_MS) {
            capturedRef.current = true;
            setHudState("capturing");
            setStatus("Captured");
            setTimeout(() => capture(cx, cy, rad), 200);
            return;
          }
          setHudState("locking");
          setStatus("Hold steady");
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }, []);
    const capture = useCallback((ncx, ncy, nrad) => {
      const video = videoRef.current, vw = video.videoWidth, vh = video.videoHeight;
      const pad = 3.2, radPx = nrad * vw * pad, cxPx = ncx * vw, cyPx = ncy * vh;
      const c = document.createElement("canvas");
      c.width = CROP;
      c.height = CROP;
      const ctx = c.getContext("2d");
      ctx.drawImage(video, cxPx - radPx, cyPx - radPx, radPx * 2, radPx * 2, 0, 0, CROP, CROP);
      const d = ctx.getImageData(0, 0, CROP, CROP).data;
      const cxp = CROP / 2, cyp = CROP / 2, irisR = CROP / (2 * 3.2);
      let sr = 0, sg = 0, sb = 0, sn = 0;
      for (let y = 0; y < CROP; y += 4) for (let x = 0; x < CROP; x += 4) {
        const dx = x - cxp, dy = y - cyp, dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > irisR * 1.15 && dist < irisR * 2.1) {
          const i = (y * CROP + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
          if ((r + g + b) / 3 > 155) {
            sr += r;
            sg += g;
            sb += b;
            sn++;
          }
        }
      }
      let wr = 1, wg = 1, wb = 1;
      if (sn > 40) {
        const ar = sr / sn, ag = sg / sn, ab = sb / sn, mx = Math.max(ar, ag, ab);
        wr = Math.min(mx / ar, 1.55);
        wg = Math.min(mx / ag, 1.55);
        wb = Math.min(mx / ab, 1.55);
      }
      const ringIn = irisR * 0.32, ringOut = irisR * 0.84;
      const bins = new Float32Array(72);
      let wsSum = 0, wlSum = 0, wCount = 0;
      for (let y = 0; y < CROP; y += 2) for (let x = 0; x < CROP; x += 2) {
        const dx = x - cxp, dy = y - cyp, dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= ringIn && dist <= ringOut) {
          const i = (y * CROP + x) * 4;
          const r = Math.min(255, d[i] * wr), g = Math.min(255, d[i + 1] * wg), b = Math.min(255, d[i + 2] * wb);
          const [h, s, l] = rgbToHsl(r, g, b);
          if (s > 0.07) bins[Math.floor(h / 5) % 72] += s * s;
          wsSum += s;
          wlSum += l;
          wCount++;
        }
      }
      const sm = new Float32Array(72);
      for (let i = 0; i < 72; i++) sm[i] = (bins[(i - 2 + 72) % 72] + bins[(i - 1 + 72) % 72] * 2 + bins[i] * 3 + bins[(i + 1) % 72] * 2 + bins[(i + 2) % 72]) / 9;
      let pk = 0, pv = 0;
      for (let i = 0; i < 72; i++) if (sm[i] > pv) {
        pv = sm[i];
        pk = i;
      }
      const colorLabel = classifyColor(pk * 5 + 2.5, wCount > 0 ? wsSum / wCount : 0, wCount > 0 ? wlSum / wCount : 0);
      const dataUrl = c.toDataURL("image/jpeg", 0.9);
      lastCropRef.current = dataUrl;
      lastColorRef.current = colorLabel;
      stopCamera();
      setGenError(null);
      setScreen("processing");
      generate(dataUrl, colorLabel);
    }, [stopCamera]);
    const generate = useCallback(async (dataUrl, colorLabel) => {
      const msgs = ["Reading iris geometry\u2026", "Mapping fibre patterns\u2026", "Cross-referencing", "Rendering macro detail\u2026", "Finalising your portrait\u2026"];
      let mi = 0;
      setProcMsg(msgs[0]);
      const t = setInterval(() => {
        mi = (mi + 1) % msgs.length;
        setProcMsg(msgs[mi]);
      }, 3e3);
      try {
        const startRes = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageDataUrl: dataUrl, colorLabel }) });
        const start = await startRes.json();
        if (!startRes.ok || !start.id) throw new Error(start.error || "Could not start generation");
        const finalColor = start.confirmedColor || colorLabel;
        let output = null;
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const pRes = await fetch("/api/poll?id=" + encodeURIComponent(start.id));
          const p = await pRes.json();
          if (p.status === "succeeded" && p.output) {
            output = p.output;
            break;
          }
          if (p.status === "failed" || p.status === "canceled") throw new Error(p.error || "Generation failed");
        }
        clearInterval(t);
        if (!output) throw new Error("Generation timed out. Please try again.");
        const item = {
          url: output,
          color: finalColor,
          seat: currentGuestRef.current?.seat || "\u2014",
          name: currentGuestRef.current?.name || null,
          date: (/* @__PURE__ */ new Date()).toLocaleDateString()
        };
        setResult(item);
        setGallery((g) => [item, ...g]);
        setScreen("results");
      } catch (e) {
        clearInterval(t);
        setGenError(String(e.message || e));
      }
    }, [currentGuest]);
    useEffect(() => { currentGuestRef.current = currentGuest; }, [currentGuest]);
    useEffect(() => {
      if (screen === "capture") startCamera();
      return () => {
        if (screen === "capture") stopCamera();
      };
    }, [screen]);
    const handleNameSubmit = () => {
      const res = matchName(nameInput);
      if (res.entry) {
        setCurrentGuest(res.entry);
        setShowNamePrompt(false);
        setDisambigList(null);
        setNameInput("");
        setShowExplainer(true);
      } else if (res.candidates) {
        setDisambigList(res.candidates);
      } else {
        setCurrentGuest({ name: nameInput, seat: "\u2014" });
        setShowNamePrompt(false);
        setNameInput("");
        setShowExplainer(true);
      }
    };
    const chooseDisambig = (entry) => {
      setCurrentGuest(entry);
      setShowNamePrompt(false);
      setDisambigList(null);
      setNameInput("");
      setShowExplainer(true);
    };
    const C = "#00d4ff";
    return /* @__PURE__ */ React.createElement("div", { className: "app-root" }, /* @__PURE__ */ React.createElement("style", null, `
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
        html,body,#root{min-height:100%;}
        body{background:#071432;}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes pulse{0%,100%{opacity:.42}50%{opacity:1}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(32px);}to{opacity:1;transform:translateY(0);}}
        @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
        @keyframes irisReveal{0%{opacity:0;filter:blur(24px) brightness(.3);transform:scale(1.04);}100%{opacity:1;filter:blur(0) brightness(1);transform:scale(1);}}
        @keyframes seatReveal{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
        @keyframes scanline{0%{transform:translateY(-100%);opacity:0;}20%{opacity:.8;}80%{opacity:.8;}100%{transform:translateY(100%);opacity:0;}}
        @keyframes dnaFloat{0%,100%{transform:translate3d(0,0,0) rotate(0deg);}50%{transform:translate3d(-8px,10px,0) rotate(.8deg);}}
        .app-root{min-height:100vh;background:#071432;color:#fff;font-family:'Inter',system-ui,sans-serif;overflow-x:hidden;}
        .screen{position:relative;min-height:100vh;overflow:hidden;background:#071432;color:#fff;}
        .screen-content{position:relative;z-index:2;}
        .app-backdrop{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:#071432;}
        .app-bg-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:saturate(1.08) contrast(1.05);transform:scale(1.01);}
        .dna-img{position:absolute;right:-36%;top:-10%;width:min(88vw,440px);height:auto;opacity:.58;filter:drop-shadow(0 0 28px rgba(168,205,255,.32));animation:dnaFloat 9s ease-in-out infinite;}
        .brand-vignette{position:absolute;inset:0;background:radial-gradient(ellipse 80% 65% at 50% 44%, rgba(5,15,44,.02) 0%, rgba(5,12,36,.34) 58%, rgba(2,6,22,.74) 100%),linear-gradient(to bottom, rgba(5,11,32,.12) 0%, rgba(4,10,28,.22) 42%, rgba(3,7,21,.72) 100%);}
        .app-backdrop-soft .brand-vignette{background:radial-gradient(ellipse 70% 55% at 50% 42%, rgba(7,22,60,.2) 0%, rgba(4,11,34,.74) 82%),linear-gradient(to bottom, rgba(6,14,40,.28), rgba(2,5,18,.88));}
        .brand-logo{display:block;width:min(33vw,152px);height:auto;margin:0 auto;filter:drop-shadow(0 0 14px rgba(255,255,255,.12));}
        .brand-logo-small{width:min(27vw,116px);}
        .display{font-family:'Cormorant Garamond',serif;font-weight:300;letter-spacing:-.02em;line-height:.96;}
        .script{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:300;letter-spacing:.01em;}
        .label{font-size:10px;font-weight:500;letter-spacing:.28em;text-transform:uppercase;color:rgba(225,236,255,.58);}
        .body-copy{font-size:clamp(17px,4.4vw,24px);font-weight:300;line-height:1.28;color:rgba(255,255,255,.92);letter-spacing:.03em;}
        .body-copy-small{font-size:clamp(13px,3.4vw,16px);font-weight:300;line-height:1.42;color:rgba(255,255,255,.82);letter-spacing:.02em;}
        .btn-ghost{background:rgba(255,255,255,.03);border:1px solid rgba(218,232,255,.22);color:rgba(255,255,255,.82);padding:14px 28px;font-family:'Inter',sans-serif;font-size:11px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;transition:all .3s;min-height:48px;}
        .btn-ghost:hover{border-color:rgba(255,255,255,.56);color:#fff;background:rgba(255,255,255,.07);}
        .btn-primary{background:#fff;border:none;color:#162750;padding:16px 40px;font-family:'Inter',sans-serif;font-size:11px;font-weight:600;letter-spacing:.28em;text-transform:uppercase;cursor:pointer;transition:all .3s;min-height:52px;box-shadow:0 14px 38px rgba(2,8,28,.28);}
        .btn-primary:hover{background:rgba(255,255,255,.9);}
        .btn-cyan{background:#fff;border:1px solid rgba(255,255,255,.9);color:#172853;padding:16px 40px;font-family:'Inter',sans-serif;font-size:11px;font-weight:600;letter-spacing:.24em;text-transform:uppercase;cursor:pointer;transition:all .3s;min-height:52px;box-shadow:0 14px 38px rgba(2,8,28,.28);}
        .btn-cyan:hover{background:rgba(255,255,255,.9);}
        .name-input{width:100%;background:transparent;border:none;border-bottom:1px solid rgba(218,232,255,.32);color:#fff;font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:300;padding:12px 0;outline:none;text-align:center;letter-spacing:.02em;transition:border-color .3s;}
        .name-input:focus{border-bottom-color:rgba(255,255,255,.8);}
        .name-input::placeholder{color:rgba(255,255,255,.34);font-style:italic;}
        .glass-card{background:rgba(6,18,49,.48);border:1px solid rgba(190,216,255,.28);box-shadow:0 20px 70px rgba(0,8,32,.28), inset 0 1px 0 rgba(255,255,255,.06);backdrop-filter:blur(18px);}
        .disambig-btn{width:100%;background:rgba(255,255,255,.03);border:1px solid rgba(218,232,255,.18);color:#fff;padding:14px 20px;font-family:'Inter',sans-serif;font-size:13px;font-weight:400;letter-spacing:.05em;cursor:pointer;transition:all .25s;text-align:left;margin-bottom:8px;}
        .disambig-btn:hover{border-color:rgba(255,255,255,.58);background:rgba(255,255,255,.08);}
        .result-card{width:100%;border:1px solid rgba(190,216,255,.32);background:rgba(7,22,62,.42);border-radius:18px;padding:24px 26px;backdrop-filter:blur(14px);}
        .result-row{display:flex;align-items:center;gap:16px;border:1px solid rgba(190,216,255,.22);background:rgba(7,22,62,.3);border-radius:16px;padding:16px 18px;text-align:left;}
        @media(max-height:720px){.home-stack{padding-top:16px!important;gap:18px!important}.home-title{font-size:clamp(48px,13vw,72px)!important}.home-button-wrap{margin-top:22px!important}}
        @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
      `), screen === "home" && /* @__PURE__ */ React.createElement("div", { className: "screen", style: { display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "max(28px,env(safe-area-inset-top)) 28px max(34px,env(safe-area-inset-bottom))" } }, /* @__PURE__ */ React.createElement(AppBackdrop, null), /* @__PURE__ */ React.createElement("div", { className: "screen-content home-stack", style: { width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", alignItems: "center", gap: 28, animation: "fadeUp 1s cubic-bezier(0.16,1,0.3,1) forwards" } }, /* @__PURE__ */ React.createElement(BrandLogo, null), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "display home-title", style: { fontSize: "clamp(58px,15vw,92px)", textTransform: "uppercase", marginBottom: 6 } }, "YOUR EYES"), /* @__PURE__ */ React.createElement("div", { className: "script", style: { fontSize: "clamp(50px,14vw,84px)", lineHeight: 0.82 } }, "hold the"), /* @__PURE__ */ React.createElement("div", { className: "display", style: { fontSize: "clamp(50px,13vw,80px)", textTransform: "uppercase", textAlign: "right", paddingRight: "10%" } }, "KEY")), /* @__PURE__ */ React.createElement("div", { style: { width: 150, height: 1, background: "linear-gradient(to right,transparent,rgba(255,255,255,.55),transparent)", position: "relative" } }, /* @__PURE__ */ React.createElement("span", { style: { position: "absolute", left: "50%", top: "50%", width: 8, height: 8, background: "#fff", boxShadow: "0 0 18px rgba(255,255,255,.9)", transform: "translate(-50%,-50%) rotate(45deg)" } })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 22, maxWidth: 560 } }, /* @__PURE__ */ React.createElement("p", { className: "body-copy", style: { margin: 0 } }, "Just as every iS CLINICAL innovation is unique,", /* @__PURE__ */ React.createElement("br", null), "so is every eye."), /* @__PURE__ */ React.createElement("p", { className: "body-copy", style: { margin: 0 } }, "Complete the scan to reveal your table number and begin your GeneXC Firming Eye Gel journey.")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginTop: 4 } }, /* @__PURE__ */ React.createElement(EyeGlyph, null), /* @__PURE__ */ React.createElement("p", { className: "body-copy-small", style: { margin: 0, maxWidth: 430 } }, "Hold your phone approximately 30 cm from your face and follow the on-screen instructions.")), /* @__PURE__ */ React.createElement("div", { className: "home-button-wrap", style: { width: "100%", maxWidth: 340, marginTop: 10, display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("button", { className: "btn-cyan", style: { width: "100%" }, onClick: () => {
      setShowNamePrompt(true);
      setNameInput("");
      setDisambigList(null);
    } }, "Begin Scan")))), screen === "capture" && /* @__PURE__ */ React.createElement("div", { className: "screen", style: { position: "fixed", inset: 0 } }, /* @__PURE__ */ React.createElement(AppBackdrop, { soft: true }), /* @__PURE__ */ React.createElement("video", { ref: videoRef, autoPlay: true, playsInline: true, muted: true, style: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", opacity: 0.72, filter: "saturate(.78) contrast(1.04) brightness(.78)" } }), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: 0, background: "radial-gradient(ellipse 60% 50% at 50% 48%, rgba(2,9,28,.05) 28%, rgba(3,9,28,.58) 74%, rgba(2,5,18,.9) 100%)", pointerEvents: "none" } }), /* @__PURE__ */ React.createElement("div", { className: "screen-content", style: { position: "absolute", top: "max(22px,env(safe-area-inset-top))", left: 0, right: 0, textAlign: "center", pointerEvents: "none" } }, /* @__PURE__ */ React.createElement(BrandLogo, { small: true }), /* @__PURE__ */ React.createElement("div", { className: "display", style: { fontSize: "clamp(38px,10vw,58px)", textTransform: "uppercase", marginTop: 18 } }, "SCAN"), /* @__PURE__ */ React.createElement("div", { className: "script", style: { fontSize: "clamp(34px,9vw,52px)", lineHeight: 0.8 } }, "your eyes")), !permError && /* @__PURE__ */ React.createElement(HudOverlay, { state: hudState }), !permError && (hudState === "locking" || hudState === "aligning") && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: "50%", left: "50%", width: "min(70vw,300px)", height: "1px", transform: "translate(-50%,-55%)", background: `linear-gradient(to right, transparent, ${C}, transparent)`, animation: "scanline 1.8s ease-in-out infinite", pointerEvents: "none", opacity: 0.72 } }), !permError && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", bottom: "max(118px,13vh)", left: 24, right: 24, textAlign: "center" } }, /* @__PURE__ */ React.createElement("span", { className: "label", style: { display: "block", color: "rgba(255,255,255,.88)", textShadow: "0 0 20px rgba(128,190,255,.75)", letterSpacing: ".24em", marginBottom: 14 } }, status), /* @__PURE__ */ React.createElement("p", { className: "body-copy-small", style: { margin: 0 } }, "Hold your phone approximately 30 cm from your face.")), permError && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center", background: "rgba(3,7,21,.88)" } }, /* @__PURE__ */ React.createElement("div", { className: "glass-card", style: { padding: "40px 30px", maxWidth: 340 } }, /* @__PURE__ */ React.createElement("p", { className: "label", style: { color: "rgba(255,255,255,.72)", marginBottom: 12 } }, "Camera Error"), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 14, fontWeight: 300, lineHeight: 1.7, marginBottom: 32, maxWidth: 280, color: "rgba(255,255,255,.78)" } }, permError), /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: startCamera }, "Try Again"), /* @__PURE__ */ React.createElement("button", { className: "btn-ghost", style: { marginTop: 12, width: "100%" }, onClick: () => setScreen("home") }, "Cancel"))), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", bottom: "max(34px,env(safe-area-inset-bottom))", left: 0, right: 0, display: "flex", justifyContent: "center" } }, /* @__PURE__ */ React.createElement("button", { onClick: () => setScreen("home"), style: { background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.22)", color: "rgba(255,255,255,.72)", width: 46, height: 46, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, borderRadius: "50%", backdropFilter: "blur(10px)" } }, "\u2715"))), screen === "processing" && /* @__PURE__ */ React.createElement("div", { className: "screen", style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 36px", textAlign: "center" } }, /* @__PURE__ */ React.createElement(AppBackdrop, { soft: true }), /* @__PURE__ */ React.createElement("div", { className: "screen-content", style: { maxWidth: 440, width: "100%" } }, /* @__PURE__ */ React.createElement(BrandLogo, { small: true }), !genError ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { position: "relative", width: 92, height: 92, margin: "58px auto 48px" } }, /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: 0, borderRadius: "50%", border: "1px solid rgba(255,255,255,.12)" } }), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: 0, borderRadius: "50%", border: "1px solid transparent", borderTopColor: "rgba(255,255,255,.72)", animation: "spin 2s linear infinite" } }), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: 14, borderRadius: "50%", border: "1px solid transparent", borderTopColor: "rgba(172,205,255,.95)", animation: "spin 1.4s linear infinite reverse" } })), /* @__PURE__ */ React.createElement("p", { className: "display", style: { fontSize: "clamp(36px,9vw,56px)", margin: "0 0 16px", color: "rgba(255,255,255,.96)" } }, procMsg), /* @__PURE__ */ React.createElement("span", { className: "label", style: { color: "rgba(255,255,255,.58)" } }, "Identifying your table")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "label", style: { color: "rgba(255,255,255,.72)", marginBottom: 16, display: "block" } }, "Generation Failed"), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13, fontWeight: 300, color: "rgba(255,255,255,.74)", maxWidth: 300, margin: "0 auto 36px", lineHeight: 1.7 } }, genError), /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: () => {
      setGenError(null);
      lastCropRef.current ? generate(lastCropRef.current, lastColorRef.current) : setScreen("capture");
    } }, "Try Again"), /* @__PURE__ */ React.createElement("button", { className: "btn-ghost", style: { marginTop: 12, width: "100%", maxWidth: 220 }, onClick: () => setScreen("home") }, "Home")))), screen === "results" && result && /* @__PURE__ */ React.createElement("div", { className: "screen", style: { display: "flex", flexDirection: "column", alignItems: "center", padding: "max(24px,env(safe-area-inset-top)) 24px max(34px,env(safe-area-inset-bottom))" } }, /* @__PURE__ */ React.createElement(AppBackdrop, null), /* @__PURE__ */ React.createElement("div", { className: "screen-content", style: { width: "100%", maxWidth: 520, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 } }, /* @__PURE__ */ React.createElement("button", { className: "btn-ghost", style: { padding: "9px 16px", fontSize: "10px" }, onClick: () => setScreen("home") }, "Home")), /* @__PURE__ */ React.createElement("div", { className: "screen-content", style: { width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 22, flex: 1, justifyContent: "center" } }, /* @__PURE__ */ React.createElement(BrandLogo, { small: true }), /* @__PURE__ */ React.createElement("div", { style: { position: "relative", marginBottom: 8 } }, 
/* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: -20, borderRadius: "50%", border: "1px solid rgba(255,255,255,.08)", pointerEvents: "none" } }), 
/* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: -40, borderRadius: "50%", border: "1px solid rgba(255,255,255,.04)", pointerEvents: "none" } }), 
/* @__PURE__ */ React.createElement("img", { src: result.url, alt: "Your iris portrait", style: { width: "min(56vw, 260px)", height: "min(56vw, 260px)", borderRadius: "50%", objectFit: "cover", display: "block", animation: "irisReveal 1.8s cubic-bezier(0.25,0.46,0.45,0.94) forwards", boxShadow: "0 0 0 1px rgba(255,255,255,.14), 0 0 50px rgba(6,14,32,.9)" } })), /* @__PURE__ */ React.createElement("div", { className: "result-card", style: { maxWidth: 430, position: "relative" } }, /* @__PURE__ */ React.createElement("span", { style: { position: "absolute", left: "50%", top: 0, width: 8, height: 8, background: "#fff", boxShadow: "0 0 18px rgba(255,255,255,.9)", transform: "translate(-50%,-50%) rotate(45deg)" } }), /* @__PURE__ */ React.createElement("span", { className: "label", style: { display: "block", marginBottom: 18, color: "rgba(255,255,255,.8)" } }, result.seat === "admin" ? "Access confirmed" : "Your table number"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 22 } }, /* @__PURE__ */ React.createElement("div", { className: "display", style: { fontSize: "clamp(38px,10vw,62px)", textTransform: "uppercase" } }, result.seat === "admin" ? "ADMIN" : "TABLE"), /* @__PURE__ */ React.createElement("div", { style: { width: 1, height: 64, background: "rgba(255,255,255,.18)" } }), /* @__PURE__ */ React.createElement("div", { className: "display", style: { fontSize: result.seat === "admin" ? "clamp(32px,8vw,48px)" : "clamp(68px,17vw,104px)", textShadow: "0 0 22px rgba(255,255,255,.48)", letterSpacing: result.seat === "admin" ? ".04em" : "-.03em" } }, result.seat === "admin" ? "PASS" : result.seat)), result.name && /* @__PURE__ */ React.createElement("p", { style: { fontSize: 12, fontWeight: 400, letterSpacing: ".1em", color: "rgba(255,255,255,.58)", margin: "18px 0 0", textTransform: "uppercase" } }, result.name)), /* @__PURE__ */ React.createElement("div", { style: { width: "100%", maxWidth: 430, display: "grid", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { className: "result-row" }, /* @__PURE__ */ React.createElement("div", { style: { width: 42, height: 42, borderRadius: "50%", background: SWATCH[result.color] || "#789", boxShadow: `0 0 22px ${SWATCH[result.color] || "#789"}`, flexShrink: 0 } }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "label", style: { color: "rgba(255,255,255,.86)", marginBottom: 6 } }, "Iris Tone"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, lineHeight: 1.45, color: "rgba(255,255,255,.72)", textTransform: "capitalize" } }, result.color)))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 6 } }, /* @__PURE__ */ React.createElement("button", { className: "btn-primary", style: { padding: "14px 30px", fontSize: "11px" }, onClick: async () => {
      try {
        const blob = await (await fetch(result.url)).blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `iris-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        window.open(result.url, "_blank");
      }
    } }, "Save"), /* @__PURE__ */ React.createElement("button", { className: "btn-ghost", onClick: async () => {
      try {
        const blob = await (await fetch(result.url)).blob();
        const file = new File([blob], "iris.png", { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: "My iris IrisLens" });
        else await navigator.clipboard.writeText(result.url);
      } catch {
      }
    } }, "Share"), /* @__PURE__ */ React.createElement("button", { className: "btn-ghost", onClick: () => {
      setCurrentGuest(null);
      setScreen("home");
    } }, "Retake")))), screen === "gallery" && /* @__PURE__ */ React.createElement("div", { className: "screen", style: { padding: "max(34px,env(safe-area-inset-top)) 28px max(36px,env(safe-area-inset-bottom))" } }, /* @__PURE__ */ React.createElement(AppBackdrop, { soft: true }), /* @__PURE__ */ React.createElement("div", { className: "screen-content", style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 44 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "label", style: { display: "block", marginBottom: 8 } }, "Collection"), /* @__PURE__ */ React.createElement("h2", { className: "display", style: { fontSize: 44, margin: 0 } }, "Gallery")), /* @__PURE__ */ React.createElement("button", { className: "btn-ghost", style: { padding: "9px 16px", fontSize: "10px" }, onClick: () => setScreen("home") }, "Home")), /* @__PURE__ */ React.createElement("div", { className: "screen-content" }, gallery.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", paddingTop: 80, maxWidth: 360, margin: "0 auto" } }, /* @__PURE__ */ React.createElement(BrandLogo, { small: true }), /* @__PURE__ */ React.createElement("span", { className: "label", style: { display: "block", margin: "36px 0 18px" } }, "No portraits yet"), /* @__PURE__ */ React.createElement("p", { className: "body-copy-small", style: { margin: "0 0 36px" } }, "Your iris portraits will appear here after capture."), /* @__PURE__ */ React.createElement("button", { className: "btn-cyan", onClick: () => {
      setShowNamePrompt(true);
      setNameInput("");
      setDisambigList(null);
    } }, "Begin Scan")) : /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 20 } }, gallery.map((it, i) => /* @__PURE__ */ React.createElement("div", { key: i, onClick: () => setExpanded(it), style: { cursor: "pointer", textAlign: "center" } }, /* @__PURE__ */ React.createElement("img", { src: it.url, alt: "", style: { width: "100%", borderRadius: "50%", display: "block", border: "1px solid rgba(255,255,255,.16)", boxShadow: "0 18px 42px rgba(0,0,0,.24)" } }), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, fontWeight: 500, letterSpacing: ".1em", textTransform: "uppercase", color: "rgba(255,255,255,.7)", marginTop: 10 } }, it.seat === "admin" ? "Admin" : `Table ${it.seat}`), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 4 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 5, height: 5, borderRadius: "50%", background: SWATCH[it.color] || "#777", flexShrink: 0 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, fontWeight: 500, letterSpacing: ".14em", textTransform: "uppercase", color: "rgba(255,255,255,.48)" } }, it.color))))))), expanded && /* @__PURE__ */ React.createElement("div", { onClick: () => setExpanded(null), style: { position: "fixed", inset: 0, background: "rgba(3,7,21,.96)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 30, gap: 24 } }, /* @__PURE__ */ React.createElement(AppBackdrop, { soft: true }), /* @__PURE__ */ React.createElement("img", { src: expanded.url, alt: "", style: { position: "relative", zIndex: 2, maxWidth: "80vw", maxHeight: "60vh", borderRadius: "50%", boxShadow: "0 0 0 1px rgba(255,255,255,.12),0 24px 70px rgba(0,0,0,.38)" } }), /* @__PURE__ */ React.createElement("div", { className: "display", style: { position: "relative", zIndex: 2, fontSize: 48, color: "#fff" } }, expanded.seat === "admin" ? "Admin" : `Table ${expanded.seat}`)), showNamePrompt && /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", inset: 0, background: "rgba(3,7,21,.74)", backdropFilter: "blur(20px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 50, animation: "fadeIn 0.4s ease" } }, /* @__PURE__ */ React.createElement(AppBackdrop, { soft: true }), /* @__PURE__ */ React.createElement("div", { className: "glass-card", style: { position: "relative", zIndex: 2, padding: "44px 36px", maxWidth: 400, width: "100%", textAlign: "center" } }, !disambigList ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(BrandLogo, { small: true }), /* @__PURE__ */ React.createElement("span", { className: "label", style: { display: "block", margin: "30px 0 22px", color: "rgba(255,255,255,.78)" } }, "Identification"), /* @__PURE__ */ React.createElement("p", { className: "display", style: { fontSize: 34, margin: "0 0 32px", lineHeight: 1.05 } }, "What's your", /* @__PURE__ */ React.createElement("br", null), /* @__PURE__ */ React.createElement("span", { className: "script", style: { color: "rgba(255,255,255,.78)" } }, "name?")), /* @__PURE__ */ React.createElement("input", { className: "name-input", type: "text", value: nameInput, onChange: (e) => setNameInput(e.target.value), onKeyDown: (e) => {
      if (e.key === "Enter") handleNameSubmit();
    }, placeholder: "Full name", autoFocus: true }), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 36, display: "flex", flexDirection: "column", gap: 10 } }, /* @__PURE__ */ React.createElement("button", { className: "btn-cyan", style: { width: "100%" }, onClick: handleNameSubmit, disabled: !nameInput.trim() }, "Continue"), /* @__PURE__ */ React.createElement("button", { className: "btn-ghost", style: { width: "100%" }, onClick: () => {
      setShowNamePrompt(false);
      setNameInput("");
    } }, "Cancel"))) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "label", style: { display: "block", marginBottom: 16, color: "rgba(255,255,255,.78)" } }, "Which one?"), /* @__PURE__ */ React.createElement("p", { className: "display", style: { fontSize: 26, margin: "0 0 28px", fontStyle: "italic", color: "rgba(255,255,255,.78)" } }, "We found a few matches"), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 20 } }, disambigList.map((entry, i) => /* @__PURE__ */ React.createElement("button", { key: i, className: "disambig-btn", onClick: () => chooseDisambig(entry) }, entry.name))), /* @__PURE__ */ React.createElement("button", { className: "btn-ghost", style: { width: "100%" }, onClick: () => setDisambigList(null) }, "Back")))), showExplainer && /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", inset: 0, background: "rgba(3,7,21,.74)", backdropFilter: "blur(16px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 40 } }, /* @__PURE__ */ React.createElement(AppBackdrop, { soft: true }), /* @__PURE__ */ React.createElement("div", { className: "glass-card", style: { position: "relative", zIndex: 2, padding: "44px 36px", maxWidth: 340, textAlign: "center", width: "100%" } }, /* @__PURE__ */ React.createElement(BrandLogo, { small: true }), /* @__PURE__ */ React.createElement("div", { style: { margin: "32px auto 24px", width: 58, height: 38, display: "flex", alignItems: "center", justifyContent: "center" } }, /* @__PURE__ */ React.createElement(EyeGlyph, null)), /* @__PURE__ */ React.createElement("span", { className: "label", style: { display: "block", marginBottom: 12 } }, "Camera Required"), /* @__PURE__ */ React.createElement("p", { className: "body-copy-small", style: { margin: "0 0 36px" } }, "The scan uses your camera to capture your iris and reveal your table number."), /* @__PURE__ */ React.createElement("button", { className: "btn-cyan", style: { width: "100%", marginBottom: 10 }, onClick: () => {
      setShowExplainer(false);
      setScreen("capture");
    } }, "Allow Camera"), /* @__PURE__ */ React.createElement("button", { className: "btn-ghost", style: { width: "100%" }, onClick: () => setShowExplainer(false) }, "Cancel"))));
  }
  ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(IrisLens));
})();
