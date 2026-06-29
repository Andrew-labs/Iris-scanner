# IrisLens — Iris Capture + Silent Seat Assignment

Guest experiences a polished iris scanner. Behind the scenes, face recognition
matches them against a pre-loaded photo database and reveals their seat number.

## How the magic works

1. Guest taps "Begin Scan" and aligns their eye in the HUD ring.
2. The app captures **two things simultaneously**: a tight iris crop (for the AI
   portrait) and a wider face crop (for recognition).
3. Replicate generates the iris portrait. In parallel, face-api.js matches the
   face crop against `faces.json` (descriptors of your uploaded photos).
4. The processing screen shows iris-themed messages — never face matching.
5. The results screen reveals the iris portrait, then the seat number.

If face match fails (guest, blurry, no DB entry), they get the next free seat
from the pool. The guest never sees a "not found" — the experience is identical.

## One-time setup

### 1. Install dev dependencies
```bash
cd irislens
npm install
```

### 2. Download face-api models
```bash
npm run models
```
Drops three model files into `public/face-models/` (~6MB total).
Served to the browser at runtime so face recognition works.

### 3. Add guest photos
Drop JPG/PNG photos into `public/faces/`. Naming convention:
```
FirstName_LastName_seat_NUMBER.jpg
```
Examples:
```
Andrew_Wevell_seat_12.jpg
Sarah_Jones_seat_7.jpg
Tom_Hardy_seat_42A.png
```

Tips: clear front-facing shots, eyes open, well-lit, one face per photo, 600px+ wide.

### 4. Build the descriptor database
```bash
npm run build-faces
```
Produces `public/faces.json` — a tiny JSON of 128-dim descriptors.

### 5. Deploy
```bash
git add public/face-models public/faces.json
git commit -m "Add face database"
git push
```

## Updating the guest list

1. Drop new photos into `public/faces/`
2. Run `npm run build-faces`
3. Commit `faces.json` and push

## Environment variables (set in Netlify)

- `REPLICATE_API_TOKEN` — your Replicate token (r8_...)
- `ANTHROPIC_API_KEY` — for Claude Vision colour detection

## Tuning

- **Match strictness:** `MATCH_THRESHOLD` in `app.src.jsx`. Lower = stricter.
  Default 0.5 is balanced. 0.4 = stricter, 0.6 = laxer.
- **Iris prompt:** `netlify/functions/generate-iris.js` → `promptFor()`.

## Known constraints

- Face recognition needs decent lighting and non-extreme angles.
- Each seat is consumed once per session. Page refresh resets the taken set.
- Tensorflow + face-api bundle is ~5MB on first load (cached after).
