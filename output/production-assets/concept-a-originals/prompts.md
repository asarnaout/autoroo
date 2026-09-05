# Autoroo concept A production asset prompts

Mode: built-in image_gen. One call per asset, run in parallel. No retries or variants.

Reference: `/Users/ahmedarnaout/Documents/ChatGPT/Autoroo/output/design-explorations/a-googly-getaway.png`

## Logo

Use case: background-extraction.
Asset type: production transparent PNG logo for the Autoroo arcade driving game menu.
Input image 1 is the edit target: the approved Autoroo concept A menu artwork. Extract and faithfully recreate ONLY its playful Autoroo sticker logo.
Text (verbatim): "AUTOROO". There must be exactly seven letters in this order: A U T O R O O. Preserve the chunky irregular rounded wordmark, cream AUTO and coral ROO. The final two O letters must remain googly eyes, with cream interiors and playful dark navy pupils. Preserve the thick dark navy outline and thick cream outer sticker edge, coral curved wiggle underline, and the small cream wiggle doodles close to the wordmark.
Composition/framing: a tightly framed landscape logo asset, about 2.7:1 aspect ratio, with only small clear padding around the entire sticker; all letters, underline, and doodles fully contained. Match the original logo's character and colors.
Scene/backdrop: actual alpha transparency across all surrounding empty space. No background color, no checkerboard baked into pixels, no background rectangle.
Remove all scene, vehicles, city, road, buttons, promotional copy, score card and UI. The only text in this image is AUTOROO. No extra lettering or watermark.

## Stunt vignette

Use case: style-transfer.
Asset type: production transparent PNG standalone stunt vignette for the right side of the Autoroo arcade driving game menu.
Input image 1 is a supporting style and color reference: approved Autoroo concept A. Recreate its car-over-bus stunt as a considerably simpler isolated sticker-like illustration.
Subject: one cobalt-blue angular LOW-POLY toy sports car halfway through a sideways barrel roll above one purple single-deck city bus. Car body color #0b3d82, bus body color #7656d6. Both vehicles must have actual low-poly toy geometry: broad flat polygon facets, angular boxy shapes, simplified wheels, limited clean detail. The car is tilted sideways in mid-air, showing its top, side and wheels. The bus is fully below it, in a readable three-quarter view. Navy edges unify the two vehicles. One cream curved motion swoosh arcs around the car and ends above the bus. Add only a few tiny yellow stars.
Style/medium: polished cohesive playful arcade sticker art, faceted low-poly toy rendering with clean navy contours and restrained shading. Same cream/navy/yellow vocabulary as the reference but far simpler.
Composition/framing: wide-ish square canvas, about 1.15:1, tightly composed but with small clear padding; whole car, whole bus, all wheels, swoosh and stars must be fully contained. Vehicles are the dominant subjects.
Scene/backdrop: genuinely transparent alpha background everywhere around the isolated objects. No solid backdrop, no checkerboard baked into pixels, no road, no city, no scenery.
Constraints: one car, one single-deck bus, one main cream motion swoosh, a few tiny yellow stars. No logos, no text, no route numbers, no license plate characters, no people, no UI, no score panel, no watermark.

## Validation

Both output files are RGB PNGs with a baked checkerboard and no alpha channel. They do not meet the requested transparency requirement. Original pixels are preserved without alteration.
