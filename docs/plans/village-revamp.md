# Village revamp (final-changes item 7)

Status: APPROVED 2026-11-06; building.

## Decisions (2026-11-06)
- **Playground:** both. A ground playground by the river (vine swing over the water with flips into the river, springy net, fruit-toss ring, slide), plus a vine-swing course on Canopy 2.
- **Ape size:** about 25% bigger on screen, to make room for the extra detail.

## Research: how monkeys and apes really climb (for the climbing animation)
- **Going up a trunk or pole:** primates slow down, keep more limbs on the support at once (three limbs gripping most of the time), and move in a steady alternating rhythm. Most use a *diagonal* sequence on the way up (a hand and the opposite foot move close together) and a *lateral* one on the way down (Granatosky, Schmitt & Hanna 2019, *J. Exp. Biol.*; eLife preprint 2025). Gorillas mostly climb with diagonal sequences, and chimpanzees more often with lateral ones (Neufuss et al. 2018, *J. Zool.*).
- **Apes:** they climb with flexed elbows, reach high and pull. The feet push with a strongly bent ankle that presses the sole flat against the trunk (studies of wild chimpanzee ankles). The body hugs the trunk.
- **Coming down:** usually rump-first and slower, with more limbs on the support. Downclimbing is a separate skill with its own forelimb pattern, not climbing run backwards (Royal Society Open Science 2023, mangabeys and chimpanzees).
- **Capuchins:** diagonal sequences on branches and lateral ones on the ground (J. Hum. Evol. 2008), quick and springy on vertical supports, with the tail used as a balance and brace.
- **In the air:** leaping primates turn in mid-air by swinging their limbs or flicking the tail. Small primates use the tail to change their spin, and bigger ones counter-rotate their arms. They bring the feet forward for the landing, often with a partial backward somersault (studies of leaping lemurs, galagos and tarsiers). A *full* flip is artistic licence, but the tuck-to-spin-faster and open-out-to-land timing is real physics, and that is what we animate.

## Phases (one branch each, stacked; check in after each)
1. **`feature/darker-trees`: the trees.** DONE 2026-11-06.
   - Darker, richer bark: deep furrows, knots, moss and lichen patches, and buttress-root shading.
   - Leaf clusters with more edge detail, plus epiphytes and hanging roots. The palette is about 15–20% darker, with the sunset rim kept, so the apes and glowing windows stand out more.
   - The same tree positions, so nothing else moves.
2. **`feature/ape-detail`: the sprites.** DONE 2026-11-06.
   - Each ape gets more shading bands, fur tufts on the outline, ears, a brow ridge and nostrils, finger and toe hints, and fuller species markings, such as the Chief's silver saddle, the mandrill's ridged muzzle and the capuchin's cap.
   - The soft toon style stays. The apes are about 25% bigger (the user's choice); hold heights, door sizes and swing lengths are checked against the new size.
3. **`feature/ape-climb`: climbing.** DONE 2026-11-06. A new climbing gait for trunks and ladders, built from the research.
   - Going up: three limbs gripping, a diagonal rhythm, high reach-and-pull with flexed elbows, feet pushing flat with a bent ankle, and the body close to the trunk.
   - Going down: rump-first, slower, with a lateral rhythm.
   - Each species climbs in its own way. The gibbon goes hand over hand with its legs tucked. The gorilla is slow and heavy. The orangutan uses all four hands. The capuchin is quick and springy, with its tail braced.
   - The speed is matched to the distance the hands travel, so no hand slides.
4. **`feature/vine-swings`: vines, air time and flips.** DONE 2026-11-06.
   - Long lianas hang from the high canopy across the village, a few on each story. An ape grabs one, pumps the swing, lets go near the top of the forward swing and flies on a real ballistic arc to the next vine, a platform or the ground.
   - **Flips:** in a long flight the ape tucks to spin, does one (sometimes two) somersaults, then opens out and brings its feet or hands forward to land. A spin only starts when the flight time allows a full turn, so there's never a half-flip into a landing.
   - The vines sway and swing back after a release. Swingers (gibbon, chimps, bonobo, orangutan, capuchin) use vines for long trips on one story. The heavy Chief never does.
5. **`feature/houses`: every house redone, and the Chief's great lodge.**
   - **Smithy:** a forge that glows and smokes while the Smith works, an anvil, bellows and a tool rack.
   - **Archive:** scroll racks and a ladder to a loft.
   - **Writer's hut:** a lantern porch, a writing desk at the window and drying pages.
   - **Workshop:** a lens rack and a test bench.
   - **Bathhouse:** steam and stepping stones.
   - **Bell tower:** a carved frame.
   - **Lookout:** a telescope and a flag.
   - **Counting house:** small polish.
   - **The Chief's lodge** becomes a multi-level great house in the great tree. It has a main hall, an upper chamber with a balcony and a high seat, carved posts and masks, banners and lanterns, a gong, a lookout cupola and rope walks to the platforms around it. It's lit in the Chief's colour while he works.
6. **`feature/playground`: the recreation area and play.**
   - Play spots: a vine swing over the river (flips into the water), a springy net for bounces and flips, a fruit-toss ring, a climbing frame and a bark slide.
   - Play behaviour: villagers go and play there often, in turns, with chase-and-tag, swings, net flips and catching fruit.
   - **Crew rule (the user's):** a crew member plays only when *no job is running or waiting anywhere in MonkeyCraft*. As soon as any job starts, crew members stop playing and go back to their stations. Busy crew never play (truthful station).
   - Tests: crew never play while any job is active; villagers do.

## Checks for every phase
`npm test` and `npm run check`; screenshots of each change rendered headless (`scripts/render-station.js`); reduced motion means less swinging and no flips.

## Sources
- Granatosky, Schmitt & Hanna 2019, J. Exp. Biol.: https://zendy.io/title/10.1242/jeb.185702
- Neufuss et al. 2018, J. Zool. (gorillas and chimpanzees climbing): https://bham.academia.edu/JNeufuss
- Chimpanzee ankle dorsiflexion in climbing: https://pmc.ncbi.nlm.nih.gov/articles/PMC2672491
- Downclimbing in mangabeys and chimpanzees, R. Soc. Open Sci. 2023: https://pmc.ncbi.nlm.nih.gov/articles/PMC10480693
- Gait and support angle, eLife preprint 2025: https://elifesciences.org/reviewed-preprints/108268v1
- Aerial manoeuvres of leaping lemurs: https://scilit.com/publications/61cff02aab01dd4f8b0426d5849de65a
- Vertical clinging and leaping: https://en.wikipedia.org/wiki/Vertical_clinging_and_leaping

## Phase 1 notes (what was built)
- `scenery.js trunk()` repaints every trunk pixel by pixel, lit from the left.
  - Long fissures follow the angle round the trunk, so they bunch up near the edges. Each has a dark core, a shaded lip and a sunlit ridge beside it, with an occasional wide split and short cross-cracks.
  - There are a few knots, moss on the shaded side, lichen flecks and a crisp shaded edge. The bark is 20% darker.
- `foliage()`: little gaps between the leaves, and single leaf blades that poke out of the rim (lit on the sunny side).
- `GREENS.canopy` and `GREENS.jungle` are darker, with deeper shadows. The sunlit tips stay bright.
- New `aerialRoot()` and `epiphyte()`: 34 aerial roots under each canopy walkway, and ferns clinging to the boughs beside each trunk.
- The trees are pre-painted, so frames cost no more than before.

## Phase 2 notes (what was built)
- `cast.js SIZE = 1.25` scales every body length (torso, head, limbs, tail) together, so poses, swings, climbs and grip positions follow. All the swing tests still pass.
- New detail for everyone:
  - fur strands along the body and tufts over the back, shoulders and back of the head;
  - ears, sized per species (biggest on the chimp; none showing on the snow monkey and howler);
  - a nostril and a mouth line;
  - finger and toe lines;
  - on the bigger heads, a two-pixel eye with a glint.
- Species detail:
  - a brow ridge on the great apes (gorilla, chimp, bonobo, orangutan) and grey in the Chief's crest;
  - the gibbon's white hands and feet, and the bonobo's parted hair;
  - the mandrill's blue muzzle ridges, the snow monkey's fluffy ruff and the orangutan's beard.

## Phase 3 notes (what was built)
- `cast.js P.climb(sp, p, down)` is the four-beat climb.
  - Each hand and foot grips for most of the cycle and lifts off for the rest.
  - A gripping hand or foot is pinned to the trunk's face. Relative to the body it slides back by exactly the body's rise, so in the world it stays still. The joints are solved with a two-link IK (`ik()`): elbows point down, knees point up and in.
  - Going up uses a diagonal sequence (hand with the opposite foot, a quarter-cycle apart) with one limb moving at a time, so three always grip. Going down uses a lateral sequence led by the foot, with the head turned to look down.
- `CLIMB_STYLE` per species:
  - the gorilla is slow, heavy and leans out;
  - the gibbon goes hand over hand with its legs tucked;
  - the orangutan climbs with four hands, its feet gripping high;
  - the monkeys (mandrill, capuchin, snow monkey, howler) are quick, with the tail hanging down the bark;
  - the chimp and bonobo use the default ape climb.
- `climbSpeed()` is the rise per cycle × the cycle rate. The scene climbs at that speed (down is 0.8×, and hurrying home quickens the cycle), so grips never slide. Hand props are put away while climbing.
- `test/climb.test.js`: no grip slides more than about a pixel for any species, up or down; three limbs always grip on the way up; the foot leads on the way down; the gibbon is the fastest climber.

## Phase 4 notes (what was built)
- `vines.js`: long lianas on every story. On the ground they hang from the low branch, in two runs of four. On Canopy 1 and 2 they hang from the leaves about 90 px above the walkway, in two runs each. They're drawn live (`drawLianas` in `scene.js`), so they swing.
- The ride: the ape stands under the first vine, crouches and jumps up to grab it. It then pumps a real pendulum and, on a forward rising swing, lets go at the first moment the predicted arc meets the next vine. A vine caught high is slid down to a full-length grip. The grip is always high enough that the hanging feet clear the floor. On the last vine it waits for a full swing, lets go near the top for big air and lands on the floor. The rest of the trip is planned from wherever it lands. Swingers who hang under walkways first climb up onto the walkway to ride.
- One gravity (`VINE_G` = 240 px/s², about real at the apes' scale). Each flight is followed in closed form, so the catch happens exactly where it was predicted.
- **Flips:** the flight time is known at release. Whole backward turns are taken only if they fit, at no more than the species' top spin rate. The ape spins fastest mid-air while tucked and opens out about 0.14 s before the catch or landing, so there are never half-flips. The gibbon sometimes does a double. The orangutan never flips, and nobody flips in reduced motion. `q.roll` turns the tail with the body.
- A released vine swings back on its own and settles. A ride that can't make the next vine after about 4 s drops off and lands. A job arriving mid-ride ends it at the current vine, then the ape goes home.
- Who rides: gibbon, chimpanzee, bonobo and capuchin (all stories) and the orangutan (shorter runs, no flips), crew and villagers alike. The Chief and the other monkeys walk. Roughly 3 in 4 long trips go by vine (1 in 5 with reduced motion).
- `test/vines.test.js`: every swinger finishes a run on every story, with no jumps and feet clear; a flip only starts when it fits and always finishes; a released vine settles; and a job brings the crew home even mid-ride.
- `scripts/render-station.js` takes an optional world height to look at a canopy story.
