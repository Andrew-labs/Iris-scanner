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

function HudOverlay({ state }) {
  const cyan = "#00d4ff";
  const dim = "rgba(0,212,255,0.3)";
  const mid = "rgba(0,212,255,0.6)";
  const lockColor = state==="locking"||state==="capturing" ? cyan : dim;
  const ringOpacity = state==="capturing" ? 1 : 0.7;
  const ticks = [];
  for(let i=0;i<72;i++){
    const angle=(i*5)*Math.PI/180;
    const isMajor=i%9===0;
    const r1=isMajor?152:156, r2=162;
    ticks.push(
      <line key={i}
        x1={200+r1*Math.cos(angle)} y1={200+r1*Math.sin(angle)}
        x2={200+r2*Math.cos(angle)} y2={200+r2*Math.sin(angle)}
        stroke={isMajor?cyan:dim} strokeWidth={isMajor?1.5:0.8} opacity={ringOpacity} />
    );
  }
  return (
    <svg viewBox="0 0 400 400" style={{
      position:"absolute",top:"50%",left:"50%",
      width:"min(88vw,380px)",height:"min(88vw,380px)",
      transform:"translate(-50%,-55%)",pointerEvents:"none",overflow:"visible"
    }}>
      {ticks}
      <circle cx="200" cy="200" r="162" fill="none" stroke={dim} strokeWidth="1" strokeDasharray="4 3" opacity={ringOpacity}/>
      <circle cx="200" cy="200" r="142" fill="none" stroke={lockColor} strokeWidth="1" opacity="0.5"/>
      <circle cx="200" cy="200" r="120" fill="none" stroke={lockColor} strokeWidth="2.5"
        strokeDasharray={state==="locking"?"30 8":state==="capturing"?"none":"60 20"}
        style={{transition:"all 0.4s"}}/>
      <circle cx="200" cy="200" r="96" fill="none" stroke={dim} strokeWidth="1" strokeDasharray="3 6"/>
      <path d="M 56 100 L 56 56 L 100 56" fill="none" stroke={cyan} strokeWidth="2" opacity={ringOpacity}/>
      <path d="M 300 56 L 344 56 L 344 100" fill="none" stroke={cyan} strokeWidth="2" opacity={ringOpacity}/>
      <path d="M 56 300 L 56 344 L 100 344" fill="none" stroke={cyan} strokeWidth="2" opacity={ringOpacity}/>
      <path d="M 300 344 L 344 344 L 344 300" fill="none" stroke={cyan} strokeWidth="2" opacity={ringOpacity}/>
      <line x1="200" y1="72" x2="200" y2="88" stroke={mid} strokeWidth="1.5"/>
      <line x1="200" y1="312" x2="200" y2="328" stroke={mid} strokeWidth="1.5"/>
      <line x1="72" y1="200" x2="88" y2="200" stroke={mid} strokeWidth="1.5"/>
      <line x1="312" y1="200" x2="328" y2="200" stroke={mid} strokeWidth="1.5"/>
      <text x="108" y="52" fill={cyan} fontSize="9" fontFamily="Inter,monospace" opacity="0.7">IRIS.SCAN</text>
      <text x="264" y="52" fill={cyan} fontSize="9" fontFamily="Inter,monospace" opacity="0.7" textAnchor="end">v2.4</text>
      <text x="56" y="360" fill={cyan} fontSize="8" fontFamily="Inter,monospace" opacity="0.6">LAT: {state==="capturing"?"LOCKED":"—"}</text>
      <text x="344" y="360" fill={cyan} fontSize="8" fontFamily="Inter,monospace" opacity="0.6" textAnchor="end">
        {state==="capturing"?"CAPTURED":state==="locking"?"LOCKING...":"SCANNING"}
      </text>
      {[0,90,180,270].map(deg=>{
        const a=deg*Math.PI/180;
        return <circle key={deg}
          cx={200+120*Math.cos(a)} cy={200+120*Math.sin(a)}
          r="4" fill={state==="locking"||state==="capturing"?cyan:"none"}
          stroke={cyan} strokeWidth="1.5" opacity={ringOpacity}/>;
      })}
      {state==="capturing"&&(
        <circle cx="200" cy="200" r="120" fill="none" stroke={cyan} strokeWidth="6" opacity="0.9"
          style={{animation:"captureFlash 0.4s ease-out forwards"}}/>
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
    if(landmarkerRef.current) return landmarkerRef.current;
    let vision = window.visionTasks;
    if(!vision){
      await new Promise((resolve,reject)=>{
        const t=setTimeout(()=>reject(new Error("MediaPipe load timeout")),20000);
        window.addEventListener("mp-ready",()=>{clearTimeout(t);resolve();},{once:true});
      });
      vision=window.visionTasks;
    }
    const {FaceLandmarker,FilesetResolver}=vision;
    const fileset=await FilesetResolver.forVisionTasks(CDN_WASM);
    const lm=await FaceLandmarker.createFromOptions(fileset,{
      baseOptions:{modelAssetPath:MODEL_URL,delegate:"GPU"},
      runningMode:"VIDEO",numFaces:1,outputFaceBlendshapes:false,
    });
    landmarkerRef.current=lm;
    return lm;
  },[]);

  const startCamera=useCallback(async()=>{
    setPermError(null);
    try{
      const stream=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:"user",width:{ideal:1280},height:{ideal:720}},audio:false,
      });
      streamRef.current=stream;
      if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play();}
      await loadLandmarker();
      capturedRef.current=false;holdStartRef.current=null;
      setHudState("searching");
      loop();
    }catch(e){
      if(e.name==="NotAllowedError") setPermError("Camera access blocked. Enable it in browser settings.");
      else if(e.name==="NotFoundError") setPermError("No camera found on this device.");
      else setPermError("Could not start camera: "+e.message);
    }
  },[loadLandmarker]);

  const stopCamera=useCallback(()=>{
    if(rafRef.current) cancelAnimationFrame(rafRef.current);
    if(streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
    streamRef.current=null;
  },[]);

  const loop=useCallback(()=>{
    const video=videoRef.current,lm=landmarkerRef.current;
    if(!video||!lm||video.readyState<2||capturedRef.current){
      rafRef.current=requestAnimationFrame(loop);return;
    }
    let res;
    try{res=lm.detectForVideo(video,performance.now());}
    catch{rafRef.current=requestAnimationFrame(loop);return;}
    if(!res.faceLandmarks||!res.faceLandmarks.length){
      setStatus("Position your eye within the ring");setHudState("searching");holdStartRef.current=null;
    }else{
      const pts=res.faceLandmarks[0];
      const iris=R_IRIS.map(i=>pts[i]);
      const cx=iris.reduce((a,p)=>a+p.x,0)/4;
      const cy=iris.reduce((a,p)=>a+p.y,0)/4;
      const rad=Math.max(...iris.map(p=>Math.hypot(p.x-cx,p.y-cy)));
      const dist=Math.hypot(cx-0.5,cy-0.5);
      if(dist>ALIGN_TOL*1.6){setStatus("Center your eye");setHudState("searching");holdStartRef.current=null;}
      else if(rad<0.018){setStatus("Move closer");setHudState("searching");holdStartRef.current=null;}
      else if(rad>0.09){setStatus("Move back slightly");setHudState("searching");holdStartRef.current=null;}
      else if(dist>ALIGN_TOL){setStatus("Align to center");setHudState("aligning");holdStartRef.current=null;}
      else{
        if(!holdStartRef.current) holdStartRef.current=performance.now();
        if(performance.now()-holdStartRef.current>=HOLD_MS){
          capturedRef.current=true;setHudState("capturing");setStatus("Captured");
          setTimeout(()=>capture(cx,cy,rad),200);return;
        }
        setHudState("locking");setStatus("Hold steady");
      }
    }
    rafRef.current=requestAnimationFrame(loop);
  },[]);

  const capture=useCallback((ncx,ncy,nrad)=>{
    const video=videoRef.current;
    const vw=video.videoWidth,vh=video.videoHeight;
    const pad=3.2,radPx=nrad*vw*pad,cxPx=ncx*vw,cyPx=ncy*vh;
    const c=document.createElement("canvas");
    c.width=CROP;c.height=CROP;
    const ctx=c.getContext("2d");
    ctx.drawImage(video,cxPx-radPx,cyPx-radPx,radPx*2,radPx*2,0,0,CROP,CROP);
    const img=ctx.getImageData(0,0,CROP,CROP).data;
    const cxp=CROP/2,cyp=CROP/2,innerR=CROP*0.18;
    let hs=0,ss=0,ls=0,n=0;
    for(let y=0;y<CROP;y+=2) for(let x=0;x<CROP;x+=2){
      const dx=x-cxp,dy=y-cyp;
      if(dx*dx+dy*dy<innerR*innerR){
        const i=(y*CROP+x)*4;
        const [h,s,l]=rgbToHsl(img[i],img[i+1],img[i+2]);
        hs+=h;ss+=s;ls+=l;n++;
      }
    }
    const colorLabel=classifyColor(hs/n,ss/n,ls/n);
    const dataUrl=c.toDataURL("image/jpeg",0.9);
    lastCropRef.current=dataUrl;lastColorRef.current=colorLabel;
    stopCamera();setGenError(null);setScreen("processing");
    generate(dataUrl,colorLabel);
  },[stopCamera]);

  const generate=useCallback(async(dataUrl,colorLabel)=>{
    const msgs=["Reading iris geometry…","Mapping fibre patterns…","Rendering macro detail…","Finalising your portrait…"];
    let mi=0;setProcMsg(msgs[0]);
    const t=setInterval(()=>{mi=(mi+1)%msgs.length;setProcMsg(msgs[mi]);},2800);
    try{
      const startRes=await fetch("/api/generate",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({imageDataUrl:dataUrl,colorLabel}),
      });
      const start=await startRes.json();
      if(!startRes.ok||!start.id) throw new Error(start.error||"Could not start generation");
      let output=null;
      for(let i=0;i<60;i++){
        await new Promise(r=>setTimeout(r,1500));
        const pRes=await fetch("/api/poll?id="+encodeURIComponent(start.id));
        const p=await pRes.json();
        if(p.status==="succeeded"&&p.output){output=p.output;break;}
        if(p.status==="failed"||p.status==="canceled") throw new Error(p.error||"Generation failed");
      }
      clearInterval(t);
      if(!output) throw new Error("Generation timed out. Please try again.");
      const item={url:output,color:colorLabel,date:new Date().toLocaleDateString()};
      setResult(item);setGallery(g=>[item,...g]);setScreen("results");
    }catch(e){clearInterval(t);setGenError(String(e.message||e));}
  },[]);

  useEffect(()=>{
    if(screen==="capture") startCamera();
    return()=>{if(screen==="capture") stopCamera();};
  },[screen]);

  const cyan="#00d4ff";

  return (
    <div style={{minHeight:"100vh",background:"#070a0e",color:"#e8ecf2",
      fontFamily:"Inter, Roboto, system-ui, sans-serif",overflowX:"hidden"}}>
      <style>{`
        @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(0,212,255,.4);}50%{box-shadow:0 0 28px 5px rgba(0,212,255,.5);}}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes glow{0%,100%{opacity:.4}50%{opacity:1}}
        @keyframes scanline{0%{transform:translateY(-100%);opacity:0;}20%{opacity:1;}80%{opacity:1;}100%{transform:translateY(100%);opacity:0;}}
        @keyframes captureFlash{0%{opacity:1;}100%{opacity:0;}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(20px);}to{opacity:1;transform:translateY(0);}}
        @keyframes revealIris{from{opacity:0;transform:scale(0.92);}to{opacity:1;transform:scale(1);}}
        .btn{min-height:48px;border:none;font-weight:600;font-size:14px;cursor:pointer;transition:all .2s;font-family:inherit;letter-spacing:.06em;text-transform:uppercase;}
        .btn-primary{background:${cyan};color:#03181f;border-radius:3px;}
        .btn-primary:hover{filter:brightness(1.12);}
        .btn-ghost{background:transparent;color:rgba(207,233,245,0.7);border:1px solid rgba(0,212,255,.2);border-radius:3px;}
        .btn-ghost:hover{border-color:rgba(0,212,255,.5);color:#e8ecf2;}
        @media(prefers-reduced-motion:reduce){*{animation:none!important}}
      `}</style>

      {/* ── HOME ── */}
      {screen==="home"&&(
        <div style={{height:"100vh",display:"flex",flexDirection:"column",
          position:"relative",overflow:"hidden",background:"#070a0e"}}>

          {/* Hero image — fills the screen, treated with heavy dark overlay to kill white bg */}
          <div style={{position:"absolute",inset:0}}>
            <img src="/hero.jpg" alt="" style={{
              width:"100%",height:"100%",
              objectFit:"cover",
              objectPosition:"50% 68%", // show the eye/face area, not the top of head
              display:"block",
            }}/>
            {/* Kill the white background completely: dark overlay from all edges */}
            <div style={{position:"absolute",inset:0,
              background:"linear-gradient(to bottom, rgba(7,10,14,0.55) 0%, rgba(7,10,14,0.1) 35%, rgba(7,10,14,0.15) 55%, rgba(7,10,14,0.92) 78%, #070a0e 100%)"}}/>
            {/* Also darken from sides on desktop */}
            <div style={{position:"absolute",inset:0,
              background:"linear-gradient(to right, rgba(7,10,14,0.6) 0%, transparent 40%, transparent 60%, rgba(7,10,14,0.6) 100%)"}}/>
          </div>

          {/* Top bar */}
          <div style={{position:"relative",zIndex:2,padding:"22px 28px",
            display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontSize:18,fontWeight:800,letterSpacing:"-0.3px"}}>
              Iris<span style={{color:cyan}}>Lens</span>
            </span>
            <button className="btn btn-ghost" style={{padding:"8px 14px",fontSize:11}}
              onClick={()=>setScreen("gallery")}>Gallery</button>
          </div>

          {/* Bottom content — pushed to foot of screen */}
          <div style={{position:"relative",zIndex:2,marginTop:"auto",
            padding:"0 32px 52px",animation:"fadeUp 0.7s ease-out forwards"}}>

            <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.25em",color:cyan,
              margin:"0 0 14px",textTransform:"uppercase"}}>AI Iris Portrait</p>

            <h1 style={{fontSize:"clamp(34px,8vw,52px)",fontWeight:800,lineHeight:1.05,
              margin:"0 0 16px",letterSpacing:"-1.5px",maxWidth:480}}>
              See your iris<br/>like never before.
            </h1>

            <p style={{color:"rgba(138,151,166,0.9)",fontSize:14,lineHeight:1.7,
              margin:"0 0 36px",maxWidth:360}}>
              Advanced iris detection renders your unique eye structure in hyperreal macro detail.
            </p>

            <button className="btn btn-primary"
              style={{padding:"18px 0",width:"100%",maxWidth:360,fontSize:14,
                boxShadow:`0 0 32px rgba(0,212,255,0.25)`}}
              onClick={()=>setShowExplainer(true)}>
              Capture My Iris
            </button>
          </div>
        </div>
      )}

      {/* ── CAPTURE ── */}
      {screen==="capture"&&(
        <div style={{position:"fixed",inset:0,background:"#000"}}>
          <video ref={videoRef} autoPlay playsInline muted
            style={{width:"100%",height:"100%",objectFit:"cover",transform:"scaleX(-1)"}}/>
          <div style={{position:"absolute",inset:0,
            background:"radial-gradient(ellipse 60% 55% at 50% 42%, transparent 40%, rgba(0,0,0,0.75) 100%)",
            pointerEvents:"none"}}/>
          {!permError&&<HudOverlay state={hudState}/>}
          {!permError&&(hudState==="locking"||hudState==="aligning")&&(
            <div style={{
              position:"absolute",top:"50%",left:"50%",
              width:"min(67vw,280px)",height:"2px",
              transform:"translate(-50%,-55%)",
              background:`linear-gradient(to right, transparent, ${cyan}, transparent)`,
              animation:"scanline 1.8s ease-in-out infinite",
              pointerEvents:"none",opacity:0.7,
            }}/>
          )}
          {!permError&&(
            <div style={{position:"absolute",bottom:"max(110px,14vh)",left:0,right:0,textAlign:"center"}}>
              <span style={{fontSize:11,fontWeight:700,letterSpacing:"0.22em",
                textTransform:"uppercase",color:cyan,
                textShadow:"0 0 20px rgba(0,212,255,0.8)"}}>{status}</span>
            </div>
          )}
          {permError&&(
            <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",
              alignItems:"center",justifyContent:"center",padding:32,textAlign:"center",
              background:"rgba(5,8,12,.92)"}}>
              <p style={{fontSize:15,marginBottom:24,maxWidth:300}}>{permError}</p>
              <button className="btn btn-primary" style={{padding:"14px 32px"}} onClick={startCamera}>Try Again</button>
              <button className="btn btn-ghost" style={{padding:"12px 28px",marginTop:12}} onClick={()=>setScreen("home")}>Back</button>
            </div>
          )}
          <div style={{position:"absolute",bottom:"max(36px,env(safe-area-inset-bottom))",
            left:0,right:0,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 32px"}}>
            <button className="btn btn-ghost" style={{width:44,height:44,padding:0,borderRadius:"50%",
              fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}
              onClick={()=>setScreen("home")}>✕</button>
            <div style={{fontSize:9,color:"rgba(0,212,255,0.45)",letterSpacing:"0.18em",textTransform:"uppercase"}}>
              {hudState==="capturing"?"Captured":hudState==="locking"?"Locking…":"Scanning"}
            </div>
            <div style={{width:44}}/>
          </div>
        </div>
      )}

      {/* ── PROCESSING ── */}
      {screen==="processing"&&(
        <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",
          alignItems:"center",justifyContent:"center",padding:32,textAlign:"center"}}>
          {!genError?(
            <>
              <div style={{position:"relative",width:140,height:140,marginBottom:40}}>
                <div style={{position:"absolute",inset:0,borderRadius:"50%",border:"1.5px solid rgba(0,212,255,0.12)"}}/>
                <div style={{position:"absolute",inset:14,borderRadius:"50%",border:"1px dashed rgba(0,212,255,0.15)"}}/>
                <div style={{position:"absolute",inset:28,borderRadius:"50%",border:"1.5px solid rgba(0,212,255,0.12)"}}/>
                <div style={{position:"absolute",inset:0,borderRadius:"50%",
                  border:"2px solid transparent",borderTopColor:cyan,
                  animation:"spin 1.2s linear infinite"}}/>
                <div style={{position:"absolute",inset:18,borderRadius:"50%",
                  border:"1px solid transparent",borderTopColor:"rgba(0,212,255,0.4)",
                  animation:"spin 2s linear infinite reverse"}}/>
                <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:cyan,
                    animation:"pulse 1.5s ease-in-out infinite"}}/>
                </div>
              </div>
              <p style={{color:cyan,fontSize:12,fontWeight:700,letterSpacing:"0.18em",
                textTransform:"uppercase",animation:"glow 2s infinite",marginBottom:10}}>
                {procMsg}
              </p>
              <p style={{color:"rgba(58,72,86,0.9)",fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase"}}>
                AI rendering — up to 30 seconds
              </p>
            </>
          ):(
            <>
              <p style={{fontSize:14,color:"#e8ecf2",marginBottom:8}}>Generation failed</p>
              <p style={{color:"#8a97a6",fontSize:13,marginBottom:28,maxWidth:300}}>{genError}</p>
              <button className="btn btn-primary" style={{padding:"14px 32px"}} onClick={()=>{
                setGenError(null);
                if(lastCropRef.current) generate(lastCropRef.current,lastColorRef.current);
                else setScreen("capture");
              }}>Try Again</button>
              <button className="btn btn-ghost" style={{padding:"12px 28px",marginTop:12}}
                onClick={()=>setScreen("home")}>Home</button>
            </>
          )}
        </div>
      )}

      {/* ── RESULTS ── */}
      {result&&screen==="results"&&(
        <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",
          alignItems:"center",background:"#070a0e",position:"relative",overflow:"hidden"}}>

          {/* Subtle ambient glow behind the iris */}
          <div style={{position:"absolute",top:"18%",left:"50%",transform:"translateX(-50%)",
            width:"70vw",height:"70vw",maxWidth:500,maxHeight:500,borderRadius:"50%",
            background:"radial-gradient(circle, rgba(0,212,255,0.07) 0%, transparent 70%)",
            pointerEvents:"none"}}/>

          {/* Top label */}
          <div style={{paddingTop:"max(28px,env(safe-area-inset-top))",paddingBottom:20,
            width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",
            padding:"24px 28px 0"}}>
            <button className="btn btn-ghost" style={{padding:"8px 14px",fontSize:11}}
              onClick={()=>setScreen("home")}>← Home</button>
            <button className="btn btn-ghost" style={{padding:"8px 14px",fontSize:11}}
              onClick={()=>setScreen("gallery")}>Gallery</button>
          </div>

          {/* Iris — the centrepiece. Large, dramatic, takes most of the screen. */}
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",
            padding:"16px 24px",animation:"revealIris 0.8s cubic-bezier(0.16,1,0.3,1) forwards"}}>
            <div style={{position:"relative"}}>
              {/* Decorative outer rings */}
              <div style={{position:"absolute",inset:-20,borderRadius:"50%",
                border:"1px solid rgba(0,212,255,0.1)",pointerEvents:"none"}}/>
              <div style={{position:"absolute",inset:-36,borderRadius:"50%",
                border:"1px dashed rgba(0,212,255,0.06)",pointerEvents:"none"}}/>
              <div style={{position:"absolute",inset:-52,borderRadius:"50%",
                border:"1px solid rgba(0,212,255,0.04)",pointerEvents:"none"}}/>

              <img src={result.url} alt="Your iris"
                style={{
                  width:"min(82vw,440px)",
                  height:"min(82vw,440px)",
                  borderRadius:"50%",
                  objectFit:"cover",
                  display:"block",
                  boxShadow:[
                    `0 0 0 1px rgba(0,212,255,0.18)`,
                    `0 0 40px rgba(0,212,255,0.14)`,
                    `0 0 100px rgba(0,212,255,0.08)`,
                    `0 0 180px rgba(0,212,255,0.04)`,
                  ].join(","),
                }}/>
            </div>
          </div>

          {/* Color label + actions — minimal, at the foot */}
          <div style={{width:"100%",padding:"0 28px 48px",textAlign:"center"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:32}}>
              <span style={{width:8,height:8,borderRadius:"50%",
                background:SWATCH[result.color]||"#777",
                boxShadow:`0 0 6px ${SWATCH[result.color]||"#777"}66`}}/>
              <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.22em",
                color:"rgba(138,151,166,0.8)",textTransform:"uppercase"}}>{result.color}</span>
            </div>

            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <button className="btn btn-primary"
                style={{padding:"14px 28px",fontSize:12}}
                onClick={async()=>{
                  try{
                    const blob=await(await fetch(result.url)).blob();
                    const url=URL.createObjectURL(blob);
                    const a=document.createElement("a");
                    a.href=url;a.download=`iris-${Date.now()}.png`;a.click();
                    URL.revokeObjectURL(url);
                  }catch{window.open(result.url,"_blank");}
                }}>Save</button>
              <button className="btn btn-ghost"
                style={{padding:"14px 28px",fontSize:12}}
                onClick={async()=>{
                  try{
                    const blob=await(await fetch(result.url)).blob();
                    const file=new File([blob],"iris.png",{type:"image/png"});
                    if(navigator.canShare&&navigator.canShare({files:[file]}))
                      await navigator.share({files:[file],title:"My iris — IrisLens"});
                    else await navigator.clipboard.writeText(result.url);
                  }catch{}
                }}>Share</button>
              <button className="btn btn-ghost"
                style={{padding:"14px 20px",fontSize:12}}
                onClick={()=>setScreen("capture")}>Again</button>
            </div>
          </div>
        </div>
      )}

      {/* ── GALLERY ── */}
      {screen==="gallery"&&(
        <div style={{minHeight:"100vh",padding:"32px 20px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:28}}>
            <h2 style={{fontSize:20,fontWeight:800,margin:0,letterSpacing:"-0.5px"}}>Gallery</h2>
            <button className="btn btn-ghost" style={{padding:"9px 16px",fontSize:11}}
              onClick={()=>setScreen("home")}>Home</button>
          </div>
          {gallery.length===0?(
            <div style={{textAlign:"center",color:"#5a6676",marginTop:80}}>
              <p style={{marginBottom:24,fontSize:14}}>No captures yet.</p>
              <button className="btn btn-primary" style={{padding:"14px 32px"}}
                onClick={()=>setShowExplainer(true)}>Capture My Iris</button>
            </div>
          ):(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:16}}>
              {gallery.map((it,i)=>(
                <div key={i} onClick={()=>setExpanded(it)} style={{cursor:"pointer",textAlign:"center"}}>
                  <img src={it.url} alt="" style={{width:"100%",borderRadius:"50%",
                    border:"1px solid rgba(0,212,255,.15)"}}/>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"center",
                    gap:6,marginTop:8,fontSize:11,textTransform:"capitalize",letterSpacing:"0.06em",
                    color:"rgba(138,151,166,0.8)"}}>
                    <span style={{width:7,height:7,borderRadius:"50%",background:SWATCH[it.color]||"#777"}}/>
                    {it.color}
                  </div>
                  <div style={{fontSize:10,color:"#3a4856",marginTop:2}}>{it.date}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── EXPANDED ── */}
      {expanded&&(
        <div onClick={()=>setExpanded(null)} style={{position:"fixed",inset:0,
          background:"rgba(3,5,8,.97)",display:"flex",alignItems:"center",
          justifyContent:"center",padding:24,zIndex:30}}>
          <img src={expanded.url} alt="" style={{maxWidth:"90vw",maxHeight:"80vh",
            borderRadius:"50%",boxShadow:`0 0 60px rgba(0,212,255,.3)`}}/>
        </div>
      )}

      {/* ── EXPLAINER MODAL ── */}
      {showExplainer&&(
        <div style={{position:"fixed",inset:0,
          background:"rgba(4,7,11,0.88)",backdropFilter:"blur(12px)",
          display:"flex",alignItems:"center",justifyContent:"center",
          padding:24,zIndex:40}}>
          <div style={{background:"rgba(10,16,24,0.96)",
            border:"1px solid rgba(0,212,255,.15)",
            borderRadius:6,padding:"36px 32px",maxWidth:320,textAlign:"center",width:"100%",
            boxShadow:"0 0 0 1px rgba(0,212,255,0.05), 0 40px 80px rgba(0,0,0,0.6)"}}>

            {/* SVG eye icon */}
            <div style={{margin:"0 auto 24px",width:48,height:48,borderRadius:"50%",
              border:`1px solid rgba(0,212,255,0.3)`,
              display:"flex",alignItems:"center",justifyContent:"center"}}>
              <svg width="22" height="16" viewBox="0 0 22 16" fill="none">
                <path d="M1 8C1 8 4.5 1 11 1C17.5 1 21 8 21 8C21 8 17.5 15 11 15C4.5 15 1 8 1 8Z"
                  stroke={cyan} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="11" cy="8" r="3" stroke={cyan} strokeWidth="1.5"/>
                <circle cx="11" cy="8" r="1" fill={cyan}/>
              </svg>
            </div>

            <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.2em",color:cyan,
              textTransform:"uppercase",margin:"0 0 10px"}}>Camera Required</p>
            <h3 style={{margin:"0 0 12px",fontSize:18,fontWeight:700,letterSpacing:"-0.3px"}}>
              Allow access to begin
            </h3>
            <p style={{color:"rgba(138,151,166,0.85)",fontSize:13,lineHeight:1.65,margin:"0 0 28px"}}>
              IrisLens uses your camera to guide your iris into frame. Your image is processed on your device and never stored or uploaded.
            </p>

            <button className="btn btn-primary"
              style={{padding:"15px",width:"100%",marginBottom:10,fontSize:13,
                boxShadow:`0 0 24px rgba(0,212,255,0.2)`}}
              onClick={()=>{setShowExplainer(false);setScreen("capture");}}>
              Allow Camera
            </button>
            <button className="btn btn-ghost"
              style={{padding:"13px",width:"100%",fontSize:13}}
              onClick={()=>setShowExplainer(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(IrisLens));
