# Sample graduate portraits — 2026-10-25

Method: built-in ImageGen, generation followed by a layout edit. These are fictional adult portraits, not photographs of actual university students. The website labels the sample faces and student suffixes.

Final project asset: `dist/assets/graduate-portraits-atlas-square.png` (1254 × 1254). Six columns and five rows contain 30 sample portraits. CSS crops each tile to a 3:4 card while preserving the image proportions. Real student records can provide individual `image` paths instead.

The initial draft was retained in the local ignored `qa/` directory. The final file is the only atlas used by the website.

Final ImageGen prompt:

> EDIT this fictional sample graduation contact sheet. Keep the same 30 distinct adult identities, clothing, studio lighting, and restrained color. The requested change is the OVERALL CANVAS AND PORTRAIT CROPPING. Output an EXACTLY SQUARE 1:1 image, e.g. 2048x2048. It MUST NOT be tall or portrait orientation. Arrange EXACTLY SIX equal-width columns and FIVE equal-height rows, edge to edge, NO gaps and NO borders, NO outer margins. In each cell show a centered CLOSE HEAD-AND-SHOULDERS graduation portrait: full head, mortarboard, face and upper gown collar, with substantially LESS lower torso than the reference. Every cell must be exactly the same rectangular size. The result must be a precise square 6-column by 5-row sprite atlas with all 30 people, suitable for CSS cropping into individual 3:4 portrait cards. No text, no numbers, no labels, no watermark. SQUARE OVERALL CANVAS. Six columns. Five rows.
