# iS Clinical Eye Scan App

A Netlify-ready iris capture experience with the updated iS Clinical visual direction.

## What changed

- Added the new blue luxury background asset.
- Added a standalone glass DNA helix asset.
- Added a white transparent iS Clinical logo asset.
- Updated the home, capture, processing, results, gallery, and modal screens to use the same blue palette.
- Kept the live camera scan and table reveal flow.
- The only static design imagery used by the app is the background, DNA element, and iS Clinical logo.

## Flow

1. Home screen with `YOUR EYES hold the KEY` headline.
2. Guest enters their name.
3. The app matches the name to the guest list.
4. Camera opens for live iris capture.
5. Iris generation runs through the Netlify function.
6. Results screen reveals the table number.

## Deploy

Upload this folder to GitHub or drag it into Netlify.

Set these Netlify environment variables:

- `REPLICATE_API_TOKEN`
- `ANTHROPIC_API_KEY`

## Project layout

```text
irislens-updated/
├── public/
│   ├── index.html / index(1).html
│   ├── app.js
│   └── assets/
│       ├── hero.jpg
│       ├── icy_blue_dna_helix_in_focus.png
│       └── IS_Clinical_Logo-1.png
├── netlify/functions/
│   ├── generate-iris.js
│   └── poll-iris.js
├── app.src.jsx
├── netlify.toml
└── package.json / package(1).json
```
