# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/xinnsmith161-cloud/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/xinnsmith161-cloud/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar reads a sealed snapshot of every protocol DefiLlama tracks, finds the ones that still record no token and are not a wrapped or staked product of one that trades, and ranks them by what their launch would be worth. Each category is priced from the market caps of the protocols that already trade, so the ranking follows the snapshot's own figures — TVL, seven-day growth and age with no token — and the dashboard ships the board, a detail view per protocol with the full equation, and the steps to farm it.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=be7crr5f&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
