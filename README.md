# DreamCanvas

A free live-wallpaper app for Windows 10/11. It draws original, procedurally generated animations (no downloaded images or videos) behind your desktop icons, and lets you customise them.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and how later phases fit in.

## Status: version 1.0.0, all 8 phases complete (only Phase 6's live Pixabay/Pexels check waits on an API key)

**Install:** run `artifacts\installer\DreamCanvasSetup-1.0.0.exe` (57 MB). It installs for the current user without administrator rights into `%LOCALAPPDATA%\Programs\DreamCanvas`, adds a Start menu shortcut (and optionally a desktop shortcut and start-with-Windows), and appears in Windows *Installed apps*, where *Uninstall* restores your previous screensaver and Windows wallpaper and asks before deleting your projects and videos.

| Area | State |
|---|---|
| **Live Wallpaper Editor** (React + TypeScript in WebView2): library on the left, live canvas in the centre, properties on the right, and the layers and timeline below. Supports drag and drop from the library; move with grid snapping; 8 resize handles with Shift to keep proportions; rotate with Shift for 15° steps; flip; duplicate; delete; copy, cut and paste; group and ungroup (Alt+click selects one member); lock and hide; layer order; alignment to the canvas or to each other; opacity, brightness and animation speed per object; per-object settings and "regenerate shape"; undo/redo where a drag or slider sweep counts as one step; keyboard shortcuts; autosave; Set as wallpaper | Done; runs inside the app at 1366×768. Autosave and thumbnails verified with a real edit |
| **Object library:** 15 original procedural object types, each with its own animation: moon (phases), sun/glow orb, cloud, tree (pine/round/birch), mountains, grass, flowing river, bird, butterfly, fish, cat, particle effect (fireflies, snow, rain, falling leaves, twinkling stars, bubbles), text, digital clock (accurate local time), shape | Done |
| **Scenes:** versioned JSON format (`sceneVersion`) with validation, repair of damaged files, refusal of files from newer versions, and per-object seeds; backgrounds can be a colour, a gradient or any animated preset | Done |
| **My Projects:** new from template or blank, edit, set as wallpaper, duplicate, rename, delete; schema v2 database migration upgrades existing installs in place | Done |
| **Night Forest template:** the spec's example (moon, 3 clouds, 2 birds, 5 trees, a cat, falling leaves, fireflies, a river, a digital clock), all editable; birds fly across, clouds drift, the moon floats and brightens, one cloud fades on the timeline | Done; about 13% total CPU on the desktop (see the performance note below) |
| **Timeline & keyframes:** timeline panel with layer rows and keyframe lanes (expandable per property), ruler/playhead scrubbing, play/pause, length and loop. ◆ next to X, Y, W, H, rotation, opacity and brightness adds or removes a key at the playhead; once a property has keys, editing it (typing, dragging, resizing, rotating, aligning) sets a key at the playhead; **Record** mode keys every change. Keys can be dragged in time, deleted, and given one of 8 eases (linear, ease in/out/in-out, hold, overshoot, elastic, bounce). Undo covers all of it | Done; driven end-to-end in headless Edge (`npm run e2e`) and checked live on the desktop |
| **Movement behaviours** (stackable per object, each with settings): walk, run, fly, jump, bounce, float, swing, rotate, orbit, fall/rise, wander, follow a drawn path, scale pulse, fade/twinkle, **mouse follow/avoid**, **sound reactive**. Animals turn to face the way they move. Paths are drawn by clicking on the canvas and edited by dragging points | Done; keyed motion, fly, walk, path, mouse follow (cursor moved to known spots, position matched the maths) and sound reaction (level rose while a system sound played) verified on the desktop |
| **Screensaver Mode:** a real Windows screensaver (`DreamCanvas.scr`, supports `/s`, `/p <hwnd>` and `/c`). It's registered per user, remembers and restores your previous screensaver, leaves "sign in on resume" untouched, and won't change anything when Group Policy manages it. It can show the desktop wallpaper, a chosen one, or random wallpapers on a rotation. Inactivity choices: 1–60 minutes. | Done; Windows launched it from the registry (path with spaces) and the dialog's preview ran embedded; settings were restored afterwards |
| **Idle Display Mode:** a full-screen animation shown by the engine after inactivity. It never touches lock, sleep or power settings, is skipped when locked, display off, during presentations/games or when a screensaver is up, and closes when Windows locks | Done; triggered live (with a shortened test threshold) |
| **Lock Screen Export:** a pixel-exact PNG at your screen resolution (shaders at full quality); "Set as lock screen" tries the Windows API and falls back to opening Lock screen settings | Export done and verified; the direct lock-screen API call is not exercised (it would change your lock screen) |
| Desktop wallpaper pauses while any screensaver or idle display covers it | Done; verified live |
| Screensaver & Lock Screen page explaining all four modes (Desktop, Screensaver, Idle Display, Lock Screen Export) | Done |
| WinUI 3 app: Home, Wallpaper Gallery (search, category, sort, favourites, live preview, per-wallpaper customisation, Randomize / Regenerate / Reset), Desktop Settings, Performance, General Settings | Done; tested on this machine |
| Wallpaper engine: renders behind desktop icons, one window per monitor at native resolution, 15/24/30/60 FPS cap, pause/resume/stop, tray menu, keeps running after the app closes, restores the last wallpaper on start, start with Windows (HKCU Run) | Done; tested on this machine |
| Auto-pause: fullscreen apps, maximised windows (default on), battery (optional), battery saver at 15 FPS, session lock, display off | Done; fullscreen/maximised/pause tested here, battery/lock/display-off covered by unit tests + manual procedure below |
| Recovery: Explorer restart | Done; verified live (window recreated under the new desktop host about 1 s after Explorer returned) |
| Recovery: monitor/resolution changes | Implemented; **not exercised here** (one monitor; see the test procedure) |
| **23 original presets** in 10 categories, all generated procedurally (no downloaded images), each with its own colour/amount/speed settings and *Regenerate* (new seed → new layout): **Nature** Aurora Sky, Firefly Forest, Desert Dunes, Blossom Breeze · **Space** Spiral Galaxy, Warp Starfield, Deep Nebula · **3D** Solar System · **Ocean** Ocean Sunset, Underwater Light · **Weather** Rainy Window, Snowy Night, Thunderstorm · **City** City Lights · **Neon** Neon Horizon, Geometric Pulse · **Abstract** Flowing Color Waves, Lava Lamp, Liquid Marble · **Minimal** Constellation Network · **Clocks** Glowing Particle Clock, Minimal Analog Clock, Flip Clock (full-screen cards that fold over like a mechanical clock, AM/PM, optional seconds and date; redraws only when a digit changes, about 1.4% CPU) | Done; every preset loads without errors in headless Edge (`npm run smoke`), and all 16 new ones were applied on this laptop's desktop, held 30 FPS and were checked visually |
| **Video Wallpapers** (real camera footage): import your own MP4/WebM files, or search and download free videos from **Pexels** and **Pixabay** through their official APIs (free API key per site, stored encrypted with Windows DPAPI). Topic shortcuts include nature, forest, ocean, rain, snow, mountains, waterfalls, clouds, night sky and more. Each video keeps its creator, source page and licence, and its card shows the credit. Identical files are stored once (SHA-256). Videos play behind the icons with *Fill screen* or *Show whole video*, pause like any wallpaper (0% CPU), follow the speed setting, and work in the screensaver when it shows the desktop wallpaper | Import, library, desktop playback, pause, and the app page (import list, *Set as wallpaper*, key steps) verified on this laptop with real WebM clips. Pexels/Pixabay search and download are covered by tests against their documented response format with a fake network, but **not yet run against the live sites**, because that needs your free API key |
| More asset types (images, Lottie animations as scene objects) | Later; the importer and licence model are in place |
| **Clock & widget studio:** six widgets in the editor's new *Widgets* category, each a normal scene object (move, resize, animate, give movements, layer with anything): **Analog clock** (Classic, Minimal and Modern styles, smooth second hand), **Flip clock** (digits flip on cards as they change), **Word clock** (spells the time, e.g. "IT IS TWENTY FIVE TO SEVEN"), **Calendar** (this month, today highlighted, week starts Monday or Sunday, month and day names in your language), **System monitor** (CPU, memory and battery as rings or bars, "Charging" when plugged in), **Countdown** (to any date, with your own message when it arrives). Optional frosted card behind each. Two new templates in *My Projects → New from template*: **Desk Widgets** and **Word Clock** | Done. Live CPU, memory and battery readings verified on the desktop. The Desk Widgets scene runs at 30 FPS and about 9% CPU. The system monitor shows sample values in the editor and real ones on the desktop |
| **Installer** (Inno Setup 6): per-user, no admin rights; Start menu and optional desktop shortcut; optional start-with-Windows; installs Microsoft's WebView2 runtime if a PC lacks it; updates in place (stops the running engine first and keeps every setting); moves an existing DreamCanvas screensaver or startup entry over to the installed copy; uninstall stops the wallpaper (Windows wallpaper comes back), restores the previous screensaver, removes start-with-Windows and asks before deleting user data | Done; the full cycle (install, run, uninstall, reinstall, update over a running install) was run on this laptop. This found and fixed a bug: Windows stores the screensaver path in 8.3 form (`DREAMC~1.SCR`), which the uninstaller didn't recognise at first |
| **Single instance:** opening DreamCanvas again (Start menu, the screensaver's *Settings* button) brings the open window to the front on the requested page instead of starting a second copy | Done; verified with the installed app |
| **Size:** 297 MB installed (was 357 MB) because the app now references only the Windows App SDK components it uses (no AI/ML runtimes); 57 MB download, because solid LZMA2 compression with a dictionary larger than the app's runtime stores the engine's identical runtime files only once | Done |
| **Sleep and wake:** the engine logs sleep and wake-up and rebuilds its wallpaper windows a few seconds after waking | Done; added for the one unexplained stop seen around standby. Sleep itself still needs testing on your PC (see test step 12) |

Measured on an Intel HD 620 laptop at 1366x768 and 30 FPS (engine plus its WebView2 processes): about 6–8% of total CPU for a preset while rendering, **0%** while paused, about 160 MB private memory. Editable scenes cost more: Night Forest (17 objects, about 100 particles, a clock) measured about 13% on 2026-10-28. An earlier 1.9% figure was taken seconds after startup and was most likely not a full-rate measurement. Scene rendering cost is on the Phase 8 optimisation list.

## Prerequisites

- Windows 10 1809+ (x64).
- **.NET 10 SDK.** A global install works. This workspace uses a local SDK in `..\.tools\dotnet`, which `build.ps1` picks up automatically:
  ```powershell
  Invoke-WebRequest https://dot.net/v1/dotnet-install.ps1 -OutFile dotnet-install.ps1
  .\dotnet-install.ps1 -Channel 10.0 -InstallDir ..\.tools\dotnet -NoPath
  ```
- **Node.js 20+** and npm (for the renderer).
- **Microsoft Edge WebView2 Runtime** (preinstalled on current Windows 10/11). The engine shows a download link if it's missing.
- Optional: Microsoft Edge, used at build time to render gallery thumbnails. Without it, cards fall back to gradients.

No Visual Studio is required. WinUI 3 is built unpackaged with the `dotnet` CLI.

## Building the installer

`.\build.ps1 -Installer` builds, tests, publishes and then compiles `installer\DreamCanvas.iss` with Inno Setup 6 into `artifacts\installer\DreamCanvasSetup-<version>.exe` (version from `Directory.Build.props`). Inno Setup is looked for in `..\.tools\innosetup` (where this workspace has a per-user install), then in the usual install folders. Compiling needs about 2 GB of free memory (the large compression dictionary that deduplicates the runtime). `installer\redist\MicrosoftEdgeWebview2Setup.exe` is Microsoft's WebView2 bootstrapper; it only runs on PCs without WebView2.

## Build, test, publish

```powershell
.\build.ps1                    # renderer build + thumbnails, all tests, publish to artifacts\DreamCanvas
.\build.ps1 -SkipTests         # faster
.\build.ps1 -SkipThumbnails    # reuse cached thumbnails (web/renderer/.thumbnails)
```

Published layout (this is what the Phase 8 installer will ship):

```
artifacts\DreamCanvas\
  app\DreamCanvas.exe                  the app (self-contained WinUI 3)
  engine\DreamCanvas.Engine.exe        wallpaper engine + tray
  engine\DreamCanvas.scr               Windows screensaver
  engine\DreamCanvas.Screensaver.exe   same player, used for idle display and export
  engine\dreamcanvas-cli.exe           diagnostics / scripting
  web\renderer\                        renderer bundle, presets.json, thumbnails
```

The three programs in `engine\` share one self-contained runtime.

Run `artifacts\DreamCanvas\app\DreamCanvas.exe`. The engine starts automatically the first time you set a wallpaper.

## Development workflow

```powershell
# Renderer: live-reload in a browser (e.g. http://localhost:5173/?preset=aurora)
cd web\renderer; npm run dev
npm test                         # Vitest
npm run build:fast               # bundle + presets.json (keeps cached thumbnails)

# Native
..\.tools\dotnet\dotnet.exe build DreamCanvas.slnx
..\.tools\dotnet\dotnet.exe test tests\DreamCanvas.Core.Tests
```

Dev builds find the renderer at `web\renderer\dist` by walking up from the executable. Override locations with `DREAMCANVAS_RENDERER`, `DREAMCANVAS_ENGINE`, `DREAMCANVAS_APP` and `DREAMCANVAS_DATA`.

The engine keeps its page loaded between wallpapers, so **restart the engine after rebuilding the renderer**: `dreamcanvas-cli shutdown`, or *Exit* in the tray menu.

### Editor in a browser

`npm run dev`, then open `http://localhost:5173/editor.html`. Outside the app, the editor keeps one draft in local storage and opens the Night Forest template by default. *Set as wallpaper* needs the app.

`node scripts/screenshot.mjs "index.html?scene=templates/night-forest.json" out.png` renders any page with headless Edge (`SHOW_CONSOLE=1` prints the page's console). The editor accepts `editor.html?select=<object id>&t=<seconds>` to open paused with an object selected at a given time.

`npm run e2e` (after a build) drives the built editor in headless Edge with real mouse and keyboard input: keyframes, scrubbing, key drag/ease/delete/undo, Record mode, adding movements, drawing a path, timeline settings, playback, and no console errors.

### Adding an object type

Add an `ObjectDef` in `web/renderer/src/scene/objects/` (draw in a local frame centred on 0,0; animate in `update`), and list it in `registry.ts`. The library, properties panel, scenes and wallpaper engine pick it up. A test checks every registered type's defaults.

### Adding a wallpaper preset

Create `web/renderer/src/presets/<id>/manifest.json` and `index.ts` (copy an existing preset), then rebuild the renderer. The gallery, editor controls, engine and storage pick it up with no native code changes. A registry test fails if the manifest is invalid.

For a shader preset, `createAutoShaderPreset(ctx, FRAGMENT)` is all `index.ts` needs: every param becomes a uniform named `u_<key>` (colours → `vec3`, numbers → `float`, booleans → 0/1), plus `u_res`, `u_time` and `u_seed` (0–8, changes with *Regenerate*), and the noise helpers `hash12`, `vnoise` and `fbm`. Keep noise coordinates small: large offsets lose float precision and show up as seams. Then run `npm run build:fast && npm run smoke -- out <id>` to check that it loads without errors and to get a screenshot. Headless Edge renders shaders in software and can be much slower than a real GPU (heavy shaders may even screenshot black), so check the final look and frame rate on the desktop with `dreamcanvas-cli apply <id>` and `status`.

### dreamcanvas-cli

```
dreamcanvas-cli status | pause | resume | stop | reload | shutdown
dreamcanvas-cli apply <presetId> [--monitor \\.\DISPLAY2] [--seed N] [--params "{\"arms\":4}"]
dreamcanvas-cli verify               # checks every wallpaper window is parented behind the icons and covers its monitor
dreamcanvas-cli snapshot out.png     # captures only DreamCanvas's own wallpaper window
dreamcanvas-cli snapshot-app out.png [process]   # captures a DreamCanvas window (app, or DreamCanvas.scr)
dreamcanvas-cli screensaver-status | screensaver-enable <scr> <seconds> | screensaver-disable [previous] | screensaver-start
dreamcanvas-cli idle-display on|off [minutes]
dreamcanvas-cli projects [create-from <scene.json>]   # list projects / create one from a scene file
dreamcanvas-cli apply-project <id> [--monitor \\.\DISPLAY2]
dreamcanvas-cli videos                                  # list the video library
dreamcanvas-cli videos import <file.mp4|webm> [--title T] | delete <id>
dreamcanvas-cli videos set-key <pexels|pixabay> <key>   # stored encrypted (DPAPI)
dreamcanvas-cli videos search <pexels|pixabay> <query>  /  videos download <pexels|pixabay> <query> [index]
dreamcanvas-cli apply-video <id> [--fit cover|contain] [--monitor \\.\DISPLAY2]
```

Player (screensaver) command line: `DreamCanvas.scr /s`, `/p <hwnd>`, `/c`, `--idle`, `--export <preset> <w> <h> <out.png> [--at s] [--seed n] [--params json]`.

Test hooks (never set these in normal use):
- `DREAMCANVAS_PLAYER_IGNORE_INPUT=1` keeps the player open on input, so it can be captured.
- `DREAMCANVAS_IDLE_TEST_SECONDS=N` shortens the idle-display threshold.
- `DREAMCANVAS_DEBUG_INPUT=1` (engine) logs the mouse/audio feed for scenes that use it every 2 s.

`tools\measure-engine.ps1` reports the engine's CPU and memory. `tools\ui-smoke.ps1` drives the app through UI Automation.

## Tests

- **Editor end-to-end (`npm run e2e`, 11 checks, part of `build.ps1`):** real input in headless Edge against the built editor.
- **Preset smoke test (`npm run smoke [outDir] [ids…]`):** loads every preset in headless Edge and fails on any error box (e.g. a shader that doesn't compile) or console error; optionally saves screenshots.
- **Renderer and editor (Vitest, 106 tests):**
  - preset registry: at least 20 presets, unique ids, at least 8 categories, every manifest valid and marked original; analog clock hand angles (12 o'clock, 3:30:15, sweep vs tick); shader uniform mapping and the small seed range;
  - easing, keyframe sampling, looping/held timelines, pose clamping, key add/replace/move/ease/remove, edits at the playhead and Record mode, key toggles keeping values;
  - scene format v2: migration from v1, repair of damaged behaviours/keyframes, JSON round trip, the animated template;
  - every behaviour finite and deterministic; walk wrap/turn/back-and-forth, jump height, swing pivot staying fixed, orbit, fall wrap, fades, stacking; paths (length, speed, loop/back/stop, turning, smoothing through points); mouse follow (smoothing, return home, no drift when paused), avoid, audio, `needs`;
  - parameter validation and randomisation;
  - the frame limiter at 15/24/30/60 FPS on 60 Hz and 144 Hz displays;
  - every preset manifest, launch and capture options, and clock formatting;
  - editor geometry: rotated hit-tests, resizing rotated objects from each handle, rotation snapping, bounds;
  - scene operations: groups, duplicate, paste, locked-object protection, layer order, alignment;
  - undo/redo merging and gestures;
  - scene validation and repair, refusal of newer formats, the Night Forest template, and moon phase geometry.
- **.NET (xUnit, 115 tests):** projects (create, save, scene format 1 and animated format 2, refusal of format 3, rename, duplicate, delete, unsafe ids, PNG-only thumbnails, in-place upgrade of a version-1 database, project assignments and URLs), plus preset catalog parsing and search, the SQLite store (including two stores sharing one file), migrations, the IPC protocol plus real named-pipe round trips and concurrent clients, URL building, playback policy, parameter rules, foreground-window classification (maximised vs fullscreen, multi-monitor, portrait), screensaver command-line parsing, wallpaper selection (desktop/specific/random, no repeats, favourites), and idle-display decisions.

## Windows integration test procedure

These checks were run on the development machine (Windows 10 22H2, one 1366x768 monitor):

1. **Behind icons:** apply a wallpaper, then run `dreamcanvas-cli verify`. Expect `PASS` (parent is `WorkerW` and the window covers the monitor). Icons must remain clickable, draggable and renameable.
2. **Rendering:** `dreamcanvas-cli status` shows `rendering: true` and `measuredFps` at the cap.
3. **Pause:** the tray *Pause* menu or `dreamcanvas-cli pause` stops rendering; `tools\measure-engine.ps1` should show about 0% CPU.
4. **Fullscreen and maximised:** with a window maximised or covering the screen, the status shows `pauseReason` as `maximized` or `fullscreen`. It resumes within about 1 s of returning to the desktop.
5. **Persistence:** run `dreamcanvas-cli shutdown`, then start `DreamCanvas.Engine.exe`. The same wallpaper returns.

6. **Explorer restart:** in Task Manager, choose *Windows Explorer → Restart*. Within about 2 s the wallpaper should be back behind the icons, and `verify` should show `PASS` with a new host handle. *(Verified here.)*
7. **Screensaver from Windows:** in the app, open *Screensaver* and turn on *Use DreamCanvas as my Windows screensaver*. `screensaver-status` should show the `.scr` path and `active=True`. Then run `screensaver-start`: DreamCanvas should cover every monitor, and the desktop wallpaper's status should show `pauseReason: screensaver`. Moving the mouse more than about 12 px or pressing a key closes it, and that key or click must not reach the app underneath. *(Verified here.)*
8. **Screensaver preview:** click *Windows screen saver settings*. The small monitor in the dialog should animate, and closing the dialog should leave no `DreamCanvas.scr` process. *(Verified here.)*
9. **Sign-in on resume:** in the Windows dialog, enable *On resume, display logon screen*, then let the screensaver start. Dismissing it must show the Windows sign-in screen; DreamCanvas never changes this setting.
10. **Idle display:** enable it for 1 minute and leave the PC alone. It should appear. Pressing Win+L or moving the mouse closes it, and Windows still locks or sleeps on its own schedule.
11. **Lock screen export:** in *Lock Screen Export*, choose *Export image*. A PNG at your screen size appears in `Pictures\DreamCanvas`. *Set as lock screen* either sets it or opens Lock screen settings.

12a. **Editor:**
   1. Open *Live Wallpaper Editor* and drag a Bird onto the canvas.
   2. Move, resize and rotate it, then press Ctrl+Z repeatedly; each gesture undoes in one step.
   3. Make a group with Ctrl+G and move it.
   4. The status shows *All changes saved*, and the card in *My Projects* updates its thumbnail.
   5. *Set as wallpaper* puts the scene on the desktop.

   *(Autosave and thumbnails were verified here with a real edit. The editor's own Set-as-wallpaper button couldn't be pressed through UI Automation, so it was tested only through the same engine call via `apply-project`.)*

12b. **Animation:**
   1. Select a Bird, click ◆ next to X, click 5 s on the timeline ruler, then drag the bird elsewhere. Press Space: it glides between the two positions.
   2. Add *Fly* from *+ Add movement…* and press *Set as wallpaper*. The bird crosses the desktop and reappears on the other side.
   3. Add *Mouse follow* to a fish and apply. On the desktop, the fish leans towards the cursor.
   4. Add *Sound reactive* to the moon and apply, then play music. The moon pulses with it.

   *(Steps 1–2 are covered by `npm run e2e` and a desktop snapshot. Steps 3–4 were verified here by moving the cursor to known points and playing a system sound.)*

These need hardware or actions that weren't available or appropriate here. Please run them:

12. **Sleep / resume:** put the PC to sleep for a few minutes, then wake it. The engine should still be running (tray icon present, `status` OK) and the wallpaper should resume. *(Once on the dev machine, the engine had stopped after a standby without logging why; this check is there to catch that.)*
13. **Multiple monitors:** connect a second display (try portrait and ultrawide). Each monitor should get its own window (`verify` lists one `PASS` per monitor). In the gallery's monitor picker, apply different wallpapers to each. Unplug a monitor: its window is removed and the others are unaffected.
14. **Resolution and DPI:** change resolution and scaling (100% to 150%). The wallpaper should refit within about 1 s with no gaps.
15. **Battery:** unplug the charger. With *Battery saver* on, `status` shows `fps: 15`; with *Pause on battery* on, `pauseReason: battery`. Plug back in and the previous rate resumes.
16. **Lock and display off:** press Win+L, then unlock. The engine log (`%LOCALAPPDATA%\DreamCanvas\logs\engine.log`) shows `Playback paused (locked)` and then `resumed`. Display sleep shows `display-off` *(display-off was observed here)*.
17. **Exclusive fullscreen game:** start a game in exclusive fullscreen. The status shows `pauseReason: fullscreen`.
18. **Start with Windows:** enable it in General Settings, then sign out and in. The wallpaper returns without opening the app.

## Known limitations

- **Disk size:** 297 MB installed. The app and the `engine\` folder each carry their own .NET runtime (about 80 MB of the same files, deduplicated in the download but not on disk). Sharing one runtime would mean shipping it as a separate prerequisite.
- **Unexplained engine stop:** it happened once around standby, before wake-up handling existed. If it happens again, the engine log (`%LOCALAPPDATA%\DreamCanvas\logs\engine.log`) now shows the sleep and wake events around it.
- **Unsigned installer:** the setup isn't code-signed (that needs a paid certificate), so Windows SmartScreen may show "Windows protected your PC" the first time. Click *More info* → *Run anyway*.
- **Windows screensaver vs. other apps:** Windows doesn't start any screensaver while another program asks to keep the display on (e.g. a browser playing video). DreamCanvas's *Idle Display* isn't affected by this.
- **Controlled folder access:** if Windows Security protects Pictures, lock-screen images are saved to `%LOCALAPPDATA%\DreamCanvas\exports` instead (the app says so).
- **Renderer updates:** the engine keeps its renderer page loaded, so a renderer rebuild needs an engine restart (an installer upgrade does this automatically).
- **Editor and desktop sync:** editing a project that's already on the desktop doesn't update the desktop until you press *Set as wallpaper* again.
- **Mouse input:** windows behind the desktop icons don't receive mouse input. Scenes get the cursor *position* from the engine (polled at 30 Hz only while a scene uses it), so following and avoiding work, but clicks on the wallpaper aren't detected. The cursor is followed even when another window is in front, until the wallpaper pauses for a maximised or fullscreen window.
- **Sound reactive** follows the overall output level of the default playback device, not individual frequencies (no bass/treble split).
- **Selection box and behaviours:** in the editor, the selection box marks the object's keyed position. Movement offsets (flying, orbiting…) are added on top, so a moving object can be away from its box while playing.
- **Mouse-follow feed, first run:** in the first engine session after a reboot, the fish once took the first cursor position and then stopped following. It couldn't be reproduced across five later runs, including the same project switch, and the cause is unknown.
- **Video sites:** only sites with an official API and a licence that allows free reuse are built in (Pexels, Pixabay). Pinterest isn't: its videos belong to the people who posted them, with no licence to reuse, and its terms forbid downloading. For other free sites (Mixkit, Coverr, …), download the file yourself and use *Import video file*.
- **Video previews:** imported WebM files (and files added with the CLI) have no preview image, because Windows has no built-in WebM thumbnailer. MP4 imports and downloads have one.
- **Videos aren't yet in** the screensaver's "specific wallpaper" list, the lock-screen export or the editor's backgrounds (the screensaver does play a video that's on the desktop).
- **No live lock screen:** the secure Windows lock screen can't host live content, so DreamCanvas offers Screensaver, Idle Display and still-image Lock Screen Export instead, as the specification requires.
