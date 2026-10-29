# DreamCanvas architecture

DreamCanvas is a live-wallpaper platform for Windows 10/11 made of two native processes that share one web renderer.

```
┌──────────────────────────────┐   named pipe (JSON lines,    ┌──────────────────────────────────┐
│ DreamCanvas.exe  (WinUI 3)   │   current-user only)         │ DreamCanvas.Engine.exe (WinForms)│
│  Home · Gallery · Desktop ·  │ ───────────────────────────► │  tray icon · IPC server          │
│  Performance · Settings      │   apply/pause/resume/stop/   │  WallpaperManager                │
│  WallpaperPreview (WebView2) │   status/reloadSettings      │   └ WallpaperWindow per monitor  │
└──────────────┬───────────────┘                              │      (WebView2, parented to       │
               │                                              │       the desktop WorkerW)       │
               │        ┌─────────────────────────┐           └───────────────┬──────────────────┘
               └──────► │ SQLite (WAL)            │ ◄─────────────────────────┘
                        │ %LOCALAPPDATA%\DreamCanvas│
                        └─────────────────────────┘
        both load ──►  web/renderer  (Vite + TypeScript: runtime + presets, served via
                       WebView2 virtual host https://renderer.dreamcanvas.local/)
```

## Why two processes

- The **engine** must outlive the UI ("continue running when the main window closes"), start at sign-in without opening a window, and own the tray menu. It's a small WinForms host because WinForms gives a reliable message loop, `NotifyIcon` and plain HWNDs that can be re-parented into Explorer's desktop window.
- The **app** is WinUI 3 (the spec's UI framework). Closing it never affects the desktop wallpaper.
- They communicate over a named pipe (`DreamCanvas.Engine.v1.<user>.<session>`, `PipeOptions.CurrentUserOnly`) and share state through SQLite in WAL mode. The engine is the only writer of *monitor assignments*; the app is the only writer of *settings*, and tells the engine to `reloadSettings`.

## Modules

| Project | Target | Responsibility |
|---|---|---|
| `src/DreamCanvas.Core` | `net10.0` | Preset catalog + parameter rules, `WallpaperSpec`, `PlaybackPolicy` (pure pause/FPS decisions), SQLite store + migrations, IPC protocol/client/server, paths, logging. No UI or Win32 — fully unit-tested. |
| `src/DreamCanvas.Native` | `net10.0-windows` | Win32 interop: desktop WorkerW discovery and re-parenting, monitor enumeration, foreground/fullscreen classification, battery and display-power state, HKCU Run startup registration, static wallpaper refresh. |
| `src/DreamCanvas.Hosting` | `net10.0-windows` WinForms | `RendererView`: WebView2 + renderer message protocol (show, params, pause, FPS, stats, errors, still capture). Shared by the engine and the player. |
| `src/DreamCanvas.Engine` | `net10.0-windows` WinForms | Wallpaper host process (see below) + Idle Display trigger. |
| `src/DreamCanvas.Screensaver` | `net10.0-windows` WinForms | The player, shipped as `DreamCanvas.scr` (Windows screensaver: `/s`, `/p <hwnd>`, `/c`) and `DreamCanvas.Screensaver.exe` (`--idle`, `--export`). |
| `src/DreamCanvas.App` | `net10.0-windows10.0.19041` WinUI 3, unpackaged | User interface. |
| `web/renderer` | TypeScript, Vite | Wallpaper runtime and presets; runs inside WebView2 in both processes. |
| `tools/DreamCanvas.Cli` | `net10.0-windows` | `dreamcanvas-cli`: scriptable engine control and Windows-integration verification. |
| `tests/DreamCanvas.Core.Tests` | xUnit | Core + pure Native logic. |

## Desktop integration (engine)

1. `DesktopHost.GetWallpaperHost()` sends message `0x052C` to `Progman`, which makes Explorer create a `WorkerW` window between the wallpaper and the desktop icon list (`SHELLDLL_DefView`). On Windows 10 it is the top-level `WorkerW` following the one that hosts `SHELLDLL_DefView`; on Windows 11 24H2+ it is a child of `Progman`. Both layouts are handled.
2. One borderless `WallpaperWindow` per monitor is created, given `WS_CHILD`, `SetParent`-ed into that `WorkerW`, and positioned with `MapWindowPoints` so it exactly covers the monitor in physical pixels (the process is Per-Monitor-V2 DPI aware). Desktop icons stay on top and fully interactive.
3. Each window hosts WebView2 pointed at `https://renderer.dreamcanvas.local/index.html?preset=…&params=…&fps=…&seed=…`, with the virtual host mapped to the local renderer folder (no web server, works offline).
4. A 1-second policy tick evaluates `PlaybackPolicy` per monitor from: user pause, display off (`GUID_CONSOLE_DISPLAY_STATE`), session lock (`SessionSwitch`), battery (`GetSystemPowerStatus`), exclusive fullscreen (`SHQueryUserNotificationState`), and how the foreground window covers the monitor (`SystemState.Classify`). Pausing stops the renderer's `requestAnimationFrame` loop entirely (measured: 0% CPU while paused).
5. Recovery: the `TaskbarCreated` broadcast (Explorer restart), `DisplaySettingsChanged` (debounced) and the policy tick (which also re-checks that windows are still attached and the monitor layout is unchanged) all trigger a rebuild from the stored assignments.
6. Stopping destroys the windows and re-applies the user's current static wallpaper so no stale frame remains.
7. An Explorer restart destroys the old `WorkerW` *and our child windows with it*. The manager detects the dead window handles, disposes them quietly and creates fresh windows under the new host (triggered by `TaskbarCreated` and by the policy tick). Verified: recovery within about 1 s of Explorer returning.

## Renderer contract

A preset is a folder `web/renderer/src/presets/<id>/` containing:

- `manifest.json` — id, name, description, category, tags, renderer kind (`canvas2d | webgl | pixi | three`), accent colours, author, licence, and a typed parameter list (`range`, `color`, `bool`, `select`).
- `index.ts` — `create(ctx) → { update(dt, time), resize(w, h, dpr), setParams(p), dispose() }`.

The registry discovers presets with `import.meta.glob`; the build emits all manifests to `dist/presets.json`, which the native side reads. **Adding a preset requires no change to the engine or app.** Parameter validation is implemented identically in `params.ts` and `ParamValues.cs` (both tested).

The runtime owns the loop (`FrameLimiter` caps at 15/24/30/60 FPS on any refresh rate), pausing (host command or page hidden), global speed, seeded randomness (`Regenerate` = new seed), and error reporting back to the host. Messages are JSON via `chrome.webview.postMessage`.

## Storage (SQLite, schema v1)

`settings(key, value)` · `favorites(preset_id)` · `preset_customizations(preset_id, params_json, seed)` · `monitor_assignments(monitor_key, preset_id, params_json, seed)` (`*` = all monitors) · `apply_history(id, preset_id, applied_utc)` · `schema_version`.

Migrations are forward-only and append-only (`Storage/Migrations.cs`); a database newer than the build is refused rather than corrupted.

## Screensaver, idle display and export (Phase 2)

- **Screensaver Mode.** Windows runs `DreamCanvas.scr /s` after its own idle timeout. The player opens one top-most window per monitor with a `RendererView` and exits on input, detected with low-level keyboard/mouse hooks because WebView2 owns its windows' input. Mouse movement under 12 px is ignored, and the waking key or click is swallowed. Any "sign in on resume" requirement is enforced by Windows after the screensaver exits; DreamCanvas never reads around or changes it. `/p <hwnd>` makes the player a child of the Screen Saver Settings dialog's preview control, exiting when that control is destroyed. `/c` opens the app on its Screensaver page. Registration writes `HKCU\Control Panel\Desktop\SCRNSAVE.EXE` plus `SPI_SETSCREENSAVETIMEOUT` / `SPI_SETSCREENSAVEACTIVE`, refuses to act when the policy key manages these values, and remembers the previous screensaver so it can be restored.
- **Idle Display Mode.** The engine's `IdleDisplayController` samples `GetLastInputInfo` every 2 s and asks `IdleDecision` (pure, tested) whether to launch `DreamCanvas.Screensaver.exe --idle`. It does not launch while locked, with the display off, during shell "busy" states (presentations, D3D fullscreen) or when a screensaver is already running. It won't relaunch until there has been input again. It changes no system setting, so Windows' own lock and sleep timers are unaffected, and the player exits when the session locks.
- **Lock Screen Export.** The renderer has a capture mode (`?capture=1&width&height&at`): it builds the preset at exactly that size with `dpr = 1` and full shader quality, simulates `at` seconds in fixed 1/30 s steps, and returns `canvas.toDataURL()` in the same task (no `preserveDrawingBuffer` needed). `DreamCanvas.Screensaver.exe --export` writes the PNG; the app then calls `LockScreen.SetImageFileAsync`, falling back to opening `ms-settings:lockscreen`.
- While a DreamCanvas player holds the `Local\DreamCanvas.Player.Fullscreen` mutex, or Windows reports a screensaver running, the desktop wallpaper pauses (`pauseReason: screensaver`).
- `WallpaperSelector` decides what the player shows: the monitor's desktop wallpaper, a specific preset with its saved customisation, or random presets (all or favourites) rotating every N minutes without immediate repeats.

## Scenes and the editor (Phase 3)

```
web/renderer/
  index.html          wallpaper page: ?preset=… or ?project=<id> / ?scene=<file>
  editor.html         scene editor (React)
  src/scene/          shared by both pages
    types.ts          Scene / SceneObject / SceneBackground (SCENE_VERSION)
    validate.ts       parseScene: migrate, sanitise, repair; refuses newer formats
    runtime.ts        createSceneRuntime: Pixi stage + optional preset background layer
    objects/          ObjectDef registry: 15 procedural object types
  src/editor/         geometry, operations, history (pure, tested) + React components
  public/templates/   bundled scenes (night-forest.json)
```

- **Format.** A scene has a design size (default 1920×1080), a background (colour, gradient, or any preset with its parameters and seed), and an ordered list of objects. Each object has a centre/size transform, rotation, flip, opacity, brightness, speed, lock/hidden flags, an optional `groupId`, a seed and type-specific `props`. `parseScene` is the only way in: it migrates older versions, clamps values, drops junk, de-duplicates ids, and keeps unknown object types (rendered as placeholders) so newer content isn't lost.
- **Runtime.** Objects draw in a local frame centred on (0,0) and are positioned by a holder container (translate, rotate, flip, alpha, ColorMatrix brightness). A view is rebuilt only when its size, settings or seed change, so dragging only updates transforms. The world is scaled to *cover* the monitor (wallpaper) or *contain* it (editor) and clipped to the design area. Preset backgrounds run in their own canvas underneath the transparent Pixi canvas, and the two are composited for thumbnails and exports. The wallpaper page loads the scene runtime lazily, so plain presets don't pay for it.
- **Editor state.** The `History<Scene>` holds immutable scenes. Discrete edits `commit` (with a merge key so slider sweeps become one step); pointer gestures use `begin/preview/end`. Selection is separate state and is pruned after undo. All transforms use rotated-frame geometry (`toLocal`/`toWorld`); resizing keeps the opposite edge fixed.
- **Persistence.** Projects live in `%LOCALAPPDATA%\DreamCanvas\projects\<id>\` (`scene.json` and `thumbnail.png`, written atomically) and in a `projects` table (schema v2). WebView2 maps that folder to `https://projects.dreamcanvas.local/` for reading. Writes go only through the app: the editor posts `save`/`apply` messages, and the app accepts them only from the editor origin and for the open project, checking the scene envelope and the PNG signature. Monitor assignments store a `project_id`. Deleting a project removes its assignments and refreshes the desktop.

## How later phases plug in

| Phase | Plan |
|---|---|
| 2 – Screensaver & idle display | **Done** (see above). |
| 3 – Scene editor | **Done** (see above). |
| 4 – Timeline & behaviours | **Done** (see "Animation" above). Deviations from the plan: keyframes are sampled directly instead of with GSAP; particle emission is left to the particle object. |
| 5 – 20+ presets | **Done**: 22 presets, no engine or app changes (folders are discovered by `import.meta.glob`; categories come from manifests). Most new presets are fragment shaders built with `createAutoShaderPreset`, which maps params to uniforms by name. Their per-frame cost is on the GPU, and the CPU only issues one draw call. The rest are Canvas 2D, with static parts (sky, branch, clock dial) drawn once into an offscreen canvas and stamped each frame. Vitest's on-disk module cache is disabled because it kept stale `import.meta.glob` results. |
| 6 – Asset importer | **Video wallpapers in place.** Schema v3 adds a `videos` table and a `video_id` column on `monitor_assignments`. Each row stores the source, source id, author, page, licence name and URL, file name, size, dimensions, duration and SHA-256. Files live in `media\<id>\video.(mp4|webm)` + `thumbnail.jpg` and are served to WebView2 as `https://media.dreamcanvas.local/`. A video wallpaper is `WallpaperSpec { PresetId = "video", VideoId, Params { file, fit } }`, and the renderer plays it in a `<video>` element (no render loop; pausing pauses decoding). Sources implement `IVideoSource`; only Pexels and Pixabay are included, because they have official APIs and licences that allow reuse. Their JSON parsing is pure and tested. `VideoDownloader` picks the smallest rendition at least as wide as the screen (max 4K), streams it to a temp file with a 2 GB cap and progress, checks the MP4/WebM signature, then hands it to `VideoLibrary`, which de-duplicates by hash. API keys are encrypted with DPAPI (`SourceKeys`). Planned later: images and Lottie as scene objects, using the same licence fields. |
| 7 – Clock & widget studio | **Done.** Widgets are ordinary `ObjectDef`s (`scene/objects/widgets.ts`) with their logic in pure, tested functions (`widget-logic.ts`: word clock grid and phrases, calendar layout, countdown parsing and formatting, gauge easing). An object can declare `needs: 'system'`. The runtime adds that to the `needs` it reports. The engine then reads CPU (`GetSystemTimes` deltas), memory (`GlobalMemoryStatusEx`) and battery (`GetSystemPowerStatus`) once a second (`Native/SystemMetrics`) and posts `{type:'system', …}`. Objects read it from a shared `LiveData` in their context, and show sample values while it's null (editor, previews). Text is rasterised once and tinted or scaled; the system monitor redraws only when a gauge moves. |
| 8 – Installer | **Done.** `installer\DreamCanvas.iss` (Inno Setup 6) packages `artifacts\DreamCanvas` per-user (`PrivilegesRequired=lowest`, `{autopf}` = `%LOCALAPPDATA%\Programs`). Two CLI verbs keep Windows consistent: `install-fixups` (after install) moves a DreamCanvas screensaver or startup entry from another copy to this one; `uninstall-cleanup` (before files are removed) stops the wallpaper, restores the previous screensaver, removes the Run value and waits for the engine to exit. `ScreensaverRegistration.IsDreamCanvasScreensaver` recognises both long and 8.3 paths. Single instance uses Windows App SDK `AppInstance.FindOrRegisterForKey` + `RedirectActivationToAsync`, with `AllowSetForegroundWindow` so the existing window may come forward. The app references only `Microsoft.WindowsAppSDK.WinUI` + `.Foundation`. The engine refreshes its wallpaper windows on `PowerModes.Resume`. |
