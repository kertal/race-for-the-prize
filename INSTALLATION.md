# Installation Guide

RaceForThePrize is published on npm as [`race-for-the-prize`](https://www.npmjs.com/package/race-for-the-prize). The only hard requirement is Node.js; the package downloads the Chromium build it races with.

In a hurry? This runs the first race without installing anything permanently:

```bash
npx race-for-the-prize demo:lauda-vs-hunt
```

## 1. Install Node.js (if you don't have it)

You need **Node.js 18 or newer**. Check if it's already installed:

```bash
node --version
```

If the command isn't found or shows a version below 18, install Node.js for your system:

**macOS** — using [Homebrew](https://brew.sh/):
```bash
brew install node
```

**Ubuntu / Debian**:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

**Windows** — download the installer from [nodejs.org](https://nodejs.org/) (pick the LTS version), or use a package manager:
```bash
# Chocolatey
choco install nodejs-lts

# winget
winget install OpenJS.NodeJS.LTS
```

## 2. Install RaceForThePrize

Install it globally to get a `race-for-the-prize` command you can run from any directory:

```bash
npm install -g race-for-the-prize
race-for-the-prize demo            # list the bundled demo races
race-for-the-prize demo:lauda-vs-hunt
```

Prefer not to install globally? `npx` fetches the package on demand and runs it — every command in the docs works the same way with `npx` in front:

```bash
npx race-for-the-prize --init my-race
npx race-for-the-prize my-race
```

To pin it to a project instead (handy for CI, where `npx` would re-resolve the package on every run), add it as a dev dependency and call it through an npm script:

```bash
npm install --save-dev race-for-the-prize
npx race-for-the-prize ./races/my-race --headless --serve=false --yes
```

### The Chromium download

`npm install` runs a `postinstall` step that downloads the Chromium build Playwright needs (about 150 MB). If it asks you to install system dependencies (common on Linux), run the command it suggests — typically:
```bash
npx playwright install-deps chromium
```

In CI images, dev containers, or any environment where the browser is already provisioned, skip the download by setting either variable before installing:
```bash
RFTP_SKIP_BROWSER_INSTALL=1 npm install -g race-for-the-prize        # project-specific opt-out
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install -g race-for-the-prize  # Playwright's standard opt-out
```
The download is also non-fatal: if it fails (e.g. offline), the install still succeeds and you can fetch the browser later with:
```bash
npx playwright install chromium
```

Newer package managers gate install scripts behind an approval step, so you may see a warning like this and be asked whether to allow it:

```text
npm warn allow-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn allow-scripts   race-for-the-prize@0.10.0 (postinstall: node scripts/postinstall.cjs)
```

Approving it (`npm approve-scripts race-for-the-prize`) lets the download run as described above. Declining is fine too — nothing else depends on the hook, and the CLI checks for the browser before it starts a race and tells you to run `npx playwright install chromium` if it is missing.

### Upgrading

```bash
npm install -g race-for-the-prize@latest
race-for-the-prize --version
```

`npx race-for-the-prize` always resolves the latest published version unless you pin one (`npx race-for-the-prize@0.10.0 …`).

## 3. Install FFmpeg (optional)

FFmpeg is **not required** for normal use. The HTML player handles video trimming and calibration entirely in the browser. FFmpeg is only needed if you want `--ffmpeg` for physical video trimming, `--format=gif` / `--format=mov` conversion, or server-side side-by-side merging.

**macOS** (Homebrew):
```bash
brew install ffmpeg
```

**Ubuntu / Debian**:
```bash
sudo apt update && sudo apt install ffmpeg
```

**Windows** — pick one:
```bash
# Chocolatey
choco install ffmpeg

# winget
winget install FFmpeg.FFmpeg

# Or download manually from https://ffmpeg.org/download.html
# and add the bin/ folder to your PATH
```

Verify it's working:
```bash
ffmpeg -version
```

## 4. Running from a clone (contributors)

Working on the tool itself? Clone the repository and run the entry point directly. `node race.js` accepts exactly the same arguments and flags as the installed `race-for-the-prize` command, and the example races are already in `races/`:

```bash
git clone https://github.com/kertal/race-for-the-prize.git
cd race-for-the-prize

npm install                          # dependencies + the Chromium download above
node race.js ./races/lauda-vs-hunt   # run an example race
npm test                             # unit tests
```

The Chromium notes from step 2 apply here too (`npx playwright install chromium` fetches it by hand, the skip variables skip it). `npm link` turns your clone into the global `race-for-the-prize` command so you can try changes from any directory.

## Prerequisites Summary

| Requirement | Version | Required? |
|---|---|---|
| **Node.js** | 18+ | Yes |
| **Chromium** | Playwright's build | Yes — downloaded automatically on install |
| **FFmpeg** | any recent | Optional — only for `--ffmpeg` physical trimming, format conversion, and server-side merging |
