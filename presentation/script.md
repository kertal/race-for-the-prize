# RaceForThePrize — Presentation Speaker Script

> **Format:** 7 slides · ~7 minutes · Q&A optional
>
> **Audience:** Developers, engineering managers, DevOps/platform teams
>
> **Goal:** Convince the audience that RaceForThePrize is the most natural way to answer "which one is faster?" for web browser performance.

---

## Slide 1 — Title

*[Pause for the room to settle. Speak with energy from the start.]*

"Welcome to race day."

That's how the README opens, and I mean it literally. What I'm about to show you is a tool that turns browser performance testing into a race — two browsers, side by side, competing on a track you define. No statistics degree required. No dashboard to configure. Just: write two scripts, fire the starting gun, and the browser that finishes first wins.

The tool is called **RaceForThePrize**. It runs on Node.js, it's powered by Playwright, and you can be up and running in under a minute.

---

## Slide 2 — Numbers Tell You What. Racing Shows You Why.

Let me start with a question every front-end developer has asked at some point: *"Is the new version actually faster?"*

You've shipped a refactor. You've swapped frameworks. You've added lazy loading. Lighthouse gives you a score — but it's a snapshot, not a comparison. A CI metric moved by 8% — but what does that look like to a user?

*[Point to the table.]*

Traditional benchmarking tools and RaceForThePrize are **complementary**. Lighthouse tells you the LCP improved from 3.2s to 2.1s. RaceForThePrize shows you both pages loading side by side so you can *see* what that difference feels like. When a metric moves, race it to understand why.

---

## Slide 3 — How It Works

At its core, RaceForThePrize is a CLI tool that takes two Playwright `.spec.js` files — your "racers" — and runs them against each other.

Each racer gets its own Chromium browser. Both execute the same user journey: clicking, scrolling, navigating. You mark the start and end of each measurement with a simple API call, and the tool does the rest: records the session, captures timings, and generates a full race report.

*[Point to the code.]*

```bash
npm install && npx playwright install chromium
node race.js ./races/lauda-vs-hunt
```

Two browsers launch, the race runs, and the winner is declared. Any existing Playwright test can become a racer in minutes.

---

## Slide 4 — The Race API

*[Point to the code on screen.]*

This is all you need to instrument a race. Four calls wrapped around your existing Playwright interactions:

- `raceRecordingStart()` — begin recording video
- `raceStart('name')` — start the stopwatch for a named measurement
- `raceEnd('name')` — stop the stopwatch
- `raceRecordingEnd()` — finish the recording

Everything in between is normal Playwright code. If you already have end-to-end tests, you're most of the way there.

*[Emphasise:]* Any existing Playwright test can become a racer in minutes.

---

## Slide 5 — Live Race — Lauda vs Hunt

Now for the main event.

*[Display the GIF and let it run.]*

This is the Lauda vs Hunt race. Niki Lauda on the left, James Hunt on the right. Both scrolling to the bottom of their Wikipedia pages with human-like mouse wheel events.

You can see the terminal animation: elapsed time, live status from each racer. At the end, one crosses the finish line first. Winner declared. No arguments.

This is a deliberately simple race — but replace the Wikipedia scrolling with your app's critical user journey and you've got a real benchmark.

---

## Slide 6 — What You Get

After every race, a timestamped results folder is created.

*[Walk through the table.]*

`index.html` is an interactive HTML player — open it in a browser and get the race video with a timeline, calibrated timestamps, and trace analysis.

`README.md` is a human-readable report: medal table, timings, percentage differences, machine info. Drop it straight into a PR description.

`summary.json` is the machine-readable version. Every CI pipeline can read this — check the winner, fail the job if performance regressed.

The recordings are frame-accurate: colored pixel cues are injected at `raceRecordingStart/End`, detected via Canvas API, so the video shows *exactly* what was measured.

---

## Slide 7 — Get Started

*[End with energy.]*

Three steps:

1. Clone the repo and install
2. Run `node race.js ./races/lauda-vs-hunt`
3. Explore the built-ins: `lauda-vs-hunt`, `lebron-vs-curry`, `react-vs-angular`

You'll have your first race running in under a minute. I'm happy to take questions — on the tool, the architecture, or use cases.

*[If time permits, offer to live-demo `node race.js ./races/lauda-vs-hunt`.]*

---

## Presentation Tips

**Timing:** ~7 minutes at a comfortable pace. Each slide is roughly 60 seconds. Allow 3–5 minutes buffer for questions or a live demo.

**Demo opportunity:** After Slide 5, offer to run a live race if the environment allows it. `node race.js ./races/lauda-vs-hunt --headless` takes about 20–30 seconds and makes a strong impression.

**Audience adaptation:**
- *For developers:* Spend more time on Slides 4 and 6 (API, what you get).
- *For managers/leads:* Emphasise Slides 2 and 6 (positioning, outputs).
- *For DevOps/platform:* Focus on Slide 6 (CI-ready JSON, reproducible results).

**Key phrases to land:**
- "Any existing Playwright test can become a racer in minutes."
- "The video shows exactly what was measured."
- "Performance is now a pass/fail criterion, just like your unit tests."
- "May the fastest browser win."
