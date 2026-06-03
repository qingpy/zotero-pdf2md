# Dev notes

Hard-won facts about Zotero plugin development, current as of Zotero 9.0.4.

## Install failures are masked

Any manifest/packaging problem surfaces only as a dialog saying the plugin
*"may be incompatible with this version of Zotero"*, and programmatically as
`CORRUPT_FILE (-3)`. To see the real error, parse the XPI through
`AddonManager.getInstallForFile()` in Tools → Developer → Run JavaScript while
capturing the `addons.xpi` logger.

## Zotero 9 manifest requirements

- `applications.zotero.update_url` is **required** (it was optional in
  Zotero 7/8 and the docs still say optional). Missing it →
  `Reading manifest: applications.zotero.update_url not provided` → install fails.
- `browser_specific_settings.zotero` is **not** recognized — use `applications.zotero`.
- `strict_min_version` / `strict_max_version` are strictly enforced on release
  builds (`strictCompatibility = true`).

## Packing

PowerShell's `Compress-Archive` produces zip files that Zotero's zip reader
(libjar) rejects. `build-xpi.mjs` writes a plain textbook zip instead.

## Misc

- Inline `oncommand=` handlers in preference-pane XHTML are blocked by CSP —
  attach listeners from a pane script instead.
- `Zotero.ProgressWindow` is a separate OS window: it gets a taskbar entry and
  can render clipped. An in-window `position:fixed` HTML overlay avoids both.
- `nsIFilePicker.init()` takes a `BrowsingContext` on Firefox 120+ (Zotero 8/9)
  and a window before that — branch on `Zotero.platformMajorVersion`.
