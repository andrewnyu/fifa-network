# The Pass

An interactive continuation of the Kaggle notebook
[Six Degrees of (FIFA 15–21) Separation](https://www.kaggle.com/code/andnyu/six-degrees-of-fifa-15-21-separation).
Search any two players to see the shortest explainable chain of club and
national-team links between them, or add yourself by naming a player you know.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by the development server.

## Graph model

The precomputed browser graph is stored at `public/fifa-graph.json`. It contains
59,968 players and 9,243 compact club-edition or national-team-edition groups
from FIFA 15 through EA Sports FC 26. The UI runs breadth-first search over
those groups and shows the group that explains every hop.

Connections follow the notebook's stated rules:

- same club in the same FIFA edition;
- same called-up national team in the same edition;
- for countries without a FIFA squad, the top 30 players by overall rating are
  treated as the national squad.

The current build combines these public Kaggle datasets:

- [FIFA 15 through EA Sports FC 24](https://www.kaggle.com/datasets/stefanoleone992/ea-sports-fc-24-complete-player-dataset)
- [EA Sports FC 25](https://www.kaggle.com/datasets/sametozturkk/ea-sports-fc-25-real-player-data-sofifa-merge)
- [EA Sports FC 26](https://www.kaggle.com/datasets/rovnez/fc-26-fifa-26-player-data)

Download `male_players.csv`, `new-players-data-full.csv`, and the latest FC 26
CSV respectively, then run:

```bash
python3 scripts/build_graph.py /path/to/male_players.csv public/fifa-graph.json \
  --fc25 /path/to/new-players-data-full.csv \
  --fc26 /path/to/FC26_20250921.csv
```

## Validate

```bash
npm test
```

The tests build the app, check the graph's integrity, and verify real routes
across both the original and current generations of players.
