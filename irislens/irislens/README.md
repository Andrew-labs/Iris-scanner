# IrisLens

Guided eye capture in the browser, then an AI-generated hyperreal iris portrait
in the person's detected eye colour. Front camera, no app download. Built to mimic
the iPhone/Samsung "iris art" apps: it captures a usable eye photo, then generates
a high-detail iris from it (the detail is rendered, not photographed — a phone front
camera physically cannot resolve true iris texture).

## How it works

1. **Capture** — live `getUserMedia` feed, MediaPipe FaceLandmarker guides the user
   to centre their eye, auto-captures a 512px crop, and samples the eye colour.
2. **Generate** — the crop + colour go to a Netlify function that calls Replicate
   (Flux Kontext Pro) to render a macro iris. A second function polls for the result.
3. **Results** — the generated iris is shown with the colour label; save / share / gallery.

The Replicate token lives only in the Netlify function environment. It is never in
client code, so it can't be stolen from the browser at the event.

## Project layout

```
irislens/
  public/
    index.html        # loads MediaPipe + React + app.js
    app.js            # precompiled UI (no build step needed)
  netlify/functions/
    generate-iris.js  # POST /api/generate -> starts Replicate prediction
    poll-iris.js      # GET  /api/poll?id= -> returns status + output URL
  netlify.toml        # publish dir, functions dir, /api/* redirects
  package.json
  app.src.jsx         # JSX source (only needed if you want to edit + recompile)
```

## Deploy

1. Push this folder to a Git repo (or use `netlify deploy`).
2. In Netlify: **New site from Git**, point at the repo. No build command needed;
   publish dir is `public`, functions dir is `netlify/functions` (already in netlify.toml).
3. **Set the environment variable** (Site settings → Environment variables):
   - `REPLICATE_API_TOKEN` = your Replicate token (starts with `r8_...`)
4. Deploy. Open the HTTPS URL on a phone — camera works because it's HTTPS.

### CLI alternative
```bash
npm i -g netlify-cli
cd irislens
netlify deploy --prod
# set the token once:
netlify env:set REPLICATE_API_TOKEN r8_your_token_here
```

## Local testing

Functions need the Netlify dev server (a plain http server won't run them):
```bash
netlify dev
```
Then open the localhost URL it prints. Set the token locally first:
```bash
export REPLICATE_API_TOKEN=r8_your_token_here
```

## Tuning the iris look

Edit the `promptFor()` function in `netlify/functions/generate-iris.js`. That prompt
controls the entire aesthetic of the generated iris. If you want a more stylised /
futuristic cyan-HUD look to match your iS Clinical activation, change it there — no
front-end rebuild required.

## Editing the UI

`public/app.js` is precompiled. If you want to change the interface, edit
`app.src.jsx` and recompile:
```bash
npx @babel/cli --presets @babel/preset-react app.src.jsx > public/app.js
# (use the classic runtime so there are no import statements)
```
Or just edit `app.js` directly for small tweaks — it's readable plain JS.

## Cost & timing

- Flux Kontext Pro runs ~5–15s per image on Replicate, billed per generation.
- The UI polls every 1.5s for up to 90s before timing out.
- For a busy event, check your Replicate rate limits and budget in advance.

## Known constraints

- Gallery is in-memory (clears on reload). Wire to Supabase if you want persistence —
  the capture object is `{ url, color, date }`, easy to insert.
- The generated iris resembles the person's colour and general structure but is not a
  biometric record of their actual iris. That's the same thing the App Store apps do.
