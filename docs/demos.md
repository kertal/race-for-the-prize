# Demo Races

Four races ship inside the npm package, so you can watch a real one before you
write your own. No setup, no clone, no scripts to read first:

```bash
race-for-the-prize demo                   # list them
race-for-the-prize demo:lauda-vs-hunt     # run one
```

Every command below works the same through `npx race-for-the-prize …` if you
would rather not install globally.

## 🏁 Race Day: Lauda vs Hunt

The classic rivalry. Niki Lauda — "The Computer" — against James Hunt — "The Shunt". Precision vs raw speed. Let's settle it once and for all.

```bash
race-for-the-prize demo:lauda-vs-hunt
```

Two browsers launch. Two Wikipedia pages load. Then they scroll — human-like, pixel by pixel — to the bottom. Who reaches the finish line first?

![Lauda vs Hunt — side-by-side race replay](https://raw.githubusercontent.com/kertal/race-for-the-prize/main/docs/demos/race_hunt_vs_lauda.gif)

🎬 **[Open the replay ↗](https://kertal.github.io/race-for-the-prize/demos/race_hunt_vs_lauda.html)** — the report this race actually produced, player and all.

### What's in the race folder

The demo is copied into `./races/lauda-vs-hunt/` before it runs (the CLI asks first), so the specs are yours to read and edit:

```text
races/lauda-vs-hunt/
  lauda.spec.js      # 🔴 Racer 1: Niki Lauda's Wikipedia page
  hunt.spec.js       # 🔵 Racer 2: James Hunt's Wikipedia page
  settings.json      # Race conditions (parallel, throttle, etc.)
```

From then on `race-for-the-prize ./races/lauda-vs-hunt` runs your copy like any other race.

## 🏀 LeBron vs Curry

The GOAT debate, settled by browser performance. LeBron James — "The King" — against Stephen Curry — "The Chef". Both start at a fixed scroll position on their Wikipedia pages and dribble — basketball physics style, with gravity acceleration down and deceleration up — three times before racing back to the top.

```bash
race-for-the-prize demo:lebron-vs-curry
```

The dribbles are perfectly synced. The difference? The scroll back to the top: LeBron uses a smooth ease-in-out, Curry snaps up with a cubic ease-out. Pure browser performance decides the winner.

![LeBron vs Curry — side-by-side race replay](https://raw.githubusercontent.com/kertal/race-for-the-prize/main/docs/demos/race_curry_vs_lebron.gif)

🎬 **[Open the replay ↗](https://kertal.github.io/race-for-the-prize/demos/race_curry_vs_lebron.html)**

## ⚛️ React vs Angular (and friends)

The frontend framework cage match — four racers, one winner. React, Angular, Svelte, and htmx all load the same TodoMVC-style benchmark. RaceForThePrize supports up to five racers in a single heat.

```bash
race-for-the-prize demo:react-vs-angular
```

![React vs Angular vs Svelte vs htmx — four recordings replayed side by side](https://raw.githubusercontent.com/kertal/race-for-the-prize/main/docs/demos/race_frameworks.gif)

🎬 **[Open the replay ↗](https://kertal.github.io/race-for-the-prize/demos/race_frameworks.html)**

## 🤫 Encrypted cache vs plain cache vs no cache

What does caching cost, and when does it pay back? [HushHushDB](https://kertal.github.io/hush-hush-db/) downloads a dataset and can keep it in IndexedDB — encrypted with a key in `sessionStorage`, stored as plaintext, or not kept at all. Three racers boot the same app into a different cache handling mode, fetch the dataset, step back to the start screen through the app's own back link, and start the demo again.

```bash
race-for-the-prize demo:caching-comparison
```


## 🎬 The calibration lap

Four racers, four clips, one shared clock — the run used to prove that multi-clip
alignment in the player really lines up.

![The calibration lap — four recordings replayed side by side on one clock](https://raw.githubusercontent.com/kertal/race-for-the-prize/main/docs/demos/race_alpha_vs_bravo_vs_charlie_vs_delta.gif)

🎬 **[Open the replay ↗](https://kertal.github.io/race-for-the-prize/demos/race_alpha_vs_bravo_vs_charlie_vs_delta.html)**


## The grid at a glance

| Command | Race | Replay |
|---|---|---|
| `demo:lauda-vs-hunt` | The classic rivalry — two Wikipedia pages, scrolled to the bottom | [watch ↗](https://kertal.github.io/race-for-the-prize/demos/race_hunt_vs_lauda.html) |
| `demo:lebron-vs-curry` | The GOAT debate — dribble three times, then race back to the top | [watch ↗](https://kertal.github.io/race-for-the-prize/demos/race_curry_vs_lebron.html) |
| `demo:react-vs-angular` | Framework cage match — React, Angular, Svelte and htmx, four racers | [watch ↗](https://kertal.github.io/race-for-the-prize/demos/race_frameworks.html) |
| `demo:caching-comparison` | Encrypted cache vs plain cache vs no cache, both halves timed | run it yourself |

The replays are the reports these races really produced, videos and all, so they
are heavy pages (20–40 MB) — one tab at a time on a phone.

The demo has to be copied out of the package into `./races/<name>/` before it can run, so results land next to your work and the specs are yours to edit. (Running from the repository itself is the exception: there `races/<name>/` already *is* the bundled race, so nothing is copied and nothing is asked.) The first run lists the files and asks before writing anything:

```text
Demo race lauda-vs-hunt needs these files in races/lauda-vs-hunt/
  hunt.spec.js
  lauda.spec.js
  settings.json
Copy them there and start the race? [Y/n]
```

Answer `n` and nothing is written — the race is cancelled. A later run reuses your copy and never overwrites a file you edited, so it only asks again if something is missing. In scripts and CI, where there is nobody to ask, pass `--yes`:

```bash
race-for-the-prize demo:lauda-vs-hunt --yes
```

Every other flag works as usual:

```bash
race-for-the-prize demo:caching-comparison --network=slow-3g --runs=3
race-for-the-prize demo:lauda-vs-hunt --results   # view past results
```


---

Next: [write your own race](writing-races.md) · [race flags](cli.md) · [reading the results](results.md)
