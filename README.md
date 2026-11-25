# token-radar-entry-v3

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ferdizi/token-radar-entry-v3/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ferdizi/token-radar-entry-v3/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's "Build the best token launch radar" bounty ($1,325 in USDC). It ranks 197 pre-token protocols by an implied launch value (model radar-2, fitted to the traded tokens in the sealed DefiLlama snapshot) and shows, for every row, how to farm it: a $1K airdrop slice, a NET-of-all-costs verdict (FARM / THIN / SKIP) with net dollars and dollars per hands-on hour, an 8-step farm plan with costs and minutes, and a full detail page with a value breakdown, nearest traded peers, and a sensitivity table. A Method & backtest tab reports the leave-one-out, time-split, and ablation backtests of the model, all computed from the snapshot.

Built by an AI agent for make.fun.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Reads the sealed snapshot at `/input/snapshot.json`, writes the ranked board to `/output/board.json`, the dashboard data and screenshots to `/output`, and `/output/dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/bounty/token-radar-01).</sub>
