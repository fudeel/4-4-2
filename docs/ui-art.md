# Football menu artwork

Created using the built-in image generation tool, then encoded locally as JPEG for the game. These are original fictional football scenes, without licensed team logos or real player likenesses. Original PNGs are retained in Codex's generated-images folder; the game uses these project-local assets:

- [Matchday](../public/art/matchday.jpg) — 311 KB, kickoff, account screen and player development.
- [Friends night](../public/art/friends-night.jpg) — 378 KB, tournament cards and friends-night lobbies.
- [Stadium](../public/art/stadium.jpg) — 389 KB, club creation, stadium and facility development.

## Final generation prompts

### Matchday

Use case: stylized-concept. Asset type: original hero artwork for a football videogame menu, landscape 16:9. A powerful athletic fictional male footballer in an unbranded electric cyan short-sleeved kit and black shorts, sprinting with a white football, dynamic low angle, body on RIGHT half, head fully in frame. Energetic photorealistic premium sports game key art with bold cyan backlight, dark midnight blue stadium, acid lime light streaks and abstract speed diagonals. LEFT half is dark blue negative space to overlay large white menu text. Crisp cinematic stadium lighting, realistic anatomy, dramatic cutout advertising composition, vivid saturated colors. No writing, no letters, no logos, no real club crests, no watermark. This is artwork only, not a screenshot or UI mockup.

### Friends night

Use case: stylized-concept. Asset type: original landscape 16:9 key art for a football videogame friends-night tournament card. Three fictional young adult footballers from diverse backgrounds in plain hot pink, purple and blue jerseys celebrating together around a brilliant silver football trophy. Powerful joyful energy, raised arms, dramatic stadium floodlights, neon magenta and violet glow, vivid pink sparks and confetti. Trophy and faces grouped center-right, darker rich purple background on left for overlaid menu text. High-end stylized photoreal sports campaign, graphic diagonal lighting, polished metal trophy, cinematic crisp detail. No writing, no letters, no logos, no real club or player likenesses, no watermark, no interface.

### Stadium

Use case: stylized-concept. Asset type: original landscape 16:9 image for a football videogame club development menu card. Sweeping cinematic aerial view of an intimate modern small football stadium with vivid lush green pitch, sharply marked white lines, packed colorful stands, brilliant floodlights, warm dramatic sunset with saturated tangerine and amber sky. A few illuminated football training pitches and an academy building beside the stadium. Sports game concept-art realism with striking orange, red, dark purple contrast, subtle energetic light beams, polished premium visual. Stadium predominantly center-right and bottom-right, darker warm space on left for large text overlays. No text, no words, no logos, no watermark, no UI mockup.

## Presentation behaviour

- The game fits a 16:9 surface, with letterboxing on screens of other proportions.
- Portrait phones and narrow portrait tablets show a rotation prompt. Rotating does not remount screens or reset an ongoing match.
- Main sections use keyboard-accessible tabs; left/right arrows, Home and End switch between tabs while focus is in the tab bar.
- Image-heavy mode cards have real text overlays, focus states and semantic buttons. Team colours and shirt numbers come from saved player data.
- Lists, squads and fixtures scroll within their game section; the browser page itself stays fixed.
- Reduced-motion preferences disable menu animation. The viewport permits normal browser zoom.

## Verification

Type checking, the production build and all 84 existing tests pass. Browser checks covered registration, live club creation, every hub tab, facility purchases, squad statistics, an eight-manager night, 28-fixture standings, shared champions, next-night setup, AI matches, half-time tactics and full-time results. Tested at 1280×720, 1920×1080, 390×844 portrait and 844×390 landscape, using disposable preview data. Rotation preserves the current screen; fixture scrolling survives the four-second refresh. No browser warnings or errors were captured.
