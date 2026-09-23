# Working on RaceForThePrize

Hacking on the tool itself? Everything below assumes a clone of the repository.
Install instructions for the published CLI live in the
[Installation Guide](../INSTALLATION.md).

## Working From a Clone

Hacking on the tool itself, or want the example races without the copy step? Clone the repository and run the entry point directly — `node race.js` takes exactly the same arguments and flags as the installed `race-for-the-prize` command:

```bash
git clone https://github.com/kertal/race-for-the-prize.git
cd race-for-the-prize
npm install                          # also downloads Chromium
node race.js ./races/lauda-vs-hunt   # the example races live in races/
```

`npm link` turns the clone into your global `race-for-the-prize` command, so you can try your changes from any directory.

## Project Structure

```text
RaceForThePrize/
├── race.js                 # 🏁 Main entry point — the race director (the `race-for-the-prize` bin)
├── runner.cjs              # Playwright automation engine
├── sync-barrier.cjs        # Parallel mode checkpoint synchronization
├── visual-stability.cjs    # Wait-for-visual-stability detection logic
├── trace-calibration.cjs   # Derive timing from Chrome performance traces
├── cli/
│   ├── animation.js        # Live terminal racing animation
│   ├── colors.js           # ANSI color palette
│   ├── config.js           # Argument parsing & racer discovery
│   ├── demos.js            # The demo:<name> command — bundled races copied on request
│   ├── profile-analysis.js # CDP performance metrics collection & analysis
│   ├── html-templates.js   # Shared markup plumbing (escaping, {{slots}}, <template> loading)
│   ├── player.html         # HTML player markup + build-time templates
│   ├── tokens.css          # Design tokens shared by every generated report
│   ├── player.css          # HTML player component styles
│   ├── player-runtime/     # HTML player client-side runtime (playback, calibration, export)
│   ├── player-sections.js  # HTML player template sections
│   ├── race-utils.js       # Shared race utility helpers
│   ├── results.js          # File management & video conversion
│   ├── condition-matrix.js # Cross-condition performance matrix (terminal + HTML)
│   ├── condition-matrix.html # Condition matrix markup + build-time templates
│   ├── condition-matrix.css  # Condition matrix component styles
│   ├── skins.js            # Skin resolution for --skin
│   ├── skins/              # Built-in player skins (light, neon)
│   ├── summary.js          # Results formatting & markdown reports
│   ├── sidebyside.js       # FFmpeg video composition (--ffmpeg)
│   └── videoplayer.js      # Interactive HTML player with clip-based trimming
├── races/                  # Demo races — shipped in the npm package, run via demo:<name>
│   ├── lauda-vs-hunt/        # 🏁 The greatest rivalry in racing
│   ├── lebron-vs-curry/      # 🏀 The GOAT debate, dribble-style
│   ├── react-vs-angular/     # ⚛️  Frontend framework showdown (4 racers)
│   └── caching-comparison/   # 🤫 Encrypted vs plain vs no cache (3 racers, 6 conditions)
├── scripts/
│   └── postinstall.cjs     # Downloads Chromium when the package installs
├── docs/                   # The handbook — and the GitHub Pages site
│   ├── index.html          # 🏁 Landing page (GitHub Pages serves this folder)
│   ├── site.css            # Landing page styles — same flag, same palette
│   ├── demos.md            # The bundled demo races
│   ├── writing-races.md    # Race modes, the race API, setup/teardown
│   ├── use-cases.md        # What people actually race
│   ├── cli.md              # Flags & settings.json reference
│   ├── results.md          # Results folder, HTML player, podium
│   ├── development.md      # This file
│   └── skinning.md         # Design tokens & how to write a player skin
├── presentation/
│   ├── slides.md           # Marp slide deck
│   ├── slides.html         # The deck rendered by Marp — open it in a browser
│   └── script.md           # Speaker notes (~12 min, with a 7 min cut)
├── tests/                  # Unit tests (vitest)
├── integration/            # Integration tests (vitest)
└── package.json            # bin: race-for-the-prize → race.js
```

The tree above shows the landmarks. `runner.cjs` has a handful of satellite
modules beside it (`runner-metrics.cjs`, `runner-video.cjs`,
`runner-throttling.cjs`, `runner-layout.cjs`, `runner-protocol.cjs`,
`race-api.cjs`, `overlay.cjs`), and `cli/` holds a few more single-purpose
modules than are listed here. `CLAUDE.md` in the repository root carries the
full module-by-module map.

## Presenting RaceForThePrize

The `presentation/` folder contains a ready-to-use slide deck and speaker script for introducing the tool to an audience.

- **`slides.md`** — 9-slide [Marp](https://marp.app/) deck covering positioning, the race API, live demo, results, and how to get started with `npx race-for-the-prize`
- **`slides.html`** — the rendered deck, ready to open in a browser or present with `marp -p`
- **`script.md`** — Speaker notes with timing guidance, audience adaptation tips, and key phrases to land

After editing `slides.md`, regenerate the HTML with Marp:

```bash
npx @marp-team/marp-cli presentation/slides.md --html -o presentation/slides.html
```

The deck's live-demo moment is `npx race-for-the-prize demo:lauda-vs-hunt` — it works from any empty directory, so the audience can follow along on their own machines.

## Running Tests

```bash
npm test                                          # Unit tests (vitest)
npm run test:integration                          # Integration tests (calibration, trimming)
npx vitest run tests/summary.test.js              # Run a single test file
```

Integration tests skip themselves when what they need is missing (Chromium,
ffmpeg/ffprobe). One of them, `integration/npx-no-playwright.test.js`, checks
the published experience rather than a race: it runs `npm pack`, unpacks the
tarball the way npm would install it, and drives the result through `npx
--no-install` with no Playwright in reach. That catches a file missing from the
`files` allowlist, broken `bin` wiring, or a top-level `import 'playwright'`
sneaking into `race.js` — all of which only hurt people installing from npm.


## Contributing

Small, focused changes are the easiest to review: one thing per commit, tests
alongside the change, and `npm test` green before you open a pull request.
`CLAUDE.md` in the repository root carries the longer version — project
overview, architecture notes, and the house style.

---

Next: [skin the player](skinning.md) · [race flags](cli.md)
