# Kosmos — design brief

Planning notes for the Kosmos redesign (Unslop Design 1.7). Not shipped; the product follows it.

## Interview (2026-11-11)

- **Kind of change:** full redesign. The content and how it works underneath are kept.
- **Must stay:** the AI chat panel, the three modes (Structure / Bug risk / Refactor), light and dark themes.
- **Name:** "Architecture Mapper" is now **Kosmos** — "Kosmos means organized". A **new mark** is drawn for it.
- **Who:** "people who are into coding, their ability can range from a bit technical to senior"; they come because
  "they don't understand how the code works and want to grasp the concept on how the codebase works".
- **What's wrong now:** "The whole UI UX is horrible, so many stuff is happening on the same screen, too many panel is
  open, not clean and minimal."
- **The first paste:** "it should be clean, improve their mood, minimal."
- **Feeling the user named:** "a playful vibe with comic book style minimalist".
- **Accepted recommendations:** one screen (map + plain-English story) instead of Overview/Diagram tabs; at most one
  side panel open, closed by default; plain words first, technical numbers one click away ("How was this worked
  out?"); the AI autopilot waits for a button instead of starting by itself; animation level Standard plus one
  expressive moment (the map assembling on first load).
- **Assumed (craft defaults, not asked):** no sound; desktop first, with a working phone layout (map + one panel as a
  bottom sheet).
- **Take picked (2026-11-11):** Take 1 "Clean ink" + the tour from Take 3 (the narration box's "Take the tour" walks
  the map part by part).
- **Verdict (2026-11-11):** "One of the main things I want to emphasize is organize the diagram cleanly." Rule: the map
  is the product; it must read as an organised picture at rest, never as wiring.
- **Verdict (2026-11-11):** "AI architecture only", confirmed as "the map groups files only by the parts the AI
  designs". Rule: no Folders / Clusters choice on the map. Files sit in their folders until the AI has designed its
  parts, then only in the AI's parts. The clustering search still runs (the AI builds its parts from it, and it is
  graded), but raw clusters are never drawn. The View menu says which it is and offers "Sort with AI".
- **Verdict (2026-11-11):** "there should also be a section or tab where we can see the bug highlight in red". Rule:
  bug risk is printed in the red ink (red halftone dots). Bug risk has a "Bugs found" section first. Each bug the AI
  finds opens to show its code with the faulty line in red, and its box gets a red outline and a "N bugs" tag.

- **Verdict (2026-11-11), replaces "the autopilot waits for a button":** "when people click on draw the map, AI will
  automatically get to working and only display AI architecture, their analysis, and refactor". Rule: when the AI
  is set up, the full pass starts by itself when a project opens, and no panel opens for it. The header's Ask AI
  button shows the progress ("Sorting… 1/3"); each mode tab shows a spinner while the AI works on it, then a dot
  while its result is new to the user. Each story box says what the AI is doing for that mode, with "Watch it work".
  The map ends on the AI's parts, Bug risk on the AI's findings, Refactor on the AI's rules and plan. The AI leads
  (switches modes, moves the camera) only until the user takes over (picks a mode, a box, a panel, the tour, a
  link); after that its results still land, but it never moves the user's view.

- **Verdict (2026-11-11), replaces the auto-start-on-the-map rule above:** "each page should be separate by route instead
  of SPA" and "before the result is shown, make sure there's a waiting screen for AI to finish ... we want to display
  what AI has given, not the manual anymore, scrap those". Rules: `/` start, `/analyze` waiting screen, one route per
  map mode sharing the map layout. The map opens only when the AI's pass is done. Manual controls are gone (rule
  editing, Find a plan, search settings, test outcome marking, model sliders, Sort/Find-bugs buttons). What stays: the
  AI's results, the technical details behind them (read-only), plan playback, and the chat. If a stage fails the
  waiting screen offers "Try again" or "Show what's ready"; without an AI key, "Show Kosmos's own results".

- **Verdict (2026-11-12), replaces "the map waits for the whole pass":** "waiting for the first phase should be enough
  ... the bug analysis and the refactor should work on the background ... if user switch to bug finder immediately, we
  can show the analyzing... screen". And on the diagram: "it doesnt have to be very very detail, just show the
  relationship, label of main box components and how they are connected ... use diffrent shape of box to indicates the
  differences between component". Rules: the waiting screen waits for stage 1 only and shows no "later" steps ("no need
  to show part 7 later"). Bug risk and Refactor show "Analyzing…" until their stage is done (tabs: spinner, then a dot).
  The map is a relationship diagram: a few labelled parts, every connection an arrow, no shelves, no file counts or
  markers, and one shape per kind of part (window, pill, hexagon, cylinder, library box, parallelogram, document) with
  a key. The plan plays on the part-level map (no forced file view).

- **Verdict (2026-11-12), replaces "every connection an arrow":** "the diagram are very very unorganoized and messy, is
  there a way we can minimize to the main points, and make sure everything is clean". Rules: at rest the map draws
  only the main connections. An arrow is left out when the map already tells it through other parts by arrows at
  least half as heavy, or when it points up the map (while both parts keep another arrow). Left-out arrows appear when
  one of their parts is hovered or picked, or when they matter (a broken rule, a plan step); View → "Show every
  connection" draws them all. Measured on this repo's own 7-part map: 18 arrows → 7, no arrow looping round the map.
- **Verdict (2026-11-12):** "user shouldnt drag everything around, as it causes the original clean diagram to be very
  messy, but there should be two version with fixed position, first one is the unexpanded version where it only
  displayed the main components, other is when user can toggle on the component which expand and show users the
  individual file". Rules: boxes can't be dragged ("Tidy up again" is gone). The closed map is one fixed picture;
  opening parts gives the second, where every part keeps its row and its place in the row, the arrows between parts
  stay the closed map's part-level arrows, and an opened part shows its files with the main arrows between them. A
  file's own arrows (to other parts, or the minor ones inside its part) show while that file is hovered or picked.

## The map, organised (rules every layout follows)

1. **Rows by layer.** Parts sit in rows by what depends on what (top: what people see; bottom: what everything
   shares), aligned to a grid, with equal sizes inside a row. At most four parts side by side; a wider row wraps, and
   parts with no arrows at all sit in a grid underneath.
2. **Shelves for shared parts.** A part used by most of the others (at least 60% of them) and using none of them
   sits on a full-width shelf at the bottom. It says in words who uses it ("Used by every part above"); each box
   shows small markers for the shelves it uses. Arrows into a shelf are never drawn just because something is in
   focus. Only arrows that matter (a broken rule, a plan step) are drawn, and they run down a lane left of the map
   and enter the shelf from the side, so they cross nothing.
3. **One connector per source.** When one part uses several parts in the next row, it gets one branching connector,
   not a fan of separate lines. Arrows into a part arrive side by side, each with its own head, so a junction always
   means one part branching, never two parts merging. One arrow per pair of parts; the count of imports shows on hover.
4. **Loops side by side.** Two parts that need each other sit next to each other with one red two-way arrow, labelled
   "loop".
5. **No arrow crosses a box,** and arrows cross each other as little as the layout allows. Opened parts show their
   files in a tidy grid, not one long row.
6. **Quiet at rest, clear on focus.** Only the main connections are drawn at rest. Hovering or picking a part draws
   all its arrows bold (the minor ones too, on their own paths around the boxes) and fades the rest.
7. **Two fixed pictures.** Nothing is dragged. Every part closed, or some parts opened to their files; opening a part
   only grows its box, it never reshuffles the others or changes the arrows between parts.

## Mode

App (people return to explore repos, hunt bugs, plan cleanups), plus one site surface: the landing page, for a
first-time visitor who pastes a repo once.

## Task table

| Task | How often | Steps now | Target |
|---|---|---|---|
| Paste a repo and see how it is organised | every project | paste → Analyze → wait → read Overview cards → Diagram tab → open modules (5) | paste → Enter → map + story (2) |
| Understand one part (what it does, what it uses, what uses it) | many times a session | click module → click file → read Inspector (3) | click a box (1) |
| Ask a question in plain English | several a session | panel already open, type (1) — but it is always in the way | press "Ask AI" or `/`, type (2) |
| Find where a bug probably is | sometimes | Bug risk tab (top right) → load report or mark tests → read list (3+) | Bug risk → "Load test results" or "Which tests fail?" → list (2–3) |
| Plan a cleanup | sometimes | Refactor tab → edit rules language → Find a plan → step (4+) | Refactor → "Find a plan" with suggested rules (2) |
| Let the AI organise everything | once a project | starts by itself | one button (1) |

## Feeling table

Words, from the user's answers: **playful** ("a playful vibe"), **organised** ("Kosmos means organized", "clean,
minimal"), **cheering** ("improve their mood").

| Layer | Decision |
|---|---|
| Temperature and colour | comic print: white bristol board, India-ink outlines, flat process colours (yellow, cyan, red), tints as Ben-Day dots. Dark theme: the same page at night — ink-navy ground, off-white ink, the same process colours a step lighter. |
| Type | Shantell Sans (made for comic lettering; variable bounce axis) for the name, headings and the narrator; Atkinson Hyperlegible Next for UI and reading; Atkinson Hyperlegible Mono for file paths. |
| Rhythm and density | airy: one big panel, wide gutters, few things on screen; detail on demand. |
| Shape language | confident ink outlines (no sketchy wobble), square-ish panels, round speech balloons with tails, starburst only for problems, hard ink offset shadow only on things you press. |
| The first screen's form | the codebase map is the one big comic panel; a yellow narration box overlaps its corner and tells the story in plain words. |
| Motion character | snappy and springy: presses squash into their shadow; the map assembles panel by panel once, on first load. |
| Copy voice | a friendly narrator in plain words ("Here's how restaurant-app fits together."). No "POW!" in labels; one celebration word at most. |
| Sound | none (assumed). |

## Rejection

- **Fonts out (the first ten):** Bangers, Comic Neue, Luckiest Guy, Fredoka, Baloo 2, Nunito, Poppins, Inter, Geist,
  Space Grotesk.
- **Layouts out (the first five):** map + inspector + chat in three panes (today); dark icon sidebar + map + drawer
  (SaaS starter pack); a dashboard of cards before the diagram (today's Overview); full-screen map under floating
  toolbars everywhere; chat-first with the map in a side canvas.
- **Paradigm:** the comic page (asked for by the user; not on the overused list).
- **Palette from a real material:** four-colour comic print — paper, ink, process yellow, process cyan, process red,
  plus halftone tints.

## Tokens (light)

paper `#FFFFFF` · gutter `#F4F2EE` · ink `#17161C` · ink-soft `#55535E` · yellow `#FFD84D` · cyan `#1E9BD7` ·
red `#E5383B` · green `#22A06B`. Module families: 8 flat tints drawn from the same inks.
Type 12 / 14 / 16 / 20 / 28 / 48. Radii 4 / 8 / 12 / 20 / round. Controls 32 / 40 / 48. Space 4 · 8 · 12 · 16 · 24 ·
32 · 48. Ink lines 1.5 / 2 / 3 px. Press shadow `3px 3px 0 ink` → `0 0` when pressed.

## Bold pass

- **World inventory:** panels, gutters, speech balloons, thought bubbles, narration boxes, splash page, cover, issue
  number, page number, Ben-Day dots ✱, ink line weights ✱, lettering ✱, starbursts ✱, speed lines, emanata,
  registration marks ✱, reading order, "to be continued", inset panels — and from Kosmos: order, a tidy grid,
  things snapping into place.
- **Ladder (first screen after paste):**
  0. today's tabs, three columns and cards;
  1. comic ink and colour on a normal layout;
  2. the map is one comic panel, the story is its narration box, a clicked box answers in a speech balloon, bug risk
     is printed as halftone, the refactor plan is a strip of numbered panels;
  3. the tour: Kosmos reads the codebase to you panel by panel ("Next →" or →), zooming the map to each part, with
     the whole map always one key away. **Build rung 3** — it serves the main job ("grasp the concept").
- **Signature details:** halftone bug risk (more dots = more likely, with the %); the refactor plan as a comic strip
  synced with the map; speech-balloon file details pointing at the box; starburst badges for loops and overloaded
  files; analysis progress as four panels inking in.
- **Unprompted extras (to build at least two):** the commit hash as the issue number; an "All tidy!" burst when a plan
  fixes everything; the mark's colour plates slip slightly out of register on hover; `?` shows the keyboard shortcuts
  on a comic panel; a greeting that follows the time of day on the landing page.

## Lived-in detail (main screen)

Arm's length: the big inked map panel; the narration box overlapping its corner; flat-tinted module boxes; the
balloon popover; the three mode tabs. Reading: step and panel numbers in lettering; "6 parts · 16 files"; file
paths in mono; narration in Shantell; "more dots = more likely". Magnifier: halftone dots; outer 3 px vs inner 2 px
ink; balloon tails; registration offset on the mark; starburst points; the issue number.

## What shipped (2026-11-11)

- **One screen:** header (mark, project name opening "About this project", mode tabs, Ask AI, New repo, account) →
  one inked map panel → the yellow narration box on its corner → at most one side panel (`SidePanel`: the mode's
  details, "About this project", or "Ask Kosmos"). The story steps aside while a panel is open below 1700 px. The
  camera frames the map around whatever floats over it (`getInset` measures `[data-overlay]`).
- **Story per mode:** Structure tells the project's shape and offers the tour; Bug risk names the likeliest files,
  or the bugs the AI found; Refactor says whether the rules are kept, finds a plan, and plays it step by step. "All
  tidy!" is stamped when nothing breaks the rules.
- **Landing:** time-of-day greeting, one lettered line, the repository box with a yellow press button, examples, a
  small drawn map of what you get, progress as numbered panels inking in.
- **Extras built:** commit hash as the issue number ("No. a1b2c3d"), "All tidy!" burst, the mark's cyan plate slipping
  out of register on hover, `?` keys card, time-of-day greeting.

## Review record (2026-11-11)

Browser: headless Firefox, production build, 1280×860 and 390×844, light and dark, sample project. Three rounds.

| Round | Found | Fixed |
|---|---|---|
| 1 | story box covered the map; spotlight didn't fade other boxes (`k-pop` fill `both` pinned opacity); arrows into shelves drawn straight through boxes; cyan focus ring on panels (unlayered rule beat utilities); key handlers threw on non-element targets | camera insets; `backwards` fill; shelf arrows only when they matter, in a lane; focus rule moved to `@layer base`; `instanceof Element` guards |
| 2 | map squeezed to a sliver with story + panel open; AI panel opened scrolled to the bottom; the user's own plan counted as "the AI's take"; no refit on resize; phone story pushed its buttons out of view; muddy disabled main button | story steps aside, insets capped at 55%; scroll only with messages; AI results = architecture or review; ResizeObserver refit; phone story body scrolls, actions fixed; button stays bright, empty submit focuses the box |
| 3 | a rule-break arrow left its file sideways through neighbours; dots ate the small labels at high risk | arrows leave from the bottom and dodge obstacles; thinner dots + paper halo on labels |

Not checked: performance under 4× CPU throttling; a separate cold-read reviewer (the critique rounds were done
in-session); live AI replies (the AI panel was checked empty and with its intro only).

