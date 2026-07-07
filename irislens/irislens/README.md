# IrisLens — Iris Capture + Name-Based Seat Assignment

Guest experiences a polished iris scanner. Before the scan, a quick name prompt
looks up their reserved seat. The eye scan and iris generation are the show;
the seat number is revealed at the end as if the iris identified them.

## Flow

1. Home screen → "Begin Scan"
2. Name prompt appears — guest types their name
3. Fuzzy match against the guest list. Ambiguous partials (e.g. "Amy") show
   a chooser: "Amy Lee Steenkamp" or "Amy Willcock"
4. Camera permission modal → live iris capture with HUD
5. Processing screen (Replicate iris generation, ~15 seconds)
6. Cinematic iris reveal → dramatic seat number reveal

Admins (Andrew, Dirkie, Claudia) see "ADMIN" instead of a seat number.

## Deploy

Drop this folder onto Netlify (or push to a Git repo Netlify is connected to).
Set two environment variables in Netlify:

- `REPLICATE_API_TOKEN` — your Replicate token (r8_...)
- `ANTHROPIC_API_KEY` — for Claude Vision colour detection

That's it. No build step, no scripts, no photos.

## Updating the guest list

Edit the `GUESTS` array at the top of `app.src.jsx`, then recompile.
Or edit the compiled `GUESTS = [...]` line inside `public/index.html` directly —
it's readable JavaScript.

## Project layout

```
irislens/
├── public/
│   ├── index.html         # entire app, inlined — deploy this
│   ├── app.js             # same code, separate file (optional)
│   └── hero.jpg           # home screen background
├── netlify/functions/
│   ├── generate-iris.js   # Claude Vision colour + Flux Kontext Pro
│   └── poll-iris.js       # polls Replicate for completion
├── app.src.jsx            # editable React source
├── netlify.toml
└── package.json
```
