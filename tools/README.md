# Build tools

These scripts build the data in `extension/data/` and check the engine. They need clones of
[abbots-morton-spaceport](https://github.com/adiabatic/abbots-morton-spaceport) (glyph data) and
[abbots-morton-experiment](https://github.com/adiabatic/abbots-morton-experiment) (the font, exported as `font.woff2`),
and the [CMU Pronouncing Dictionary](https://github.com/cmusphinx/cmudict) (`cmudict.dict`).

Python packages: `fonttools`, `skia-pathops`, `cairosvg`, `numpy`, `pillow`, `pyyaml`, `scikit-image`. Node 18 or later for the `.js` scripts.

| Script | What it does |
| --- | --- |
| `draw_ligatures.py FONT extra-shapes.json preview.png [SPACEPORT/glyph_data]` | Draws the ten Senior ligatures missing from the font, from its outlines and Spaceport's description of each motion. |
| `build_engine_data.py SPACEPORT/glyph_data FONT qs-data.json [extra-shapes.json]` | Builds the joining rules and outlines used by `extension/engine/qs-senior.js`. |
| `pen_paths.py qs-data.json pen-paths.json [sheet.png]` | Computes the pen route through every outline, for the writing animation. |
| `build_dict.js cmudict.dict transformation.json nrl.json dict.txt` | Pre-converts the CMU dictionary to Quikscript letters (gzip the result). |
| `build_ipa.js cmudict.dict ipa.txt` | Builds the American IPA dictionary for the hover card (gzip the result). |
| `extract_expect.py manual-examples.json SPACEPORT/site/*.html` | Extracts the Manual's example words and their expected joins from Spaceport's site. |
| `score.js qs-data.json manual-examples.json [--fails N]` | Scores the engine against those examples. |

`manual-examples.json` and `extra-shapes.json` are the files used for the current release.
