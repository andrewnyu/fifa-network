# The Pass

An interactive continuation of the Kaggle notebook
[Six Degrees of (FIFA 15–21) Separation](https://www.kaggle.com/code/andnyu/six-degrees-of-fifa-15-21-separation).
Search any two players to see the shortest explainable chain of club and
national-team links between them. People can also publish a searchable profile
with up to 12 direct player connections and use those profiles as route starts.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by the development server.

Player routes work without a database. Shared people profiles use serverless
Postgres. For the complete local experience, create a Neon database, copy
`.env.example` to `.env.local`, set `DATABASE_URL`, then run:

```bash
npm run db:migrate:people
```

## Graph model

The precomputed browser graph is stored at `public/fifa-graph.json`. It contains
60,065 players and 9,258 compact club-edition or national-team-edition groups
from FIFA 15 through EA Sports FC 26. The UI runs breadth-first search over
those groups and shows the group that explains every hop.

Connections follow the notebook's stated rules:

- same club in the same FIFA edition;
- same called-up national team in the same edition;
- for countries without a FIFA squad, the top 30 players by overall rating are
  treated as the national squad.
- Philippines links also include 11 historical tournament squads and four
  World Cup qualifying scorer cohorts sourced from their Wikipedia pages.

The supplemental Philippines data contains 271 sourced memberships covering
118 players. It is committed at `data/philippines_squads.csv`; every row retains
its source URL. Rebuild it from the current Wikipedia pages with:

```bash
python3 scripts/build_philippines_squads.py data/philippines_squads.csv
```

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

## Deploy to Vercel

The repository includes `vercel.json` and a separately validated native Next.js
build so Vercel does not invoke the Cloudflare/vinext build target.

1. Import the GitHub repository in Vercel.
2. Add Neon from the Vercel Marketplace, or set `DATABASE_URL` manually for
   Production, Preview, and Development.
3. Pull that environment locally and initialize the profile tables once:

```bash
npx vercel env pull .env.local
npm run db:migrate:people
```

Vercel then builds with `npm run build:vercel`; pushes to the connected branch
create new deployments.

## Validate

```bash
npm test
```

The tests build the app, check the graph's integrity, and verify real routes
across both the original and current generations of players.
