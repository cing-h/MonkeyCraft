# Item 5: the canopy stories (plan)

Branch `feature/canopy-stories`, built on `feature/chief-roams`. The design is in `edition1-final-changes.md`, item 5. This file is the build plan, with a check-in after each phase.

## How it fits the existing village
- The world becomes three views tall, 960 × 540 px. The ground village keeps its coordinates, world y 0–180. Canopy 1 is y −180–0 and Canopy 2 is y −360–−180.
- The framebuffer gains a vertical camera offset (`oy`), so existing drawing code keeps working in world coordinates. The tall layers (back trees, the village) are one image each, covering all three stories. Each full-screen pass (mist, light shafts, the lagoon) only runs on rows that are on screen.
- Each canopy story has one continuous **walkway**: a platform round each of the five great trunks, plus a bough platform between each pair of trunks, all joined by sagging rope bridges. It works like the ground path, as a lane with a height at every x. That's what lets the apes roam up there with the existing trip planner.
- **Plots:** the four bough platforms on each story are reserved for future crew, eight in all. Each is marked with corner stakes, a string and a blank sign. The Clerk (item 1) gets one on Canopy 1.

## Phases
1. **World, camera and art.** DONE (2026-11-06). The tall world and vertical camera:
   - Controls: mouse wheel, ↑/↓ keys, dragging in both directions, and ▲/▼ buttons.
   - A story indicator (Ground · Canopy 1 · Canopy 2) that also jumps between stories.
   - The art:
     - the trunks continue upward and taper, with forked boughs holding up the platforms;
     - the walkways and rope bridges, with ladders between the stories;
     - layered leaf masses, lianas and vines, orchids, bromeliads and hibiscus;
     - light and haze that change with height (damper and hazier low down, sunnier at the top, with sky between the highest crowns).

   Also tests for the camera bounds and the plot layout.
2. **Roaming, culture and the council.** The user added a culture and a council on 2026-11-06 and chose a real council that meets when called by a button or once a day, in the Council Ring on Canopy 1. Built in three parts, with a check-in after each:
   - **2a. Roaming between stories.** DONE (2026-11-06). Lanes and routes live in `ui/station/ape/lanes.js`. Five free-roaming villagers (smaller, no glow, no tools) plus far-branch villagers on both canopy stories. The Chief's strolls sometimes go up the great trunk to Canopy 1. Fixed on the way: turns are a short flip instead of an instant mirror, and the body eases between resting placements.
     - Crew and villagers travel to all three levels: climbing trunks from the ground to Canopy 1, ladders and vines between Canopy 1 and Canopy 2, and walking the bridges. The swingers brachiate under the boughs.
     - Some villagers live up there.
     - The truthful-station rules are unchanged, and a job brings anyone home from any story.
   - **2b. A culture, decorations and the Council Ring.** DONE (2026-11-06). In `ui/station/ape/culture.js`, lore in `docs/culture.md`. The user added commerce and art: the villagers have trades (fruit stall, painter, carver, weaver, courier). Also fixed: the hanging fronds in the foreground keep to the top of the screen on every story, redrawn as broad drooping leaves. The villagers are a *Civilization of Knowledge*.
     - **Lore** (written in `docs/culture.md`):
       - The way of the Leaf-Ledger: be curious, keep careful records, share the fruit you find, and give honest feedback ("a branch that hides its rot breaks").
       - Sayings, and a glyph alphabet (eye, leaf, scroll-spiral, open hand).
       - Rituals: the Dusk Gathering at the Ring; a lantern lit at the Ring each time a real job finishes; the drum that calls a council.
     - **Decorations:**
       - carved totem poles with faces of each crew species in its colour;
       - woven pennant bunting strung between the trunks on all stories;
       - painted glyphs on the huts;
       - gourd lanterns and woven "idea nets" (knowledge catchers);
       - masks and shields on the Chief's lodge;
       - an offering shrine with fruit and scrolls.
     - **The Council Ring:** the wide platform round the great trunk on Canopy 1, widened. The trunk is carved as the talking-totem. There's a fire bowl, woven mats and log stools, banners, hanging lanterns and a council drum.
     - **Scenery gatherings:** now and then, villagers and free crew gather there to drum and chat (written lines, which can now include culture sayings). These are scenery and never claim real work.
   - **2c. The real council.** DONE (2026-11-06). In `src/crew/council.js` and `src/routes/council.js`. A live council on 2026-11-06 heard the Smith and the Archivist (real, specific points) and filed a significant report, for about $0.027 (subscription estimate). The user also asked to remove the hanging foreground fronds (done). A council is an ordinary Chief job, so it gets the usual events, limits, Job log and STOP.
     - **What it is:** a Chief job marked `source: 'council'` (an existing optional field).
       - The Chief gets a digest of the jobs since the last council: the task, the outcome and his final summary.
       - He asks each awake crew member for its thoughts. Members get no tools at all: they can only think and talk.
       - Members run on the cheap model; the Chief runs on his own.
     - **Members' thoughts:** each member gives feedback on the recent work from its own role, plus ideas and worries, each marked as routine or significant.
     - **The report:** the Chief weighs them and writes a short **council report** for the user, only if something is significant. Otherwise the log just says the council met and nothing needs the user's attention.
     - **When:** a **Call a council** button at any time, plus an automatic council at most once a day. It only meets automatically if at least 3 jobs have finished since the last council and nothing is running.
     - **Limits:** a council uses its own small spending cap, inside the daily limit.
     - **Truthful village:** while a council job really runs, the members who take part walk to the Ring instead of home. The fire is lit high and each speaker shows the "…" plate while it really thinks. When it ends they go back to roaming.
     - **Seeing the report:**
       - a **COUNCIL REPORT** entry in the Job log;
       - a notice by the Chief's name in the header until it's read;
       - on screen, the Chief raises the council banner on his lodge.
     - **Events (additive):**
       - `council.say` (a member's short point, and whether it's significant);
       - `council.report` (whether it's significant, and the report).
     - **Checks:**
       - members have no tools;
       - the automatic council respects once a day, 3 jobs and nothing running;
       - nothing is reported when nothing is significant;
       - council apes go to the Ring only while the council job runs;
       - a live council run.
3. **Finish.**
   - Chatter bubbles follow the camera.
   - The roster says which story and plot a crew member's house is on.
   - Speed checks.
   - Screenshots of each story, then a live look with the user.
