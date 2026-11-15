# My Wave — Dynamic Spotify UI Prototype

A responsive, interactive UI prototype and design handoff package for the **My Wave** Spotify Web companion extension.

## What's included

- `index.html` — complete Spotify-inspired My Wave screen.
- `styles.css` — visual system, responsive layouts, modal/drawer states, and micro-interactions.
- `app.js` — interactive demo application state, queue engine, mock recommendation ranking, feedback, settings, search, and local persistence.
- `assets/` — original SVG artwork and My Wave mark.
- `DESIGN_SPEC.md` — visual specification, component behavior, and production integration notes.
- `CLAUDE_HANDOFF.txt` — focused implementation instructions for Claude.
- `PREVIEW_DESKTOP.png`, `PREVIEW_MOBILE.png` — rendered design previews.

## Run locally

Open `index.html` in a modern browser. No build step or dependencies are required.

## Dynamic interactions in this prototype

- Play / pause demo state with a simulated progress clock (no audio is played).
- Next / previous track and track selection from the queue.
- Queue rendering, queue modal, remove-from-queue, and play-next actions.
- Like, dislike, less-like-this, and save-to-demo-library feedback.
- Recommendation tuning presets and a familiarity/discovery slider.
- Artist exclusion in the demo catalog.
- Refresh/re-rank the upcoming queue while keeping the current track.
- Shuffle and repeat states.
- Search across the local demo catalog.
- Create local demo playlists and view saved demo tracks.
- Volume slider state, keyboard controls, and responsive mobile layout.
- Settings and lightweight UI state persist in `localStorage` when browser storage is available.

## Important implementation boundary

This is an **interactive front-end prototype**, not a Spotify-connected extension. The playback clock is simulated and does not produce sound. Track data and recommendations are illustrative local demo data. Nothing is sent to Spotify, and local demo likes/saves/playlists are not written to a Spotify account.

Claude must connect the controls to supported Spotify APIs / Web Playback SDK / extension msiokeyboaacontrolfuntfive lidIs ontrt track.y APIs /ststaudmog.paayoitid miy spd mition innt.
boaplay-neoon id . K thurrent track.te or, and  alocal ctions in tmenfesi `a, sttt stlacerecommwith a simucal loclcation state, queuucarougmulaclenteadapion/oravicut.
-Artiportation notes.endations are 

Fd  y Web companprnd sco,s.
atescal e mark.
aved a*inteion msiokactjextensroueuud   exel. S spd .css` Spotif `in stensrooevioShadow DOM.typnfespcominoraludexre ontry APIs /stsSDK / sboates.ay-nls to su;notritteclocal anent e ontrp.
-Art K thuendation rankin Creraseparcal he qus andn boundaay-next DK / e ld MSpo.
