[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/hamut1/token-radar-01-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/hamut1/token-radar-01-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Launch Radar

An entry for make.fun’s “Build the best token launch radar” competition ($1,325 pot, December 14, 2026 deadline). The radar reads a sealed DefiLlama snapshot of 758 protocols and ranks 200 by implied token launch value, including all 40 protocols on the pre-token watchlist. Each ranked row includes a farm plan.

The `radar-contour-1` model starts with total value locked (TVL) times a category multiple. It multiplies that baseline by an adjustment that combines maturity and growth, adds a chain bonus, and subtracts a discount for young protocols. Maturity increases logarithmically with age, so additional time counts less for older protocols. The model uses no hardcoded protocol names.

`main.ts` uses only the Node.js 22 standard library. It writes the 200-row `board.json`, dashboard data in `data.js`, and `dossier.json`, and copies the dashboard and three screenshots into the output directory. The static navy-and-amber dashboard works offline and includes the ranked board, per-protocol details, and filters.

## Run locally

With Node.js 22 and a snapshot JSON file, run:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Replace `<snapshot.json>` with the path to your snapshot, then open `out/dashboard/index.html` in your browser.

Released under the [MIT License](LICENSE).
