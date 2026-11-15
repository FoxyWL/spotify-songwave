# My Wave — UI/UX handoff specification

## 1. Product surface

**Primary target:** a browser extension companion experience embedded into Spotify Web.

**Proposed placement:** add a “Моя волна” destination to Spotify's left-side navigation. Selecting it displays the My Wave view in the main content area. The provided prototype shows a complete Spotify-like shell to communicate the intended placement and hierarchy; in production, Claude should integrate with the real Spotify shell rather than duplicating it where possible.

**Desktop-first:** optimize for 1280–1600 px wide viewports, then collapse the left navigation and stack cards for tablet/mobile widths.

## 2. Visual direction

- Dark, premium, low-glare interface that feels native beside Spotify.
- Base background: `#101010`; sidebar: `#090909`; cards: `#181818`.
- Primary action: Spotify green `#1ED760`.
- My Wave signature accents: soft violet `#A58AFF` and mint `#9CF3D0`.
- Main type: Manrope for display headings; DM Sans for interface text. System sans-serif fallback is acceptable.
- Rounded geometry is restrained: 6–14 px. Avoid excessive glassmorphism or large gradients outside the hero.
- Motion should be subtle: hover transitions, small equalizer animation, low-speed hero record rotation. Respect `prefers-reduced-motion` in production.

## 3. Screen hierarchy

1. **Spotify navigation shell** — existing Spotify home/search/library context; add a clearly identifiable My Wave item.
2. **Hero / identity** — “Твоя волна.”, short value proposition, primary listen button, refresh action, live/personalized status.
3. **Current track card** — album art, title, artist, light metadata, reason-for-recommendation, like/dislike, less-like-this, save, overflow actions.
4. **Taste adaptation card** — familiar vs discovery balance, concise explanation, taste profile shortcut.
5. **Up-next list** — ordered track rows with artwork, artist, duration, and concise recommendation reason.
6. **Tuning presets** — Balance, More familiar, More discovery, Calmer, More energetic.
7. **Persistent player** — current track, playback actions, progress, queue/device/volume controls. In production, prefer the actual Spotify player state and controls; do not create a second competing playback engine.

## 4. Component contract

### Hero
- Primary CTA starts/resumes the My Wave stream.
- Refresh asks the recommendation engine to replenish upcoming tracks while preserving the currently playing item.
- Status text must reflect actual stream state, not hardcoded “live” claims.

### Current track
- `Like` and `Dislike` are mutually exclusive states.
- `Less like this` should send a weaker negative preference signal than explicit dislike.
- Save should use Spotify's supported library/save flow and reflect success/failure.
- Recommendation reason must be generated from real explainable signals. Hide it if no reliable reason is available.

### Taste adaptation
- Familiar/discovery percentages must be derived from the actual recommendation policy configuration.
- Artist avatars/counts must come from real profile data. Do not hardcode mock values.
- Link opens an explainable taste profile/settings view.

### Queue
- Each row should support track selection, overflow actions, and queue state.
- Reasons should be brief and grounded in actual recommendation features.
- Keep the currently playing track stable when replenishing the queue.

### Tuning presets
- Preset selection is single-select.
- Selection updates the recommender's tuning parameters and visually persists.
- Presets should map to explicit recommendation weights (familiarity, novelty, energy, mood), not just change the selected chip.

## 5. Interaction states to implement

- Default / hover / focus-visible / active / disabled.
- Loading skeleton for current track and queue.
- Empty state when no usable listening history exists.
- Spotify disconnected / authorization expired state.
- Playback unavailable on current device / Premium restriction state.
- Track unavailable in region or removed from catalog.
- API rate-limited / network failure state with retry affordance.
- No upcoming recommendations state with refresh action.
- Reduced-motion mode.

## 6. Responsive behavior

- `> 1120px`: sidebar + two-column dashboard cards.
- `850–1120px`: compact sidebar, narrower spacing, stacked tune section.
- `600–850px`: icon-only navigation, one-column dashboard.
- `<= 600px`: hide desktop sidebar, compact player controls, hero artwork becomes decorative, cards stack, queue table hides recommendation-reason column.

## 7. Integration notes for Claude

- Scope styles to a dedicated root / Shadow DOM; the CSS in this prototype is global for preview only.
- Convert design constants into CSS custom properties or the app's existing token system.
- Replace mock tracks and artwork with Spotify track metadata and album-art URLs.
- Use the same Spotify playback context that the user expects; avoid double playback or competing player state.
- Keep UI components independent of the recommendation engine and Spotify transport layer.
- Add robust loading/error handling before connecting controls to live services.
- Validate Spotify Developer Terms, product access, scopes, API availability, Premium requirements, and Web Playback SDK constraints before implementing each integration.

## 8. Demo-only content

All track names, artists, rationale labels, ratios, and counts in this prototype are illustrative placeholder data. Do not ship them as real user data. The SVG artwork is original decorative placeholder art, not Spotify catalog artwork.

## 9. Dynamic prototype behavior (implemented)

The current `app.js` is an interactive demo controller, not a Spotify API client. It implements the following front-end behavior so the interaction can be tested before the extension backend exists:

- Current-track rendering and queue generation from a local demonstration catalog.
- Play/pause UI state and a simulated elapsed-time clock; it does not play audio.
- Selecting queue rows, advancing/rewinding tracks, and seeking through the progress bar.
- Per-track like/dislike/save state, less-like-this preference signals, and local saved-track view.
- Five tuning presets plus an adjustable familiar/discovery percentage.
- Artist exclusions and demo recommendation re-ranking.
- Queue, settings, taste-profile, track-actions, and search dialogs.
- Search against the local sample catalog, local demo playlist creation, shuffle/repeat states, and volume slider state.
- `localStorage` persistence for supported browsers.

The prototype intentionally labels all of this as demo behavior in its documentation. No demo action calls Spotify and no local values should be interpreted as real user listening data.

## 10. Production adapter contract

When turning the prototype into the extension, keep UI rendering independent of the data source. Replace the demo catalog/state with an adapter exposing equivalent operations, conceptually:

- `getCurrentTrack()` / `subscribeToPlaybackState()`
- `getUpcomingRecommendations()` / `refreshRecommendations({ preserveCurrentTrack: true })`
- `playTrack(trackId)` / `pause()` / `resume()` / `next()` / `previous()` / `seek(positionMs)`
- `sendFeedback(trackId, { type: 'like' | 'dislike' | 'less-like' })`
- `saveTrack(trackId)` / `removeSavedTrack(trackId)`
- `updateTuning({ familiarity, novelty, energy, mood })`
- `excludeArtist(artistId)`

These names describe a UI/service boundary, not existing Spotify endpoints. Claude must map only to verified, currently supported Spotify capabilities and implement any additional recommendation logic in the project's own permitted service layer.
