# Releasing the desktop app

The desktop app (Mac `.dmg` / Windows `.exe`) is built by GitHub Actions and
distributed through GitHub Releases. Once installed, the app checks that same
release feed and updates itself automatically.

## How a release works

1. Bump `version` in `package.json` (e.g. `0.1.0` → `0.1.1`). Auto-update
   compares versions, so this must increase for existing installs to update.
2. Commit, then tag and push:
   ```
   git tag v0.1.1
   git push origin v0.1.1
   ```
3. The **Release desktop app** workflow (`.github/workflows/release.yml`) runs on
   macOS and Windows runners, builds the installers, and uploads them to a
   **draft** GitHub Release named after the tag.
4. Open the release on GitHub and click **Publish**. Publishing is what makes it
   visible to already-installed apps — they’ll download it and prompt to restart.

Installers land under **Releases** on the repo: `Personal CRM-<version>-universal.dmg`
(Mac) and `Personal CRM Setup <version>.exe` (Windows).

## Two things to know

### The repo should be public for auto-update
The app reads new versions straight from the GitHub Releases API. For a **private**
repo that API needs a token, which would mean embedding one in the app — don’t.
Make this repo **public** (the code holds only the Supabase *publishable* key,
which is designed to be public and is protected by row-level security), or accept
that users update by manually downloading each new `.dmg`/`.exe`.

### macOS signing (needed for silent Mac auto-update)
- **Windows** auto-update works right now, unsigned. (SmartScreen may warn on the
  very first download; updates thereafter are silent.)
- **macOS** only applies updates automatically if the app is **code-signed and
  notarized**. Without it, the app still installs and runs — the user right-clicks
  → *Open* the first time — but it won’t auto-update; they’d download new `.dmg`s.
- To enable signed Mac builds: get an Apple Developer account ($99/yr), export your
  *Developer ID Application* certificate as a `.p12`, and add repo secrets
  `CSC_LINK` (base64 of the `.p12`) and `CSC_KEY_PASSWORD`. Then delete the
  `CSC_IDENTITY_AUTO_DISCOVERY: false` line in the workflow. For notarization add
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` secrets.

## Building locally (optional)

You can only build the installer for the OS you're on:

```
npm install
npm run electron:pack    # unpacked app in release/ — quickest smoke test
npm run electron:dist    # full installer in release/ (no publishing)
```

For live development without packaging:

```
npm run electron:dev     # Vite dev server + Electron window, hot reload
```
