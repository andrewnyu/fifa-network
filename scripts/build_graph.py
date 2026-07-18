#!/usr/bin/env python3
"""Build the compact browser graph used by The Pass.

The source rows come from the FIFA 15-21 dataset used by the original Kaggle
notebook. Connections follow the notebook's stated rules:

* players connect when they share a club in the same FIFA edition;
* national-team players connect in the same edition when they have a FIFA
  national-team squad number;
* for national teams not represented in FIFA, the top 30 players by overall
  rating for that edition are treated as the squad.

Instead of materialising every pair in a squad as an edge, the output keeps
club-season and nation-season groups as compact hyperedges. The browser's BFS
walks player -> group -> player, which gives the same degree count with a much
smaller payload.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("output", type=Path)
    return parser.parse_args()


def compact_row(row: dict[str, str], fifa_year: int) -> dict[str, object]:
    return {
        "id": int(row["sofifa_id"]),
        "short": row["short_name"].strip(),
        "long": row["long_name"].strip() or row["short_name"].strip(),
        "nationality": row["nationality"].strip(),
        "club": row["club_name"].strip(),
        "position": row["player_positions"].split(",", 1)[0].strip(),
        "overall": int(float(row["overall"] or 0)),
        "national_number": row["nation_jersey_number"].strip(),
        "year": fifa_year,
    }


def main() -> None:
    args = parse_args()
    rows: list[dict[str, object]] = []
    fifa_nations: set[str] = set()

    csv_files = sorted(args.input_dir.glob("players_*.csv"))
    if not csv_files:
        raise SystemExit(f"No players_*.csv files found in {args.input_dir}")

    for csv_file in csv_files:
        fifa_year = int(csv_file.stem.rsplit("_", 1)[1])
        with csv_file.open(encoding="utf-8-sig", newline="") as handle:
            for raw_row in csv.DictReader(handle):
                row = compact_row(raw_row, fifa_year)
                rows.append(row)
                if row["national_number"]:
                    fifa_nations.add(str(row["nationality"]))

    non_fifa_candidates: dict[tuple[int, str], list[tuple[int, int]]] = defaultdict(list)
    for row in rows:
        nationality = str(row["nationality"])
        if nationality not in fifa_nations:
            key = (int(row["year"]), nationality)
            non_fifa_candidates[key].append((int(row["overall"]), int(row["id"])))

    inferred_squads: dict[tuple[int, str], set[int]] = {}
    for key, candidates in non_fifa_candidates.items():
        inferred_squads[key] = {
            player_id
            for _, player_id in sorted(candidates, reverse=True)[:30]
        }

    player_by_id: dict[int, dict[str, object]] = {}
    memberships: dict[tuple[str, int, str], set[int]] = defaultdict(set)

    for row in rows:
        player_id = int(row["id"])
        fifa_year = int(row["year"])
        nationality = str(row["nationality"])
        club = str(row["club"])

        if player_id not in player_by_id:
            player_by_id[player_id] = {
                "id": player_id,
                "shortName": row["short"],
                "longName": row["long"],
                "nationality": nationality,
                "position": row["position"],
                "club": club,
                "overall": int(row["overall"]),
                "firstYear": fifa_year,
                "lastYear": fifa_year,
            }
        else:
            player = player_by_id[player_id]
            player["firstYear"] = min(int(player["firstYear"]), fifa_year)
            player["lastYear"] = max(int(player["lastYear"]), fifa_year)
            if fifa_year >= int(player["lastYear"]):
                player.update(
                    shortName=row["short"],
                    longName=row["long"],
                    nationality=nationality,
                    position=row["position"],
                    club=club,
                    overall=int(row["overall"]),
                )

        if club:
            memberships[("club", fifa_year, club)].add(player_id)

        called_up = bool(row["national_number"])
        if nationality not in fifa_nations:
            called_up = player_id in inferred_squads[(fifa_year, nationality)]
        if called_up:
            memberships[("nation", fifa_year, nationality)].add(player_id)

    players = sorted(
        player_by_id.values(),
        key=lambda player: (str(player["shortName"]).casefold(), int(player["id"])),
    )
    player_index = {int(player["id"]): index for index, player in enumerate(players)}

    events: list[dict[str, object]] = []
    relationship_count = 0
    for (kind, year, name), members in sorted(
        memberships.items(),
        key=lambda item: (-item[0][1], item[0][0], item[0][2].casefold()),
    ):
        if len(members) < 2:
            continue
        indexed_members = sorted(player_index[player_id] for player_id in members)
        relationship_count += len(indexed_members)
        events.append(
            {
                "kind": kind,
                "name": name,
                "fifaYear": year,
                "members": indexed_members,
            }
        )

    payload = {
        "meta": {
            "title": "FIFA 15-21 player connection graph",
            "source": "stefanoleone992/fifa-21-complete-player-dataset",
            "years": [15, 16, 17, 18, 19, 20, 21],
            "playerCount": len(players),
            "eventCount": len(events),
            "membershipCount": relationship_count,
        },
        "players": players,
        "events": events,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    size_mb = args.output.stat().st_size / (1024 * 1024)
    print(
        f"Wrote {len(players):,} players, {len(events):,} groups, "
        f"{relationship_count:,} memberships ({size_mb:.2f} MiB)"
    )


if __name__ == "__main__":
    main()
