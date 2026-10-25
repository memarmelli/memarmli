# Supplied logos — 2026-10-25

The user's original Melli and Shahid Beheshti University raster logos are preserved in `dist/assets/melli-original.png` and `dist/assets/university-original.png`.

Two ImageGen edits were attempted with the request to preserve the exact lettering, turn black ink pure white and remove the white background. The generated transparency introduced visible speckling, so those outputs are not used by the page.

The website displays the original supplied artwork with CSS contrast/inversion and screen compositing. This preserves the original lettering exactly, makes it white, and lets the navy header show through the background. The university logo's exterior canvas is clipped in CSS. This is a presentation treatment; the source PNGs remain unchanged.

ImageGen prompt for Melli:
> Edit this supplied Persian calligraphy logo with extreme fidelity. Preserve the EXACT original lettering, silhouette, geometry, spacing, proportions and overall composition. Make only these changes: recolor every black ink stroke to pure white (#FFFFFF), and remove the plain white background to full transparency. The output is a clean white logo on a transparent background, same aspect ratio and same original design. Do not rewrite, redraw, reinterpret, add text, add shadows, add borders, or add any decoration.

ImageGen prompt for the university:
> Faithfully edit this Shahid Beheshti University logo. Preserve the EXACT existing Persian calligraphy, date digits, geometry, proportions, and rectangular logo frame. Convert the BLACK calligraphy, black date, and black square frame strokes into pure WHITE (#FFFFFF). Remove the plain WHITE background to full transparency, and remove the solid black exterior canvas outside the logo's frame as well (that outer canvas is background, not a logo stroke). Final result: original university emblem and original rectangular frame, all white strokes, on transparent background. Keep identical lettering and proportions. No redesign, no newly typeset text, no extra decoration, no shadow.
