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
41,533 players and 5,402 compact club-season or national-team-season groups
from FIFA 15 through FIFA 21. The UI runs breadth-first search over those groups
and shows the group that explains every hop.

Connections follow the notebook's stated rules:

- same club in the same FIFA edition;
- same called-up national team in the same edition;
- for countries without a FIFA squad, the top 30 players by overall rating are
  treated as the national squad.

To rebuild the graph, download and extract the seven `players_15.csv` through
`players_21.csv` files from the notebook's Kaggle dataset, then run:

```bash
python3 scripts/build_graph.py /path/to/csv-directory public/fifa-graph.json
```

## Validate

```bash
npm test
```

The tests build the app, check the graph's integrity, and verify a real route
between Lionel Messi and Harry Kane.
