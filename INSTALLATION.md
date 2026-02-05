# Installation Guide

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

## 2. Clone and install the project

```bash
git clone https://github.com/kertal/race-for-the-prize.git
cd race-for-the-prize

# Install project dependencies
npm install

# Install the Chromium browser engine used by Playwright
npx playwright install chromium
```

If `npx playwright install chromium` asks you to install system dependencies (common on Linux), run the command it suggests — typically:
```bash
npx playwright install-deps chromium
```

## 3. Install FFmpeg (optional)

FFmpeg is only needed if you want the `--format=gif`, `--format=mov`, or side-by-side video features. Everything else works without it.

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

## Prerequisites Summary

| Requirement | Version | Required? |
|---|---|---|
| **Node.js** | 18+ | Yes |
| **FFmpeg** | any recent | Optional — needed for side-by-side video replays and GIF export |
