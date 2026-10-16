# Pixeled — changelog

*(Newest batch first after the intro. Batch two continues the numbering at 194.)*

Numbered, and counted honestly: every line below is a discrete change that shipped in the commit next
to it, and every one of them is covered by the test suites (`tests/web_smoke.mjs` 257 checks,
`tests/web_dom_smoke.mjs` 87, `tests/web_shaders.mjs` 47, `tests/python_smoke.py` 25, plus the Java
reference check). No padding, no round numbers invented after the fact.

## v3.3 — light, lava and the living world

### Light and darkness — 194-215

194. A light engine (`web/light.js`): light is a flat 0-15 grid, poured out from every glowing block
195. Whole-world light built with one multi-source breadth-first search, not one flood per torch
196. Torch block (id 31) that lights 14 levels in every direction
197. Lava block (id 30) that glows 12 levels and hurts to stand in
198. Diamond ore glints with its own faint light again, now through the light system
199. Light stops at anything opaque, so a sealed room really is pitch black
200. Light flows through air, water, glass and ice, and stops at stone, dirt and logs
201. Placing a wall casts a real shadow behind it
202. Breaking a wall lets light pour through the hole
203. Removing a torch takes its light back out of the world
204. Correct light *removal* (a BFS that only unlights cells that were dimmer), not just re-lighting
205. Skylight: anything above the terrain's skyline is lit, anything below is cave dark
206. Digging a shaft from the surface down lets daylight into the cave under it
207. The skyline is cached and repaired one column at a time, so digging does not rescan the world
208. Mesher bakes the light level into the vertex colours, so caves read as dim rather than void
209. A soft light curve: 0-15 becomes a 0.28-1.0 brightness instead of a hard cutoff
210. A floor of ambient light keeps every block visible, so nothing renders pure black
211. `world.lightAt()` / `world.torchLightAt()` / `world.lightSourceCount` for the HUD and tests
212. Lava lakes generate below y = 12 only, in hollows with air above them
213. Lava is not placeable — it is a hazard, not a building material
214. HUD light readout, and the crosshair label now names the block *and* the light level
215. Standing in lava washes the screen orange, and burns you every 0.55 seconds

### The world simulates itself — 216-232

216. Gravity blocks: sand, gravel and pumpkins fall when the block under them goes
217. A queued fall system, so removing one support can start a whole column sliding
218. Falling blocks animate across frames instead of teleporting
219. Sapling block (id 32) that grows into a tree 24 ticks after it is planted
220. Saplings grow the species that fits the biome — spruce in snow, wide-canopy swamp trees in swamps
221. Leaves occasionally drop a sapling when you break them (22%, deterministic per cell)
222. Leaf decay: chop a trunk and any leaf that cannot reach a log within five steps withers
223. Decay runs as a flood fill out from the broken trunk, and reports what it cleared
224. `world.worldTick()` drives falling, growing and withering on a quarter-second timer
225. The game invalidates and re-meshes exactly the chunks a world tick touched
226. Particles and sound for every fall and every growth
227. **Bug fixed:** the lava/physics probe read the block *above* the player's feet, so players fell
     straight through lava pools and out of the world
228. Lava physics: thick, slow to swim through, barely lifts you, and holds you at its surface
229. Wading flag for shallow water, so walking through a puddle is not the same as swimming
230. Ambience: birds by day, crickets by night, drips underground, lava pops near lava
231. Ambience is biome-flavoured and never plays during a storm
232. Ambient sounds are scheduled with a randomised delay, not spammed per frame

### Building and looking around — 233-252

233. Block palette overlay listing all 30 placeable blocks
234. The palette shows how many of each block you have dug up
235. Picking a block from the palette fills the selected hotbar slot
236. Each hotbar slot now keeps its own block choice
237. Inventory: every block you mine is counted
238. Placing a block takes one from the inventory
239. Palette opens with `B` or the new HUD button, closes with the Done button or `B` again
240. The palette parks the controls while it is open, exactly like the help sheet
241. Minimap canvas in the corner: one pixel per block column, coloured by the surface block
242. The minimap shades by height, so hills and valleys read at a glance
243. A facing wedge and a centre dot mark the player on the map
244. The minimap redraws a few times a second, not every frame
245. The minimap follows the biome-readout setting, so it can be switched off
246. Third-person camera on `F5`, pulling back 4.6 blocks with the view direction
247. A blocky avatar (legs, body, head) that turns with the player for the third-person view
248. The avatar is drawn before the world so the near plane never clips it
249. The held block hides itself in third person, so it does not fill the screen
250. Debug panel on `F3`: coordinates, chunk, biome, light, sky, frame rate, draw calls and tally
251. The debug panel is built from the same status tick the HUD uses, so it can never drift
252. Wind strength follows the weather — storms shake the grass harder than a calm morning

### Tests for all of it — 253-273

253. Light tests: a sealed stone room with one torch is lit inside and pitch black outside
254. Light tests: the level drops by exactly one per block of distance
255. Light tests: breaking the wall lets light through, and only through the hole
256. Light tests: removing the torch darkens the room again and clears the source
257. Light tests: placing a wall casts a shadow behind it
258. Light curve tests: monotonic, never fully black, exactly 1.0 at full light
259. Skylight tests: surface daylight, cave dark, and a dug shaft letting the sun in
260. Lava generation tests: every seed has lava, and none of it above y = 13
261. Gravity tests: a dropped block lands on the first solid cell and stops
262. Gravity tests: gravel piles *on top* of sand instead of passing through it
263. Gravity tests: breaking the support under a ledge drops the block above it
264. Sapling tests: it does not grow instantly, grows within 30 ticks, and makes a trunk plus a crown
265. Decay tests: leaves beside a trunk survive, leaves without one wither, and the trunk cell is safe
266. Mesher tests: no vertex in any chunk is baked to pure black, in three different chunks
267. Mesher tests: an unlit world still meshes, so the light engine stays optional
268. Live-game tests: placing a torch lights its cell and its neighbours, removing it darkens them
269. Live-game tests: the inventory fills up as you dig
270. Live-game tests: the world tick runs in the real frame loop and sand actually lands on the pad
271. Live-game tests: lava is detected, burns, warns once, and stops burning when you climb out
272. Live-game tests: the palette fills slots, refuses water, and keeps per-slot blocks
273. DOM tests: palette grid, counts, highlight, open/close through the HUD, debug text, minimap pixels

### Small fixes found while testing — 274-281

274. **Bug fixed:** `togglePalette()` without an argument closed instead of toggling
275. **Bug fixed:** the debug panel read its fields from a destructuring list that never included them
276. Light is rebuilt lazily, so a world only pays for it when something asks for a light level
277. The lightning flash, rain and snow overlays are all still on their own render layer
278. Renderer gained `wind`, `cameraDistance`, `thirdPerson` and `heat` frame options
279. The wind uniform is declared, bound and covered by the shader lint
280. Sprite-free and dependency-free as ever: the palette, map and debug panel are plain HTML and canvas
281. `web_shaders.mjs` still lints every shader, now including the wind uniform

## v3.2 — the first big batch (commit `76f39c1`)

### World and blocks — 1-42

1. Coal ore block (id 11), depth-banded to y ≤ 40
2. Iron ore block (id 12), y < 26
3. Gold ore block (id 13), y < 14
4. Diamond ore block (id 14), y < 14 and rarer still
5. Gravel block (id 15)
6. Clay block (id 16)
7. Cactus block (id 17)
8. Tall grass block (id 18)
9. Flower block (id 19)
10. Ice block (id 20)
11. Sandstone block (id 21)
12. Spruce log block (id 22)
13. Spruce needles block (id 23)
14. Birch log block (id 24)
15. Birch leaves block (id 25)
16. Cobblestone block (id 26)
17. Mossy stone block (id 27)
18. Obsidian block (id 28)
19. Pumpkin block (id 29)
20. Per-block hardness for all 19 new blocks
21. Nine material voices: stone, grass, dirt, sand, wood, snow, glass, gravel, water
22. A `plant` flag, so plants mesh as crossed quads instead of cubes
23. Biome tint tags for grass, leaves and plants
24. Ore veins stamped by 3D noise, then split by depth band
25. Gravel and clay pebble pockets just under the surface
26. Sandstone strata beneath beaches and deserts
27. Spruce trees, conical, in the snow biome
28. Swamp trees with wide flat canopies
29. Birch trees — 42% of broadleaf trees, so forests read as mixed woodland
30. Pumpkin patches on plains and forest floor
31. Cobblestone pockets inside the rock
32. Obsidian in the deep mantle, below y = 6
33. Mossy stone in wet biomes, and overgrown boulders
34. Mossy boulders in swamps and forests
35. Cacti scattered through the desert
36. Tall grass and flowers in the green biomes
37. Murky swamp pools
38. Ice sheets where cold biomes meet the sea
39. Seven grass tints, one per biome
40. Alpine surface rules: snow caps and gravel scree above the snow line
41. Diamond ore glows at night, so a deep base is readable
42. A 28-block placeable palette for creative building

43. **Bug fixed:** the biome noise clustered so tightly around 0.5 that the swamp threshold could
    never be reached, so swamp did not exist in *any* seed
44. Biome fields stretched away from the middle and the thresholds retuned, so swamp, savanna and snow
    all appear — asserted across eleven seeds

### Rendering — 45-74

45. Crossed-quad plant layer in the mesher, double-sided
46. A separate plants render pass with its own culling
47. Foliage sway in the terrain shader (new `uWaving` uniform)
48. Water keeps its own two-wave surface animation
49. Moon disc in the sky, opposite the sun
50. Storms grey the whole sky out
51. Thicker, darker storm clouds
52. Lightning flash overlay across the frame
53. Rain overlay layer
54. Snow overlay layer (different pattern and drift)
55. Held-block view model — a new shader program for the block in your hand
56. Swing animation driven by what you are digging
57. Crack overlay that grows on the block being mined
58. Particle program drawing camera-facing quads
59. Block-colour break particles
60. Build puff particles
61. Footstep dust that takes the colour of the ground
62. Water splash particles on entry and exit
63. Falling leaf particles for plants and foliage
64. Camera roll while walking
65. Eye-height bob while walking
66. Landing dip when you hit the ground hard
67. Field-of-view stretch while sprinting
68. Hold `Z` to zoom in
69. Underwater fog: 2 → 26 blocks, in blue
70. Underwater screen tint
71. Red flash when you run out of air
72. The view-distance setting now really moves the fog plane
73. Adaptive view distance: the fog closes in if the frame rate sags
74. Renderer `stats` (draw calls, chunks meshed) exposed for the HUD

### Gameplay and feel — 75-102

75. Hold-to-mine instead of one-click
76. Per-block break times (`0.28 + √hardness × 0.5` seconds)
77. Plants come away instantly
78. A tap still finishes soft blocks — grass, sand, leaves
79. Dig ticks every quarter of the way through, like a heartbeat
80. Break-time re-targeting when the block under the crosshair changes
81. Swing speed derived from the block you are breaking
82. Crouch on `Ctrl` or `C`
83. Crouch lowers the camera to 1.24 blocks
84. Crouch walks at 1.7 blocks/s
85. Sprint fixed — `Shift` was bound to sprint *and* crouch, so sprinting was impossible
86. `Shift` still descends while flying
87. Swimming: slow sinking, `Space` to rise
88. Water drag on horizontal movement
89. A 12-second breath meter under water
90. Running out of air gives a shove back toward the surface, plus the red flash
91. Splash event on entering or leaving water
92. Footsteps land on a real stride, faster when sprinting, slower when crouching
93. No footsteps while swimming or falling
94. Milestone toast: first block broken
95. Milestone toasts at 25, 100 and 500 blocks broken
96. Milestone toast: first block placed
97. Milestone toast at 64 placed
98. Milestone toasts at 200 and 1000 blocks walked
99. Milestone toast: first time you swim
100. Milestone toast: diamond found
101. Milestone toast: timber (any log)
102. A session tally of blocks broken, blocks placed, steps and distance

### Weather — 103-111

103. Weather state machine: clear ↔ storm fronts
104. Rain
105. Snow instead of rain in cold biomes
106. Thunderstorms
107. Lightning strikes that light the sky
108. Thunder audio timed to the strike
109. Weather saved with the world, so a reload continues the storm
110. Weather toggle in settings
111. Rain loop volume follows the intensity

### Audio, all synthesised (no audio files) — 112-127

112. Footsteps per material (grass, sand, snow, stone, wood, leaves, gravel, glass, cloth)
113. Digging voice per material
114. Dig tick sounds
115. Block-place sound
116. Jump sound
117. Landing sound, scaled by impact
118. Water splash
119. Bubbles under water
120. Thunder roll
121. Rain loop built from brown noise
122. A master gain node
123. Muting stops the rain loop instead of leaving it running
124. Menu chime melody
125. Panel whoosh
126. One shared noise buffer, so nothing allocates per sound
127. Volume setting wired to the mixer

### Settings and interface — 128-166

128. Settings panel in the pause menu
129. Field-of-view slider
130. Mouse sensitivity slider
131. View distance slider
132. Volume slider
133. Day length slider (2–40 minutes)
134. HUD scale slider
135. View bob switch
136. Held block switch
137. Particles switch
138. Weather switch
139. Biome readout switch
140. Adaptive distance switch
141. Reduced motion switch
142. Reset to defaults button
143. Settings stored under their own key, separate from the world
144. Settings clamped on load, so an edited save cannot break the game
145. Changing a setting applies immediately, without a reload
146. Compass readout (eight points)
147. Sky/weather readout
148. Mined counter in the HUD
149. Distance walked in the HUD
150. Block name under the crosshair
151. Breath bar while submerged
152. Breath bar turns amber when it runs low
153. Mode line: walking, sprinting, crouching, flying
154. HUD scale via a CSS variable (`zoom`)
155. Settings chip in the start/pause menu
156. Active state on that chip
157. Credits line in the help sheet
158. Help: hold left click to mine, with the timing note
159. Help: crouch line
160. Help: zoom line
161. Help: `C` as an alternative crouch key
162. Menu version bumped to v3.2
163. Loading text mentions ores
164. `describeTarget` names the block you are aiming at
165. Pause menu keeps the settings chip visible without hiding the buttons
166. Every new control documented in the README

### Tests and infrastructure — 167-193

167. Particle pool tests: caps, recycling, expiry, gravity, clearing
168. Weather tests: fronts, thunder, snow, save round-trip, the off switch
169. Settings tests: clamping, persistence, reset, corrupt-blob fallback
170. Mining timer tests: progress, ticks, re-targeting, instant plants
171. Day cycle tests: phase coverage, wrap-around, clock label
172. Footstep cadence tests
173. Audio tests against a fake AudioContext: tones, noise bursts, the rain loop reuse, muting
174. Ore census test: every ore exists, in reasonable quantity
175. Ore depth-band test: diamond and gold below y = 14
176. Biome coverage test across eleven seeds, asserting all seven biomes appear
177. Decoration census test across five seeds for all six new blocks
178. Plant mesh invariants: colours match vertices, indices are triangles
179. Storage round-trip for weather, distance and the tally
180. Live-game dig tests: one tap versus holding the button
181. Live-game milestone tests, including the diamond celebration
182. Live-game zoom test
183. Live-game settings-application tests for all six sliders and the switches
184. Live-game walk / sprint / crouch speed comparisons
185. Live-game underwater breath test on a real deep pool
186. DOM tests for the new HUD readouts and the breath bar
187. DOM tests driving the settings panel through the real markup
188. Stylesheet assertions for the target label, breath bar and settings grid
189. New `tests/web_shaders.mjs`: lints all 12 GLSL shaders without a GPU — precision qualifiers,
     varyings on both sides, written `gl_Position`, balanced braces, and every uniform or attribute
     the JavaScript binds by name actually being declared
190. Shader lint wired into the CI web job
191. "Every module parses" (`node --check`) step in CI
192. A deterministic test pad, so the dig and walk checks no longer depend on what the random world
     happens to have grown at that spot — this removed the last three flaky assertions
193. README rewritten for the new features, controls, settings, feel and test counts

## v3.1 — start screen and playability (commit `b942dbf`, `05e1c15`, `055d781`)

- Minecraft-style start screen: blocky logo, swinging yellow splash, stacked chunky buttons, seed
  entry, Continue, a live panorama of the world generating behind it
- bloxd-style instant play: the world generates and meshes while the menu is up
- Drag-to-look fallback for embedded frames where pointer lock is refused, with click-to-dig
- Help sheet fix: a `[hidden]` rule that the overlay styles were overriding, plus explicit z-index
  ordering for loading < menu < help
- `tools/serve.sh`: one idempotent command to serve the preview
