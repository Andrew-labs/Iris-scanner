const { useRef, useState, useEffect, useCallback } = React;

// ---- MediaPipe loaded globally as window.visionTasks (see index.html) ----
const CDN_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const R_IRIS = [469, 470, 471, 472];
const HOLD_MS = 1200;
const ALIGN_TOL = 0.1;
const CROP = 512; // input crop sent to the model

function classifyColor(h, s, l) {
  if (l < 0.18) return "dark brown";
  if (l < 0.32 && (h < 40 || h > 330)) return "brown";
  if (h >= 35 && h < 55 && s > 0.3) return "amber";
  if (h >= 55 && h < 90 && s > 0.18) return "hazel";
  if (h >= 90 && h < 165) return "green";
  if (h >= 165 && h < 205) return "blue-gray";
  if (h >= 205 && h < 255) return "blue";
  if (s < 0.12) return "gray";
  return "brown";
}
const SWATCH = {
  "dark brown": "#3b2417", brown: "#6b4226", amber: "#c08a2e", hazel: "#8a7a3a",
  green: "#3f7a54", "blue-gray": "#5f7d8a", blue: "#3f6fb0", gray: "#7a7d82",
};

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
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

function IrisLens() {
  const [screen, setScreen] = useState("home");
  const [status, setStatus] = useState("Center your eye in the ring");
  const [permError, setPermError] = useState(null);
  const [showExplainer, setShowExplainer] = useState(false);
  const [result, setResult] = useState(null);
  const [gallery, setGallery] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [procMsg, setProcMsg] = useState("Reading your iris…");
  const [genError, setGenError] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const landmarkerRef = useRef(null);
  const rafRef = useRef(null);
  const holdStartRef = useRef(null);
  const capturedRef = useRef(false);
  const lastCropRef = useRef(null);

  const loadLandmarker = useCallback(async () => {
    if (landmarkerRef.current) return landmarkerRef.current;
    let vision = window.visionTasks;
    if (!vision) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("MediaPipe failed to load")), 20000);
        window.addEventListener("mp-ready", () => { clearTimeout(t); resolve(); }, { once: true });
      });
      vision = window.visionTasks;
    }
    const { FaceLandmarker, FilesetResolver } = vision;
    const fileset = await FilesetResolver.forVisionTasks(CDN_WASM);
    const lm = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: false,
    });
    landmarkerRef.current = lm;
    return lm;
  }, []);

  const startCamera = useCallback(async () => {
    setPermError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      await loadLandmarker();
      capturedRef.current = false;
      holdStartRef.current = null;
      loop();
    } catch (e) {
      if (e.name === "NotAllowedError")
        setPermError("Camera access was blocked. Enable it in your browser settings, then try again.");
      else if (e.name === "NotFoundError")
        setPermError("No camera found on this device.");
      else setPermError("Could not start the camera: " + e.message);
    }
  }, [loadLandmarker]);

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const loop = useCallback(() => {
    const video = videoRef.current;
    const lm = landmarkerRef.current;
    if (!video || !lm || video.readyState < 2 || capturedRef.current) {
      rafRef.current = requestAnimationFrame(loop);
      return;
    }
    let res;
    try { res = lm.detectForVideo(video, performance.now()); }
    catch { rafRef.current = requestAnimationFrame(loop); return; }

    if (!res.faceLandmarks || res.faceLandmarks.length === 0) {
      setStatus("Center your eye in the ring");
      holdStartRef.current = null;
    } else {
      const pts = res.faceLandmarks[0];
      const iris = R_IRIS.map((i) => pts[i]);
      const cx = iris.reduce((a, p) => a + p.x, 0) / 4;
      const cy = iris.reduce((a, p) => a + p.y, 0) / 4;
      const rad = Math.max(...iris.map((p) => Math.hypot(p.x - cx, p.y - cy)));
      const dist = Math.hypot(cx - 0.5, cy - 0.5);

      if (dist > ALIGN_TOL * 1.6) { setStatus("Center your eye"); holdStartRef.current = null; }
      else if (rad < 0.018) { setStatus("Move a little closer"); holdStartRef.current = null; }
      else if (rad > 0.09) { setStatus("Move back slightly"); holdStartRef.current = null; }
      else if (dist > ALIGN_TOL) { setStatus("Almost — hold center"); holdStartRef.current = null; }
      else {
        if (!holdStartRef.current) holdStartRef.current = performance.now();
        if (performance.now() - holdStartRef.current >= HOLD_MS) {
          capturedRef.current = true;
          capture(cx, cy, rad);
          return;
        }
        setStatus("Hold steady…");
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  // Crop the eye region, detect colour, send to the model.
  const capture = useCallback((ncx, ncy, nrad) => {
    const video = videoRef.current;
    const vw = video.videoWidth, vh = video.videoHeight;
    const pad = 3.2; // include a bit of eye around the iris to give the model context
    const radPx = nrad * vw * pad;
    const cxPx = ncx * vw, cyPx = ncy * vh;

    const c = document.createElement("canvas");
    c.width = CROP; c.height = CROP;
    const ctx = c.getContext("2d");
    ctx.drawImage(video, cxPx - radPx, cyPx - radPx, radPx * 2, radPx * 2, 0, 0, CROP, CROP);

    // sample colour from the inner region
    const img = ctx.getImageData(0, 0, CROP, CROP).data;
    const cxp = CROP / 2, cyp = CROP / 2, innerR = CROP * 0.18;
    let hs = 0, ss = 0, ls = 0, n = 0;
    for (let y = 0; y < CROP; y += 2) {
      for (let x = 0; x < CROP; x += 2) {
        const dx = x - cxp, dy = y - cyp;
        if (dx * dx + dy * dy < innerR * innerR) {
          const i = (y * CROP + x) * 4;
          const [h, s, l] = rgbToHsl(img[i], img[i + 1], img[i + 2]);
          hs += h; ss += s; ls += l; n++;
        }
      }
    }
    const colorLabel = classifyColor(hs / n, ss / n, ls / n);
    const dataUrl = c.toDataURL("image/jpeg", 0.9);
    lastCropRef.current = dataUrl;
    stopCamera();
    setGenError(null);
    setScreen("processing");
    generate(dataUrl, colorLabel);
  }, [stopCamera]);

  // Call Netlify functions: start prediction, then poll.
  const generate = useCallback(async (dataUrl, colorLabel) => {
    const msgs = ["Reading your iris…", "Mapping the fibres…", "Rendering in macro detail…", "Adding the final light…"];
    let mi = 0;
    setProcMsg(msgs[0]);
    const msgTimer = setInterval(() => { mi = (mi + 1) % msgs.length; setProcMsg(msgs[mi]); }, 2500);

    try {
      const startRes = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl, colorLabel }),
      });
      const start = await startRes.json();
      if (!startRes.ok || !start.id) throw new Error(start.error || "Could not start generation");

      let output = null;
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((r) => setTimeout(r, 1500));
        const pRes = await fetch("/api/poll?id=" + encodeURIComponent(start.id));
        const p = await pRes.json();
        if (p.status === "succeeded" && p.output) { output = p.output; break; }
        if (p.status === "failed" || p.status === "canceled") {
          throw new Error(p.error || "Generation failed");
        }
      }
      clearInterval(msgTimer);
      if (!output) throw new Error("Generation timed out. Please try again.");

      const item = { url: output, color: colorLabel, date: new Date().toLocaleDateString() };
      setResult(item);
      setGallery((g) => [item, ...g]);
      setScreen("results");
    } catch (e) {
      clearInterval(msgTimer);
      setGenError(String(e.message || e));
      setScreen("processing");
    }
  }, []);

  useEffect(() => {
    if (screen === "capture") startCamera();
    return () => { if (screen === "capture") stopCamera(); };
  }, [screen]);

  const confirmCapture = () => { setShowExplainer(false); setScreen("capture"); };

  const saveImage = async () => {
    if (!result) return;
    try {
      const blob = await (await fetch(result.url)).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `irislens-${Date.now()}.png`; a.click();
      URL.revokeObjectURL(url);
    } catch { window.open(result.url, "_blank"); }
  };

  const shareImage = async () => {
    if (!result) return;
    try {
      const blob = await (await fetch(result.url)).blob();
      const file = new File([blob], "iris.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] }))
        await navigator.share({ files: [file], title: "My iris — IrisLens" });
      else { await navigator.clipboard.writeText(result.url); setStatus("Link copied"); }
    } catch {}
  };

  const cyan = "#00d4ff";

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e8ecf2", fontFamily: "Inter, Roboto, system-ui, sans-serif", overflowX: "hidden" }}>
      <style>{`
        @keyframes pulse { 0%,100%{ box-shadow:0 0 0 0 rgba(0,212,255,.5);} 50%{ box-shadow:0 0 30px 6px rgba(0,212,255,.6);} }
        @keyframes spin { to { transform: rotate(360deg);} }
        @keyframes glow { 0%,100%{ opacity:.5 } 50%{ opacity:1 } }
        .btn { min-height:48px; border:none; border-radius:999px; font-weight:600; font-size:16px; cursor:pointer; transition:.2s; font-family:inherit; }
        .btn-primary { background:${cyan}; color:#04222b; box-shadow:0 0 24px rgba(0,212,255,.4);}
        .btn-ghost { background:rgba(255,255,255,.06); color:#cfe9f5; border:1px solid rgba(0,212,255,.25);}
        @media (prefers-reduced-motion: reduce){ *{ animation:none !important } }
      `}</style>

      {screen === "home" && (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px", textAlign: "center" }}>
          <div style={{ width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle at 40% 35%, #2a6b8a, #0a2330 60%, #05121a)", border: `2px solid ${cyan}`, animation: "pulse 3s infinite", marginBottom: 36, position: "relative" }}>
            <div style={{ position: "absolute", inset: "32%", borderRadius: "50%", background: "#05080c", boxShadow: `inset 0 0 30px rgba(0,212,255,.5)` }} />
          </div>
          <h1 style={{ fontSize: 40, fontWeight: 800, margin: 0, letterSpacing: "-1px" }}>Iris<span style={{ color: cyan }}>Lens</span></h1>
          <p style={{ color: "#8a97a6", margin: "12px 0 40px", fontSize: 17 }}>See your iris like never before.</p>
          <button className="btn btn-primary" style={{ padding: "16px 40px" }} onClick={() => setShowExplainer(true)}>Capture My Iris</button>
          <button className="btn btn-ghost" style={{ padding: "12px 28px", marginTop: 16 }} onClick={() => setScreen("gallery")}>View Gallery</button>
        </div>
      )}

      {screen === "capture" && (
        <div style={{ position: "fixed", inset: 0, background: "#000" }}>
          <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
          <div style={{ position: "absolute", top: "50%", left: "50%", width: "min(70vw,300px)", height: "min(70vw,300px)", transform: "translate(-50%,-55%)", borderRadius: "50%", border: `3px solid ${cyan}`, animation: "pulse 2s infinite", pointerEvents: "none" }} />
          {!permError && (
            <div style={{ position: "absolute", top: "calc(50% + 175px)", left: 0, right: 0, textAlign: "center", color: cyan, fontSize: 18, fontWeight: 600, textShadow: "0 0 12px rgba(0,0,0,.9)" }}>{status}</div>
          )}
          {permError && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center", background: "rgba(5,8,12,.92)" }}>
              <p style={{ fontSize: 17, marginBottom: 24 }}>{permError}</p>
              <button className="btn btn-primary" style={{ padding: "14px 32px" }} onClick={startCamera}>Try Again</button>
              <button className="btn btn-ghost" style={{ padding: "12px 28px", marginTop: 14 }} onClick={() => setScreen("home")}>Back</button>
            </div>
          )}
          <div style={{ position: "absolute", bottom: "max(28px, env(safe-area-inset-bottom))", left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 28 }}>
            <button className="btn btn-ghost" style={{ width: 48, height: 48, padding: 0 }} onClick={() => setScreen("home")}>✕</button>
          </div>
        </div>
      )}

      {screen === "processing" && (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center" }}>
          {!genError ? (
            <>
              <div style={{ width: 120, height: 120, borderRadius: "50%", border: `3px solid rgba(0,212,255,.2)`, borderTopColor: cyan, animation: "spin 1s linear infinite" }} />
              <p style={{ color: cyan, marginTop: 28, animation: "glow 1.5s infinite" }}>{procMsg}</p>
              <p style={{ color: "#5a6676", fontSize: 13, marginTop: 8 }}>This can take up to 30 seconds</p>
            </>
          ) : (
            <>
              <p style={{ fontSize: 16, color: "#e8ecf2", marginBottom: 8 }}>Something went wrong</p>
              <p style={{ color: "#8a97a6", fontSize: 14, marginBottom: 24, maxWidth: 320 }}>{genError}</p>
              <button className="btn btn-primary" style={{ padding: "14px 32px" }} onClick={() => {
                if (lastCropRef.current) { setGenError(null); generate(lastCropRef.current, result?.color || "natural"); }
                else setScreen("capture");
              }}>Try Again</button>
              <button className="btn btn-ghost" style={{ padding: "12px 28px", marginTop: 12 }} onClick={() => setScreen("home")}>Home</button>
            </>
          )}
        </div>
      )}

      {screen === "results" && result && (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 24px" }}>
          <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(0,212,255,.18)", borderRadius: 28, padding: 24, width: "100%", maxWidth: 420, textAlign: "center" }}>
            <img src={result.url} alt="Your iris" style={{ width: "100%", maxWidth: 340, borderRadius: "50%", boxShadow: `0 0 40px rgba(0,212,255,.3)` }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, margin: "22px 0 4px" }}>
              <span style={{ width: 18, height: 18, borderRadius: "50%", background: SWATCH[result.color] || "#777", border: "2px solid rgba(255,255,255,.3)" }} />
              <span style={{ fontSize: 22, fontWeight: 700, textTransform: "capitalize" }}>{result.color}</span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, width: "100%", maxWidth: 420, marginTop: 24 }}>
            <button className="btn btn-primary" style={{ padding: "14px" }} onClick={saveImage}>Save Image</button>
            <button className="btn btn-ghost" style={{ padding: "14px" }} onClick={shareImage}>Share</button>
            <button className="btn btn-ghost" style={{ padding: "14px" }} onClick={() => setScreen("capture")}>Capture Again</button>
            <button className="btn btn-ghost" style={{ padding: "14px" }} onClick={() => setScreen("gallery")}>View Gallery</button>
          </div>
        </div>
      )}

      {screen === "gallery" && (
        <div style={{ minHeight: "100vh", padding: "32px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <h2 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Gallery</h2>
            <button className="btn btn-ghost" style={{ padding: "10px 20px" }} onClick={() => setScreen("home")}>Home</button>
          </div>
          {gallery.length === 0 ? (
            <div style={{ textAlign: "center", color: "#7a8696", marginTop: 80 }}>
              <p>No captures yet. Your iris portraits will appear here.</p>
              <button className="btn btn-primary" style={{ padding: "14px 32px", marginTop: 16 }} onClick={() => setShowExplainer(true)}>Capture My Iris</button>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 16 }}>
              {gallery.map((it, i) => (
                <div key={i} onClick={() => setExpanded(it)} style={{ cursor: "pointer", textAlign: "center" }}>
                  <img src={it.url} alt="" style={{ width: "100%", borderRadius: "50%", border: "1px solid rgba(0,212,255,.2)" }} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8, fontSize: 13, textTransform: "capitalize" }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: SWATCH[it.color] || "#777" }} />
                    {it.color}
                  </div>
                  <div style={{ fontSize: 11, color: "#6a7686" }}>{it.date}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {expanded && (
        <div onClick={() => setExpanded(null)} style={{ position: "fixed", inset: 0, background: "rgba(5,8,12,.95)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 30 }}>
          <img src={expanded.url} alt="" style={{ maxWidth: "90vw", maxHeight: "80vh", borderRadius: "50%", boxShadow: `0 0 50px rgba(0,212,255,.4)` }} />
        </div>
      )}

      {showExplainer && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(5,8,12,.9)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 40 }}>
          <div style={{ background: "#0f1620", border: "1px solid rgba(0,212,255,.25)", borderRadius: 24, padding: 28, maxWidth: 360, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>👁️</div>
            <h3 style={{ margin: "0 0 10px", fontSize: 20 }}>Camera access needed</h3>
            <p style={{ color: "#8a97a6", fontSize: 15, lineHeight: 1.5, margin: "0 0 24px" }}>
              IrisLens uses your camera to guide you to the perfect eye shot, then renders it into a detailed iris portrait.
            </p>
            <button className="btn btn-primary" style={{ padding: "14px 32px", width: "100%" }} onClick={confirmCapture}>Allow Camera</button>
            <button className="btn btn-ghost" style={{ padding: "12px", width: "100%", marginTop: 10 }} onClick={() => setShowExplainer(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(IrisLens));
