const { useRef, useState, useEffect, useCallback } = React;

const CDN_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const R_IRIS = [469, 470, 471, 472];
const HOLD_MS = 1200;
const ALIGN_TOL = 0.1;
const CROP = 512;

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
  "dark brown":"#3b2417", brown:"#6b4226", amber:"#c08a2e", hazel:"#8a7a3a",
  green:"#3f7a54", "blue-gray":"#5f7d8a", blue:"#3f6fb0", gray:"#7a7d82",
};

function rgbToHsl(r,g,b){
  r/=255;g/=255;b/=255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b);
  let h=0,s=0;const l=(max+min)/2;
  if(max!==min){
    const d=max-min;
    s=l>0.5?d/(2-max-min):d/(max+min);
    if(max===r)h=(g-b)/d+(g<b?6:0);
    else if(max===g)h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h*=60;
  }
  return[h,s,l];
}

// HUD Overlay SVG — scan rings, tick marks, brackets, data readouts
function HudOverlay({ state }) {
  // state: "searching" | "aligning" | "locking" | "capturing"
  const cyan = "#00d4ff";
  const dim = "rgba(0,212,255,0.3)";
  const mid = "rgba(0,212,255,0.6)";

  const lockColor = state === "locking" || state === "capturing" ? cyan : dim;
  const ringOpacity = state === "capturing" ? 1 : 0.7;

  // Generate tick marks around the outer ring
  const ticks = [];
  for (let i = 0; i < 72; i++) {
    const angle = (i * 5) * Math.PI / 180;
    const isMajor = i % 9 === 0;
    const r1 = isMajor ? 152 : 156;
    const r2 = 162;
    const x1 = 200 + r1 * Math.cos(angle);
    const y1 = 200 + r1 * Math.sin(angle);
    const x2 = 200 + r2 * Math.cos(angle);
    const y2 = 200 + r2 * Math.sin(angle);
    ticks.push(
      <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={isMajor ? cyan : dim}
        strokeWidth={isMajor ? 1.5 : 0.8}
        opacity={ringOpacity} />
    );
  }

  return (
    <svg viewBox="0 0 400 400" style={{
      position:"absolute", top:"50%", left:"50%",
      width:"min(88vw,380px)", height:"min(88vw,380px)",
      transform:"translate(-50%,-55%)", pointerEvents:"none",
      overflow:"visible"
    }}>
      {/* Outer tick ring */}
      {ticks}

      {/* Outer measurement ring */}
      <circle cx="200" cy="200" r="162" fill="none" stroke={dim} strokeWidth="1" strokeDasharray="4 3" opacity={ringOpacity} />

      {/* Secondary ring */}
      <circle cx="200" cy="200" r="142" fill="none" stroke={lockColor} strokeWidth="1" opacity="0.5" />

      {/* Main guide ring */}
      <circle cx="200" cy="200" r="120" fill="none" stroke={lockColor} strokeWidth="2.5"
        strokeDasharray={state === "locking" ? "30 8" : state === "capturing" ? "none" : "60 20"}
        style={{transition:"all 0.4s"}} />

      {/* Inner detail ring */}
      <circle cx="200" cy="200" r="96" fill="none" stroke={dim} strokeWidth="1" strokeDasharray="3 6" />

      {/* Corner brackets — top left */}
      <path d="M 56 100 L 56 56 L 100 56" fill="none" stroke={cyan} strokeWidth="2" opacity={ringOpacity} />
      {/* top right */}
      <path d="M 300 56 L 344 56 L 344 100" fill="none" stroke={cyan} strokeWidth="2" opacity={ringOpacity} />
      {/* bottom left */}
      <path d="M 56 300 L 56 344 L 100 344" fill="none" stroke={cyan} strokeWidth="2" opacity={ringOpacity} />
      {/* bottom right */}
      <path d="M 300 344 L 344 344 L 344 300" fill="none" stroke={cyan} strokeWidth="2" opacity={ringOpacity} />

      {/* Crosshair lines */}
      <line x1="200" y1="72" x2="200" y2="88" stroke={mid} strokeWidth="1.5" />
      <line x1="200" y1="312" x2="200" y2="328" stroke={mid} strokeWidth="1.5" />
      <line x1="72" y1="200" x2="88" y2="200" stroke={mid} strokeWidth="1.5" />
      <line x1="312" y1="200" x2="328" y2="200" stroke={mid} strokeWidth="1.5" />

      {/* Data readouts */}
      <text x="108" y="52" fill={cyan} fontSize="9" fontFamily="Inter, monospace" opacity="0.7">IRIS.SCAN</text>
      <text x="264" y="52" fill={cyan} fontSize="9" fontFamily="Inter, monospace" opacity="0.7" textAnchor="end">v2.4</text>
      <text x="56" y="360" fill={cyan} fontSize="8" fontFamily="Inter, monospace" opacity="0.6">LAT: {state === "capturing" ? "LOCKED" : "—"}</text>
      <text x="344" y="360" fill={cyan} fontSize="8" fontFamily="Inter, monospace" opacity="0.6" textAnchor="end">
        {state === "capturing" ? "CAPTURED" : state === "locking" ? "LOCKING..." : "SCANNING"}
      </text>

      {/* Lock indicators — 4 corner pips on the main ring */}
      {[0, 90, 180, 270].map(deg => {
        const a = deg * Math.PI / 180;
        return (
          <circle key={deg}
            cx={200 + 120 * Math.cos(a)} cy={200 + 120 * Math.sin(a)}
            r="4" fill={state === "locking" || state === "capturing" ? cyan : "none"}
            stroke={cyan} strokeWidth="1.5" opacity={ringOpacity}
          />
        );
      })}

      {/* Capture flash ring */}
      {state === "capturing" && (
        <circle cx="200" cy="200" r="120" fill="none" stroke={cyan} strokeWidth="6" opacity="0.9"
          style={{animation:"captureFlash 0.4s ease-out forwards"}} />
      )}
    </svg>
  );
}

function IrisLens() {
  const [screen, setScreen] = useState("home");
  const [status, setStatus] = useState("Center your eye in the ring");
  const [hudState, setHudState] = useState("searching");
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
  const lastColorRef = useRef("natural");

  const loadLandmarker = useCallback(async () => {
    if (landmarkerRef.current) return landmarkerRef.current;
    let vision = window.visionTasks;
    if (!vision) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("MediaPipe load timeout")), 20000);
        window.addEventListener("mp-ready", () => { clearTimeout(t); resolve(); }, { once: true });
      });
      vision = window.visionTasks;
    }
    const { FaceLandmarker, FilesetResolver } = vision;
    const fileset = await FilesetResolver.forVisionTasks(CDN_WASM);
    const lm = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: false,
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
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      await loadLandmarker();
      capturedRef.current = false;
      holdStartRef.current = null;
      setHudState("searching");
      loop();
    } catch (e) {
      if (e.name === "NotAllowedError") setPermError("Camera access blocked. Enable it in browser settings.");
      else if (e.name === "NotFoundError") setPermError("No camera found on this device.");
      else setPermError("Could not start camera: " + e.message);
    }
  }, [loadLandmarker]);

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const loop = useCallback(() => {
    const video = videoRef.current, lm = landmarkerRef.current;
    if (!video || !lm || video.readyState < 2 || capturedRef.current) {
      rafRef.current = requestAnimationFrame(loop); return;
    }
    let res;
    try { res = lm.detectForVideo(video, performance.now()); }
    catch { rafRef.current = requestAnimationFrame(loop); return; }

    if (!res.faceLandmarks || !res.faceLandmarks.length) {
      setStatus("Position your eye within the ring");
      setHudState("searching");
      holdStartRef.current = null;
    } else {
      const pts = res.faceLandmarks[0];
      const iris = R_IRIS.map(i => pts[i]);
      const cx = iris.reduce((a,p)=>a+p.x,0)/4;
      const cy = iris.reduce((a,p)=>a+p.y,0)/4;
      const rad = Math.max(...iris.map(p=>Math.hypot(p.x-cx,p.y-cy)));
      const dist = Math.hypot(cx-0.5, cy-0.5);

      if (dist > ALIGN_TOL*1.6) { setStatus("Center your eye"); setHudState("searching"); holdStartRef.current=null; }
      else if (rad < 0.018) { setStatus("Move closer"); setHudState("searching"); holdStartRef.current=null; }
      else if (rad > 0.09) { setStatus("Move back slightly"); setHudState("searching"); holdStartRef.current=null; }
      else if (dist > ALIGN_TOL) { setStatus("Align to center"); setHudState("aligning"); holdStartRef.current=null; }
      else {
        if (!holdStartRef.current) holdStartRef.current = performance.now();
        const held = performance.now() - holdStartRef.current;
        if (held >= HOLD_MS) {
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
    const video = videoRef.current;
    const vw = video.videoWidth, vh = video.videoHeight;
    const pad = 3.2;
    const radPx = nrad * vw * pad;
    const cxPx = ncx * vw, cyPx = ncy * vh;
    const c = document.createElement("canvas");
    c.width = CROP; c.height = CROP;
    const ctx = c.getContext("2d");
    ctx.drawImage(video, cxPx-radPx, cyPx-radPx, radPx*2, radPx*2, 0, 0, CROP, CROP);
    const img = ctx.getImageData(0,0,CROP,CROP).data;
    const cxp=CROP/2, cyp=CROP/2, innerR=CROP*0.18;
    let hs=0,ss=0,ls=0,n=0;
    for(let y=0;y<CROP;y+=2) for(let x=0;x<CROP;x+=2){
      const dx=x-cxp,dy=y-cyp;
      if(dx*dx+dy*dy<innerR*innerR){
        const i=(y*CROP+x)*4;
        const [h,s,l]=rgbToHsl(img[i],img[i+1],img[i+2]);
        hs+=h;ss+=s;ls+=l;n++;
      }
    }
    const colorLabel = classifyColor(hs/n,ss/n,ls/n);
    const dataUrl = c.toDataURL("image/jpeg",0.9);
    lastCropRef.current = dataUrl;
    lastColorRef.current = colorLabel;
    stopCamera();
    setGenError(null);
    setScreen("processing");
    generate(dataUrl, colorLabel);
  }, [stopCamera]);

  const generate = useCallback(async (dataUrl, colorLabel) => {
    const msgs = ["Reading iris geometry…","Mapping fibre patterns…","Rendering macro detail…","Finalising your portrait…"];
    let mi = 0; setProcMsg(msgs[0]);
    const t = setInterval(() => { mi=(mi+1)%msgs.length; setProcMsg(msgs[mi]); }, 2800);
    try {
      const startRes = await fetch("/api/generate", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ imageDataUrl:dataUrl, colorLabel }),
      });
      const start = await startRes.json();
      if (!startRes.ok || !start.id) throw new Error(start.error || "Could not start generation");
      let output = null;
      for (let i=0;i<60;i++) {
        await new Promise(r=>setTimeout(r,1500));
        const pRes = await fetch("/api/poll?id="+encodeURIComponent(start.id));
        const p = await pRes.json();
        if (p.status==="succeeded" && p.output) { output=p.output; break; }
        if (p.status==="failed"||p.status==="canceled") throw new Error(p.error||"Generation failed");
      }
      clearInterval(t);
      if (!output) throw new Error("Generation timed out. Please try again.");
      const item = { url:output, color:colorLabel, date:new Date().toLocaleDateString() };
      setResult(item);
      setGallery(g=>[item,...g]);
      setScreen("results");
    } catch(e) {
      clearInterval(t);
      setGenError(String(e.message||e));
    }
  }, []);

  useEffect(() => {
    if (screen==="capture") startCamera();
    return () => { if (screen==="capture") stopCamera(); };
  }, [screen]);

  const cyan = "#00d4ff";

  return (
    <div style={{minHeight:"100vh",background:"#0a0a0f",color:"#e8ecf2",fontFamily:"Inter, Roboto, system-ui, sans-serif",overflowX:"hidden"}}>
      <style>{`
        @keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(0,212,255,.4);}50%{box-shadow:0 0 28px 5px rgba(0,212,255,.55);} }
        @keyframes spin { to{transform:rotate(360deg);} }
        @keyframes glow { 0%,100%{opacity:.4}50%{opacity:1} }
        @keyframes scanline { 0%{transform:translateY(-100%);opacity:0;}20%{opacity:1;}80%{opacity:1;}100%{transform:translateY(100%);opacity:0;} }
        @keyframes captureFlash { 0%{opacity:1;r:120}100%{opacity:0;r:160} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(24px);}to{opacity:1;transform:translateY(0);} }
        .btn{min-height:48px;border:none;border-radius:4px;font-weight:600;font-size:15px;cursor:pointer;transition:.2s;font-family:inherit;letter-spacing:.04em;}
        .btn-primary{background:${cyan};color:#03181f;box-shadow:0 0 20px rgba(0,212,255,.35);}
        .btn-primary:hover{box-shadow:0 0 32px rgba(0,212,255,.6);}
        .btn-ghost{background:transparent;color:#cfe9f5;border:1px solid rgba(0,212,255,.3);}
        .btn-ghost:hover{border-color:${cyan};background:rgba(0,212,255,.06);}
        @media(prefers-reduced-motion:reduce){*{animation:none!important}}
      `}</style>

      {/* ── HOME ── */}
      {screen==="home" && (
        <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",position:"relative",overflow:"hidden"}}>
          {/* Hero image — fills top ~65% */}
          <div style={{flex:"0 0 62vh",position:"relative",overflow:"hidden"}}>
            <img src="/hero.jpg" alt="" style={{
              width:"100%",height:"100%",objectFit:"cover",objectPosition:"center top",
              display:"block",filter:"brightness(0.88)"
            }} />
            {/* gradient fade to dark at the bottom */}
            <div style={{position:"absolute",bottom:0,left:0,right:0,height:"55%",
              background:"linear-gradient(to bottom, transparent, #0a0a0f)"}} />
            {/* Top bar */}
            <div style={{position:"absolute",top:0,left:0,right:0,padding:"20px 28px",
              display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span style={{fontSize:20,fontWeight:800,letterSpacing:"-0.5px"}}>
                Iris<span style={{color:cyan}}>Lens</span>
              </span>
              <button className="btn btn-ghost" style={{padding:"8px 16px",fontSize:13}}
                onClick={()=>setScreen("gallery")}>Gallery</button>
            </div>
          </div>

          {/* Content below the fold */}
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"flex-start",
            justifyContent:"flex-end",padding:"0 28px 48px",marginTop:"-60px",position:"relative",
            animation:"fadeUp 0.6s ease-out forwards"}}>
            <p style={{fontSize:11,fontWeight:600,letterSpacing:"0.2em",color:cyan,margin:"0 0 10px",textTransform:"uppercase"}}>
              AI Iris Portrait
            </p>
            <h1 style={{fontSize:"clamp(30px,7vw,42px)",fontWeight:800,lineHeight:1.1,
              margin:"0 0 12px",letterSpacing:"-1px"}}>
              See your iris<br />like never before.
            </h1>
            <p style={{color:"#8a97a6",fontSize:15,lineHeight:1.6,margin:"0 0 32px",maxWidth:340}}>
              Advanced iris detection renders your unique eye structure in hyperreal macro detail.
            </p>
            <button className="btn btn-primary"
              style={{padding:"16px 36px",fontSize:16,borderRadius:"4px",width:"100%",maxWidth:380}}
              onClick={()=>setShowExplainer(true)}>
              Capture My Iris
            </button>
          </div>
        </div>
      )}

      {/* ── CAPTURE ── */}
      {screen==="capture" && (
        <div style={{position:"fixed",inset:0,background:"#000"}}>
          <video ref={videoRef} autoPlay playsInline muted
            style={{width:"100%",height:"100%",objectFit:"cover",transform:"scaleX(-1)"}} />

          {/* Dark vignette overlay */}
          <div style={{position:"absolute",inset:0,
            background:"radial-gradient(ellipse 60% 55% at 50% 42%, transparent 40%, rgba(0,0,0,0.75) 100%)",
            pointerEvents:"none"}} />

          {!permError && <HudOverlay state={hudState} />}

          {/* Scanline animation across the guide ring */}
          {!permError && (hudState==="locking"||hudState==="aligning") && (
            <div style={{
              position:"absolute",top:"50%",left:"50%",
              width:"min(67vw,280px)",height:"2px",
              transform:"translate(-50%,-55%)",
              background:`linear-gradient(to right, transparent, ${cyan}, transparent)`,
              animation:"scanline 1.8s ease-in-out infinite",
              pointerEvents:"none",opacity:0.7,
            }} />
          )}

          {/* Status text */}
          {!permError && (
            <div style={{
              position:"absolute",bottom:"max(120px,15vh)",left:0,right:0,
              textAlign:"center",
            }}>
              <span style={{
                fontSize:13,fontWeight:600,letterSpacing:"0.18em",
                textTransform:"uppercase",color:cyan,
                textShadow:"0 0 20px rgba(0,212,255,0.8)",
              }}>{status}</span>
            </div>
          )}

          {permError && (
            <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",
              alignItems:"center",justifyContent:"center",padding:32,textAlign:"center",
              background:"rgba(5,8,12,.92)"}}>
              <p style={{fontSize:16,marginBottom:24,maxWidth:320}}>{permError}</p>
              <button className="btn btn-primary" style={{padding:"14px 32px"}} onClick={startCamera}>Try Again</button>
              <button className="btn btn-ghost" style={{padding:"12px 28px",marginTop:12}} onClick={()=>setScreen("home")}>Back</button>
            </div>
          )}

          {/* Bottom bar */}
          <div style={{
            position:"absolute",bottom:"max(32px,env(safe-area-inset-bottom))",
            left:0,right:0,display:"flex",alignItems:"center",justifyContent:"space-between",
            padding:"0 32px",
          }}>
            <button className="btn btn-ghost" style={{width:44,height:44,padding:0,borderRadius:"50%",fontSize:18}}
              onClick={()=>setScreen("home")}>✕</button>
            <div style={{fontSize:10,color:"rgba(0,212,255,0.5)",letterSpacing:"0.15em",textTransform:"uppercase"}}>
              {hudState==="capturing"?"Captured":hudState==="locking"?"Locking…":"Scanning"}
            </div>
            <div style={{width:44}} />
          </div>
        </div>
      )}

      {/* ── PROCESSING ── */}
      {screen==="processing" && (
        <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",
          alignItems:"center",justifyContent:"center",padding:32,textAlign:"center"}}>
          {!genError ? (
            <>
              {/* Animated scanner rings */}
              <div style={{position:"relative",width:160,height:160,marginBottom:36}}>
                <div style={{position:"absolute",inset:0,borderRadius:"50%",border:`2px solid rgba(0,212,255,0.15)`}} />
                <div style={{position:"absolute",inset:12,borderRadius:"50%",border:`1.5px dashed rgba(0,212,255,0.2)`}} />
                <div style={{position:"absolute",inset:24,borderRadius:"50%",border:`2px solid rgba(0,212,255,0.15)`}} />
                <div style={{position:"absolute",inset:0,borderRadius:"50%",
                  border:`2px solid transparent`,borderTopColor:cyan,
                  animation:"spin 1.2s linear infinite"}} />
                <div style={{position:"absolute",inset:16,borderRadius:"50%",
                  border:`1.5px solid transparent`,borderTopColor:"rgba(0,212,255,0.5)",
                  animation:"spin 2s linear infinite reverse"}} />
                <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <div style={{width:12,height:12,borderRadius:"50%",background:cyan,
                    animation:"pulse 1.5s ease-in-out infinite"}} />
                </div>
              </div>
              <p style={{color:cyan,fontSize:15,fontWeight:600,letterSpacing:"0.12em",
                textTransform:"uppercase",animation:"glow 2s infinite",marginBottom:8}}>
                {procMsg}
              </p>
              <p style={{color:"#3a4856",fontSize:12,letterSpacing:"0.08em"}}>
                AI RENDERING — UP TO 30 SECONDS
              </p>
            </>
          ) : (
            <>
              <p style={{fontSize:15,color:"#e8ecf2",marginBottom:8}}>Generation failed</p>
              <p style={{color:"#8a97a6",fontSize:13,marginBottom:28,maxWidth:300}}>{genError}</p>
              <button className="btn btn-primary" style={{padding:"14px 32px"}} onClick={()=>{
                setGenError(null);
                if(lastCropRef.current) generate(lastCropRef.current, lastColorRef.current);
                else setScreen("capture");
              }}>Try Again</button>
              <button className="btn btn-ghost" style={{padding:"12px 28px",marginTop:12}}
                onClick={()=>setScreen("home")}>Home</button>
            </>
          )}
        </div>
      )}

      {/* ── RESULTS ── */}
      {screen==="results" && result && (
        <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",
          alignItems:"center",padding:"48px 24px 40px",animation:"fadeUp 0.5s ease-out"}}>
          <p style={{fontSize:10,fontWeight:600,letterSpacing:"0.2em",color:cyan,
            textTransform:"uppercase",marginBottom:20}}>Your Iris Portrait</p>

          {/* Iris display */}
          <div style={{position:"relative",marginBottom:32}}>
            <img src={result.url} alt="Your iris"
              style={{width:"min(78vw,340px)",height:"min(78vw,340px)",borderRadius:"50%",
                objectFit:"cover",display:"block",
                boxShadow:`0 0 0 1px rgba(0,212,255,0.2), 0 0 40px rgba(0,212,255,0.15), 0 0 80px rgba(0,212,255,0.08)`}} />
            {/* Decorative ring */}
            <div style={{position:"absolute",inset:-8,borderRadius:"50%",
              border:"1px solid rgba(0,212,255,0.15)",pointerEvents:"none"}} />
            <div style={{position:"absolute",inset:-16,borderRadius:"50%",
              border:"1px dashed rgba(0,212,255,0.08)",pointerEvents:"none"}} />
          </div>

          {/* Color label */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:36}}>
            <span style={{width:12,height:12,borderRadius:"50%",
              background:SWATCH[result.color]||"#777",
              boxShadow:`0 0 8px ${SWATCH[result.color]||"#777"}`}} />
            <span style={{fontSize:13,fontWeight:600,letterSpacing:"0.15em",
              textTransform:"uppercase",color:"#9aaab8"}}>{result.color}</span>
          </div>

          {/* Actions */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,width:"100%",maxWidth:380}}>
            <button className="btn btn-primary" style={{padding:"14px"}} onClick={async()=>{
              try{
                const blob=await(await fetch(result.url)).blob();
                const url=URL.createObjectURL(blob);
                const a=document.createElement("a");
                a.href=url;a.download=`irislens-${Date.now()}.png`;a.click();
                URL.revokeObjectURL(url);
              }catch{window.open(result.url,"_blank");}
            }}>Save Image</button>
            <button className="btn btn-ghost" style={{padding:"14px"}} onClick={async()=>{
              try{
                const blob=await(await fetch(result.url)).blob();
                const file=new File([blob],"iris.png",{type:"image/png"});
                if(navigator.canShare&&navigator.canShare({files:[file]}))
                  await navigator.share({files:[file],title:"My iris — IrisLens"});
                else{await navigator.clipboard.writeText(result.url);}
              }catch{}
            }}>Share</button>
            <button className="btn btn-ghost" style={{padding:"14px",gridColumn:"1/-1"}}
              onClick={()=>setScreen("capture")}>Capture Again</button>
          </div>
        </div>
      )}

      {/* ── GALLERY ── */}
      {screen==="gallery" && (
        <div style={{minHeight:"100vh",padding:"32px 20px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:28}}>
            <h2 style={{fontSize:22,fontWeight:800,margin:0,letterSpacing:"-0.5px"}}>Gallery</h2>
            <button className="btn btn-ghost" style={{padding:"9px 18px",fontSize:13}}
              onClick={()=>setScreen("home")}>Home</button>
          </div>
          {gallery.length===0 ? (
            <div style={{textAlign:"center",color:"#5a6676",marginTop:80}}>
              <p style={{marginBottom:24}}>No captures yet.</p>
              <button className="btn btn-primary" style={{padding:"14px 32px"}}
                onClick={()=>setShowExplainer(true)}>Capture My Iris</button>
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:16}}>
              {gallery.map((it,i)=>(
                <div key={i} onClick={()=>setExpanded(it)} style={{cursor:"pointer",textAlign:"center"}}>
                  <img src={it.url} alt="" style={{width:"100%",borderRadius:"50%",
                    border:"1px solid rgba(0,212,255,.2)"}} />
                  <div style={{display:"flex",alignItems:"center",justifyContent:"center",
                    gap:6,marginTop:8,fontSize:12,textTransform:"capitalize",letterSpacing:"0.05em"}}>
                    <span style={{width:8,height:8,borderRadius:"50%",background:SWATCH[it.color]||"#777"}} />
                    {it.color}
                  </div>
                  <div style={{fontSize:10,color:"#4a5666",marginTop:2}}>{it.date}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── EXPANDED ── */}
      {expanded && (
        <div onClick={()=>setExpanded(null)} style={{position:"fixed",inset:0,
          background:"rgba(3,5,8,.97)",display:"flex",alignItems:"center",
          justifyContent:"center",padding:24,zIndex:30}}>
          <img src={expanded.url} alt="" style={{maxWidth:"90vw",maxHeight:"80vh",
            borderRadius:"50%",boxShadow:`0 0 60px rgba(0,212,255,.35)`}} />
        </div>
      )}

      {/* ── EXPLAINER MODAL ── */}
      {showExplainer && (
        <div style={{position:"fixed",inset:0,background:"rgba(3,5,8,.92)",
          display:"flex",alignItems:"center",justifyContent:"center",padding:24,zIndex:40}}>
          <div style={{background:"#0c1219",border:"1px solid rgba(0,212,255,.2)",
            borderRadius:8,padding:32,maxWidth:340,textAlign:"center",width:"100%"}}>
            <div style={{width:48,height:48,borderRadius:"50%",
              border:`1.5px solid ${cyan}`,margin:"0 auto 20px",
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>👁</div>
            <h3 style={{margin:"0 0 10px",fontSize:18,fontWeight:700}}>Camera Required</h3>
            <p style={{color:"#8a97a6",fontSize:14,lineHeight:1.6,margin:"0 0 28px"}}>
              IrisLens uses your camera to guide you through an iris capture. Everything processes on your device — nothing is uploaded.
            </p>
            <button className="btn btn-primary" style={{padding:"14px",width:"100%"}}
              onClick={()=>{setShowExplainer(false);setScreen("capture");}}>Allow Camera</button>
            <button className="btn btn-ghost" style={{padding:"12px",width:"100%",marginTop:10}}
              onClick={()=>setShowExplainer(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(IrisLens));
