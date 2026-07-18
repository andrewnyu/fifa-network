#!/usr/bin/env python3
"""Build the compact browser graph used by The Pass.

The script accepts either the original directory of ``players_15.csv`` through
``players_21.csv`` files or Stefano Leone's combined ``male_players.csv``
covering FIFA 15 through EA Sports FC 24. Optional FC 25 and FC 26 files use
small source-specific adapters and retain the same SoFIFA player ids.

Connections follow the original notebook's stated rules:

* players connect when they share a club in the same game edition;
* national-team players connect in the same edition when they have a squad
  number or squad position;
* for national teams not represented in the game, the top 30 players by
  overall rating for that edition are treated as the squad.

Instead of materialising every pair in a squad as an edge, the output keeps
club-edition and nation-edition groups as compact hyperedges. The browser's BFS
walks player -> group -> player, giving the same degree count with a much
smaller payload.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import unicodedata
import zlib
from collections import defaultdict
from collections.abc import Iterable
from pathlib import Path


NormalizedRow = dict[str, object]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "historical_input",
        type=Path,
        help="players_*.csv directory or combined FIFA 15-EA FC 24 male_players.csv",
    )
    parser.add_argument("output", type=Path)
    parser.add_argument("--fc25", type=Path, help="FC 25 new-players-data-full.csv")
    parser.add_argument("--fc26", type=Path, help="FC26_YYYYMMDD.csv")
    parser.add_argument(
        "--philippines-squads",
        type=Path,
        default=Path("data/philippines_squads.csv"),
        help="Wikipedia-sourced Philippines squad memberships",
    )
    return parser.parse_args()


def clean(value: object) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.casefold() in {"nan", "none", "null"} else text


def number(value: object, default: int = 0) -> int:
    text = clean(value).replace(",", "")
    if not text:
        return default
    try:
        return int(float(text))
    except ValueError:
        return default


def normalize(
    *,
    player_id: int,
    short_name: object,
    long_name: object,
    nationality: object,
    club: object,
    position: object,
    overall: object,
    national_number: object,
    national_position: object,
    year: int,
) -> NormalizedRow:
    short = clean(short_name)
    long = clean(long_name) or short
    positions = clean(position)
    primary_position = positions.split(",", 1)[0].strip()
    return {
        "id": player_id,
        "short": short or long,
        "long": long,
        "nationality": clean(nationality),
        "club": clean(club),
        "position": primary_position,
        "overall": number(overall),
        "national_number": clean(national_number),
        "national_position": clean(national_position),
        "year": year,
    }


def iter_original_files(input_dir: Path) -> Iterable[NormalizedRow]:
    csv_files = sorted(input_dir.glob("players_*.csv"))
    if not csv_files:
        raise SystemExit(f"No players_*.csv files found in {input_dir}")

    for csv_file in csv_files:
        fifa_year = int(csv_file.stem.rsplit("_", 1)[1])
        with csv_file.open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                yield normalize(
                    player_id=number(row.get("sofifa_id") or row.get("player_id")),
                    short_name=row.get("short_name"),
                    long_name=row.get("long_name"),
                    nationality=row.get("nationality") or row.get("nationality_name"),
                    club=row.get("club_name"),
                    position=row.get("player_positions"),
                    overall=row.get("overall"),
                    national_number=row.get("nation_jersey_number"),
                    national_position=row.get("nation_position"),
                    year=fifa_year,
                )


def iter_combined_history(csv_file: Path) -> Iterable[NormalizedRow]:
    with csv_file.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            yield normalize(
                player_id=number(row.get("player_id")),
                short_name=row.get("short_name"),
                long_name=row.get("long_name"),
                nationality=row.get("nationality_name"),
                club=row.get("club_name"),
                position=row.get("player_positions"),
                overall=row.get("overall"),
                national_number=row.get("nation_jersey_number"),
                national_position=row.get("nation_position"),
                year=number(row.get("fifa_version")),
            )


def fc25_player_id(row: dict[str, str]) -> int:
    image = clean(row.get("image"))
    match = re.search(r"/players/(\d{3})/(\d{3})/", image)
    if match:
        return int(f"{match.group(1)}{match.group(2)}")

    # Rare missing-image records still need a stable id. Keep these in a
    # separate high range so they cannot collide with SoFIFA numeric ids.
    slug = clean(row.get("player_slug"))
    return 900_000_000 + zlib.crc32(slug.encode("utf-8"))


def iter_fc25(csv_file: Path) -> Iterable[NormalizedRow]:
    with csv_file.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            yield normalize(
                player_id=fc25_player_id(row),
                short_name=row.get("name"),
                long_name=row.get("full_name"),
                nationality=row.get("country_name"),
                club=row.get("club_name"),
                position=row.get("positions") or row.get("best_position"),
                overall=row.get("overall_rating"),
                national_number=row.get("country_kit_number"),
                national_position=row.get("country_position"),
                year=25,
            )


def iter_fc26(csv_file: Path) -> Iterable[NormalizedRow]:
    with csv_file.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            yield normalize(
                player_id=number(row.get("player_id")),
                short_name=row.get("short_name"),
                long_name=row.get("long_name"),
                nationality=row.get("nationality_name"),
                club=row.get("club_name"),
                position=row.get("player_positions"),
                overall=row.get("overall"),
                national_number=row.get("nation_jersey_number"),
                national_position=row.get("nation_position"),
                year=26,
            )


def load_rows(args: argparse.Namespace) -> list[NormalizedRow]:
    if args.historical_input.is_dir():
        rows = list(iter_original_files(args.historical_input))
    else:
        rows = list(iter_combined_history(args.historical_input))

    if args.fc25:
        rows.extend(iter_fc25(args.fc25))
    if args.fc26:
        rows.extend(iter_fc26(args.fc26))

    return [row for row in rows if int(row["id"]) > 0 and int(row["year"]) > 0]


def normalized_name(value: object) -> str:
    return " ".join(
        "".join(
            character
            for character in unicodedata.normalize("NFKD", clean(value)).casefold()
            if character.isalnum() or character.isspace()
        ).split()
    )


def synthetic_player_id(name: str) -> int:
    return 800_000_000 + zlib.crc32(normalized_name(name).encode("utf-8"))


def load_philippines_squads(path: Path | None) -> list[dict[str, object]]:
    if path is None or not path.exists():
        return []

    rows: list[dict[str, object]] = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            player_name = clean(row.get("player_name"))
            event_label = clean(row.get("event_label"))
            if not player_name or not event_label:
                continue
            rows.append(
                {
                    "event_label": event_label,
                    "event_year": number(row.get("event_year")),
                    "player_name": player_name,
                    "position": clean(row.get("position")),
                    "club": clean(row.get("club")),
                    "source_url": clean(row.get("source_url")),
                }
            )
    return rows


def main() -> None:
    args = parse_args()
    rows = load_rows(args)
    if not rows:
        raise SystemExit("No player rows were loaded")

    years = sorted({int(row["year"]) for row in rows})
    fifa_nations = {
        str(row["nationality"])
        for row in rows
        if row["national_number"] or row["national_position"]
    }

    non_fifa_candidates: dict[tuple[int, str], list[tuple[int, int]]] = defaultdict(list)
    for row in rows:
        nationality = str(row["nationality"])
        if nationality and nationality not in fifa_nations:
            key = (int(row["year"]), nationality)
            non_fifa_candidates[key].append((int(row["overall"]), int(row["id"])))

    inferred_squads: dict[tuple[int, str], set[int]] = {}
    for key, candidates in non_fifa_candidates.items():
        inferred_squads[key] = {
            player_id for _, player_id in sorted(candidates, reverse=True)[:30]
        }

    player_by_id: dict[int, dict[str, object]] = {}
    memberships: dict[tuple[str, int, str], set[int]] = defaultdict(set)
    supplemental_events: dict[tuple[int, str, str], set[int]] = defaultdict(set)
    supplemental_player_ids: set[int] = set()

    for row in rows:
        player_id = int(row["id"])
        edition = int(row["year"])
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
                "firstYear": edition,
                "lastYear": edition,
            }
        else:
            player = player_by_id[player_id]
            previous_latest = int(player["lastYear"])
            player["firstYear"] = min(int(player["firstYear"]), edition)
            player["lastYear"] = max(previous_latest, edition)
            if edition >= previous_latest:
                player.update(
                    shortName=row["short"],
                    longName=row["long"],
                    nationality=nationality,
                    position=row["position"],
                    club=club,
                    overall=int(row["overall"]),
                )

        if club:
            memberships[("club", edition, club)].add(player_id)

        called_up = bool(row["national_number"] or row["national_position"])
        if nationality and nationality not in fifa_nations:
            called_up = player_id in inferred_squads[(edition, nationality)]
        if called_up and nationality:
            memberships[("nation", edition, nationality)].add(player_id)

    name_to_player_id: dict[str, int] = {}
    for player_id, player in player_by_id.items():
        for name in (player["shortName"], player["longName"]):
            normalized = normalized_name(name)
            if normalized:
                name_to_player_id.setdefault(normalized, player_id)

    # Wikipedia roster names are often shorter than SoFIFA's legal names. These
    # verified aliases preserve the original player ids where a graph node
    # already exists; everyone else receives a deterministic supplemental id.
    philippines_aliases = {
        "alvaro silva": 163870,
        "bjorn martin kristensen": 271533,
        "daisuke sato": 239404,
        "iain ramsay": 200394,
        "jefferson tabinas": 237659,
        "jerry lucena": 30690,
        "jesper nyholm": 237226,
        "kevin ray mendoza": 215656,
        "luke woodland": 213852,
        "martin steuble": 189113,
        "michael kempter": 230691,
        "mike ott": 212191,
        "neil etheridge": 193186,
    }

    for squad_row in load_philippines_squads(args.philippines_squads):
        name = str(squad_row["player_name"])
        normalized = normalized_name(name)
        player_id = philippines_aliases.get(normalized) or name_to_player_id.get(normalized)
        if player_id is None:
            player_id = synthetic_player_id(name)

        event_year = int(squad_row["event_year"])
        if player_id not in player_by_id:
            player_by_id[player_id] = {
                "id": player_id,
                "shortName": name,
                "longName": name,
                "nationality": "Philippines",
                "position": squad_row["position"],
                "club": squad_row["club"],
                "overall": 0,
                "firstYear": event_year % 100,
                "lastYear": event_year % 100,
            }
            supplemental_player_ids.add(player_id)
        elif player_id in supplemental_player_ids:
            player = player_by_id[player_id]
            previous_latest = int(player["lastYear"])
            player["firstYear"] = min(int(player["firstYear"]), event_year % 100)
            player["lastYear"] = max(previous_latest, event_year % 100)
            if event_year % 100 >= previous_latest:
                if squad_row["position"]:
                    player["position"] = squad_row["position"]
                if squad_row["club"]:
                    player["club"] = squad_row["club"]

        event_key = (
            event_year,
            str(squad_row["event_label"]),
            str(squad_row["source_url"]),
        )
        supplemental_events[event_key].add(player_id)

    players = sorted(
        player_by_id.values(),
        key=lambda player: (str(player["shortName"]).casefold(), int(player["id"])),
    )
    player_index = {int(player["id"]): index for index, player in enumerate(players)}

    events: list[dict[str, object]] = []
    relationship_count = 0
    for (kind, edition, name), members in sorted(
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
                "fifaYear": edition,
                "members": indexed_members,
            }
        )

    for (event_year, label, source_url), members in sorted(
        supplemental_events.items(), reverse=True
    ):
        if len(members) < 2:
            continue
        indexed_members = sorted(player_index[player_id] for player_id in members)
        relationship_count += len(indexed_members)
        events.append(
            {
                "kind": "nation",
                "name": "Philippines",
                "fifaYear": event_year % 100,
                "label": label,
                "sourceUrl": source_url,
                "members": indexed_members,
            }
        )

    sources = ["stefanoleone992/ea-sports-fc-24-complete-player-dataset"]
    if args.fc25:
        sources.append("sametozturkk/ea-sports-fc-25-real-player-data-sofifa-merge")
    if args.fc26:
        sources.append("rovnez/fc-26-fifa-26-player-data")
    if supplemental_events:
        sources.append("Wikipedia Philippines squad and qualifying pages")

    payload = {
        "meta": {
            "title": "FIFA 15-EA Sports FC 26 player connection graph",
            "sources": sources,
            "years": years,
            "currentEdition": max(years),
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
    editions = f"{min(years)}-{max(years)}"
    print(
        f"Wrote {len(players):,} players, {len(events):,} groups, "
        f"{relationship_count:,} memberships across editions {editions} "
        f"({size_mb:.2f} MiB)"
    )


if __name__ == "__main__":
    main()
