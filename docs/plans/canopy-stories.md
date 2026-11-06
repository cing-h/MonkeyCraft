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
2. **Roaming between stories.**
   - Crew and villagers travel to all three levels: climbing trunks from the ground to Canopy 1, ladders and vines between Canopy 1 and Canopy 2, and walking the bridges. The swingers brachiate under the boughs.
   - Some villagers live up there.
   - The truthful-station rules are unchanged, and a job brings anyone home from any story.
   - The camera follows a crew member who asks a question.
3. **Finish.**
   - Chatter bubbles follow the camera.
   - The roster says which story and plot a crew member's house is on.
   - Speed checks.
   - Screenshots of each story, then a live look with the user.
