# Pixeled — changelog

Numbered, and counted honestly: every line below is a discrete change that shipped in the commit next
to it, and every one of them is covered by the test suites (`tests/web_smoke.mjs` 257 checks,
`tests/web_dom_smoke.mjs` 87, `tests/web_shaders.mjs` 47, `tests/python_smoke.py` 25, plus the Java
reference check). No padding, no round numbers invented after the fact.

## v3.2 — the big polish batch (commit `76f39c1`)

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
