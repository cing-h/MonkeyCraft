# Village revamp (final-changes item 7)

Status: PLAN, waiting for the user's approval.

## Research: how monkeys and apes really climb (for the climbing animation)
- **Going up a trunk or pole:** primates slow down, keep more limbs on the support at once (three limbs gripping most of the time), and move in a steady alternating rhythm. Most use a *diagonal* sequence on the way up (a hand and the opposite foot move close together) and a *lateral* one on the way down (Granatosky, Schmitt & Hanna 2019, *J. Exp. Biol.*; eLife preprint 2025). Gorillas mostly climb with diagonal sequences, and chimpanzees more often with lateral ones (Neufuss et al. 2018, *J. Zool.*).
- **Apes:** they climb with flexed elbows, reach high and pull. The feet push with a strongly bent ankle that presses the sole flat against the trunk (studies of wild chimpanzee ankles). The body hugs the trunk.
- **Coming down:** usually rump-first and slower, with more limbs on the support. Downclimbing is a separate skill with its own forelimb pattern, not climbing run backwards (Royal Society Open Science 2023, mangabeys and chimpanzees).
- **Capuchins:** diagonal sequences on branches and lateral ones on the ground (J. Hum. Evol. 2008), quick and springy on vertical supports, with the tail used as a balance and brace.
- **In the air:** leaping primates turn in mid-air by swinging their limbs or flicking the tail. Small primates use the tail to change their spin, and bigger ones counter-rotate their arms. They bring the feet forward for the landing, often with a partial backward somersault (studies of leaping lemurs, galagos and tarsiers). A *full* flip is artistic licence, but the tuck-to-spin-faster and open-out-to-land timing is real physics, and that is what we animate.

## Phases (one branch each, stacked; check in after each)
1. **`feature/darker-trees`: the trees.**
   - Darker, richer bark: deep furrows, knots, moss and lichen patches, and buttress-root shading.
   - Leaf clusters with more edge detail, plus epiphytes and hanging roots. The palette is about 15–20% darker, with the sunset rim kept, so the apes and glowing windows stand out more.
   - The same tree positions, so nothing else moves.
2. **`feature/ape-detail`: the sprites.**
   - Each ape gets more shading bands, fur tufts on the outline, ears, a brow ridge and nostrils, finger and toe hints, and fuller species markings, such as the Chief's silver saddle, the mandrill's ridged muzzle and the capuchin's cap.
   - The soft toon style and the size stay the same, unless the user wants the apes a little larger to make room for the detail (see the question below).
3. **`feature/ape-climb`: climbing.** A new climbing gait for trunks and ladders, built from the research.
   - Going up: three limbs gripping, a diagonal rhythm, high reach-and-pull with flexed elbows, feet pushing flat with a bent ankle, and the body close to the trunk.
   - Going down: rump-first, slower, with a lateral rhythm.
   - Each species climbs in its own way. The gibbon goes hand over hand with its legs tucked. The gorilla is slow and heavy. The orangutan uses all four hands. The capuchin is quick and springy, with its tail braced.
   - The speed is matched to the distance the hands travel, so no hand slides.
4. **`feature/vine-swings`: vines, air time and flips.**
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
