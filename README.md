# LaunchScope — token launch radar

LaunchScope reads the sealed DefiLlama snapshot (758 protocols, as of 2026-11-14) and ranks the protocols that have **no token yet** by the value a token would carry if it launched against the record the protocol has already built. Every ranked protocol ships with a concrete farm plan: the actions, the capital, the gas and the time each step takes.

**The model** (`lib/model.ts`, version `launchscope-2`):

```
implied value = TVL × 0.30 × momentum × maturity × breadth
```

- **Momentum** — the 7-day TVL change (clamped to −50%..+150%) through a saturating curve, `1 + 0.9·g/(60+|g|)`, so one wild week cannot swamp the board.
- **Maturity** — time run with no token, on a log-age curve peaking near 22 months; a protocol whose age the snapshot does not record earns only partial credit.
- **Breadth** — +4% per chain the TVL already sits on, up to nine chains: the distribution a launch would inherit.

A protocol joins the board only when the snapshot records no token for it (no market cap, no CoinGecko id, no symbol) and it is not a wrapped, staked or bridged product of one that already trades — bridges, canonical bridges, liquid staking/restaking, exchange house brands and versioned re-deploys are set aside by rules stated in the code, and every one of the snapshot's 40 watchlist protocols is covered. Protocols whose token already trades are shown separately in the dashboard's *Already trading* view. The board states what a token would be worth if the protocol's record stayed as it is; it does not predict whether or when a token is issued.

**The dashboard** (`dashboard/`) is sortable and filterable (search, category, chain, TVL floor, watchlist-only), with a detail view per protocol showing the record, the three model factors behind its value, and its farm plan. Screenshots: `screenshots/1-board.png` (the board), `screenshots/2-detail.png` (a protocol detail), `screenshots/3-filtered.png` (the board filtered to Lending).

## Run it

Node 22, standard library only, no network, fully deterministic — two runs write the same bytes.

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Outputs in the output directory: `board.json` (the ranked board), `data.js` (the dashboard's data), `dashboard/`, `screenshots/`, and `dossier.json` written last, byte for byte as the scorer rebuilds it, via the vendored library in `vendor/`.

## Layout

- `main.ts` — the program: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` — the value model, the board rules and the farm plans.
- `dashboard/` — the page (index.html, app.css, app.js).
- `screenshots/` — the three hand-in pictures.
- `vendor/makefun-board.ts` — the platform's dossier library, vendored unchanged.

## Bounty

[![Competition](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/Cenzer0/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/Cenzer0/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

Entry for make.fun's [Build the best token launch radar](https://make.fun/bounty/token-radar-01) bounty. Submitted by [@zer0ing](https://make.fun/u/zer0ing).

## License

MIT — see `LICENSE`.
