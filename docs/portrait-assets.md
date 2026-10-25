# Sample graduate portraits — 2026-10-25

## Approved wider graduation styling

Current website atlas: `dist/assets/graduate-portraits-approved-atlas.png` (1190 × 1322), six columns and five rows. The supplied sample identities were restyled with slightly angled bodies, navy university stoles, white emblems, petroleum-blue tassels and visible hair for women. These are fictional demonstration images. Two standalone approved portraits override atlas positions 01 and 02 so the exact approved images are used in both directory and profile pages.

Standalone assets: `dist/assets/graduate-male-approved.png` and `dist/assets/graduate-female-approved.png`. Tool: built-in ImageGen. Reusable identity-preserving prompt and input instructions: `docs/graduate-portrait-prompt-fa.md`.

Atlas edit prompt:
> EDIT the graduation contact sheet in image 1 to match the approved portrait STYLING of image 2 (man) and image 3 (woman). Image 4 is the university emblem. Keep exactly 30 DISTINCT adult Iranian graduates, their recognizable identities, and the original row/column gender order. Output ONE precisely aligned contact sheet: EXACTLY 6 columns by 5 rows, edge to edge, no gutters, no borders, no labels. Canvas aspect ratio 9:10 so EACH cell has portrait aspect ratio 3:4. IMPORTANT each person must have the WIDER UPPER-BODY FRAMING of images 2 and 3: complete mortarboard with headroom, full shoulders, and torso down to around the waist, with face occupying only about 25-30% of cell height; never the tight headshots of image 1. Every person's torso gently turned 20-25 degrees to camera, head naturally turned back toward lens with both eyes visible. Same black graduation gowns, deep navy satin shoulder stoles hanging in two front panels with WHITE university emblem on one panel, petroleum-blue/blue-teal cap tassel threads (#15556A), tiny gold tassel collar, black caps. Use image 4's square calligraphic emblem faithfully, small real embroidery at lower chest level. All women have natural visible dark hair beneath their caps, no headscarves, matching image 3. Preserve 30 distinct natural faces, no duplicated identities. Plain dark charcoal studio backdrop, soft flattering balanced studio lighting, natural skin texture, restrained colors matching approved images 2 and 3. Consistent subject scale and eye height in all cells. No text outside the university emblems, no numbers, no watermark. EXACT six columns and five rows. Entire sheet 9:10 aspect, all thirty cells equally sized.

## Original draft asset history

Method: built-in ImageGen, generation followed by a layout edit. These are fictional adult portraits, not photographs of actual university students. The website labels the sample faces and student suffixes.

Final project asset: `dist/assets/graduate-portraits-atlas-square.png` (1254 × 1254). Six columns and five rows contain 30 sample portraits. CSS crops each tile to a 3:4 card while preserving the image proportions. Real student records can provide individual `image` paths instead.

The initial draft was retained in the local ignored `qa/` directory. The final file is the only atlas used by the website.

Final ImageGen prompt:

> EDIT this fictional sample graduation contact sheet. Keep the same 30 distinct adult identities, clothing, studio lighting, and restrained color. The requested change is the OVERALL CANVAS AND PORTRAIT CROPPING. Output an EXACTLY SQUARE 1:1 image, e.g. 2048x2048. It MUST NOT be tall or portrait orientation. Arrange EXACTLY SIX equal-width columns and FIVE equal-height rows, edge to edge, NO gaps and NO borders, NO outer margins. In each cell show a centered CLOSE HEAD-AND-SHOULDERS graduation portrait: full head, mortarboard, face and upper gown collar, with substantially LESS lower torso than the reference. Every cell must be exactly the same rectangular size. The result must be a precise square 6-column by 5-row sprite atlas with all 30 people, suitable for CSS cropping into individual 3:4 portrait cards. No text, no numbers, no labels, no watermark. SQUARE OVERALL CANVAS. Six columns. Five rows.
