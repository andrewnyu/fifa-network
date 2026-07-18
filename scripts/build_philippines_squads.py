#!/usr/bin/env python3
"""Normalize Philippines men's national-team squads from Wikipedia.

The squad pages are intentionally kept as source URLs in the generated CSV so
every supplemental graph edge can be audited. The parser uses only the Python
standard library and understands the roster tables used by the cited pages.
"""

from __future__ import annotations

import argparse
import csv
import re
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path


@dataclass(frozen=True)
class SquadSource:
    slug: str
    label: str
    year: int

    @property
    def url(self) -> str:
        return f"https://en.wikipedia.org/wiki/{self.slug}"


SOURCES = (
    SquadSource("2010_AFF_Championship_squads", "2010 AFF Suzuki Cup", 2010),
    SquadSource("2012_AFC_Challenge_Cup_squads", "2012 AFC Challenge Cup", 2012),
    SquadSource("2012_AFF_Championship_squads", "2012 AFF Suzuki Cup", 2012),
    SquadSource("2014_AFC_Challenge_Cup_squads", "2014 AFC Challenge Cup", 2014),
    SquadSource("2014_AFF_Championship_squads", "2014 AFF Suzuki Cup", 2014),
    SquadSource("2016_AFF_Championship_squads", "2016 AFF Suzuki Cup", 2016),
    SquadSource("2018_AFF_Championship_squads", "2018 AFF Suzuki Cup", 2018),
    SquadSource("2019_AFC_Asian_Cup_squads", "2019 AFC Asian Cup", 2019),
    SquadSource("2020_AFF_Championship_squads", "2020 AFF Suzuki Cup", 2021),
    SquadSource("2022_AFF_Championship_squads", "2022 AFF Championship", 2022),
    SquadSource("2024_ASEAN_Championship_squads", "2024 ASEAN Championship", 2024),
)

# Wikipedia's qualifying round pages do not publish complete roster tables.
# Their goalscorer sections do provide explicit participation evidence, so the
# graph keeps these smaller cohorts and labels them honestly as scorers.
QUALIFYING_SCORERS = (
    (
        "2014 World Cup qualification (scorers)",
        2011,
        "https://en.wikipedia.org/wiki/2014_FIFA_World_Cup_qualification_%E2%80%93_AFC_first_round",
        ("Nate Burkey", "Phil Younghusband", "Emelio Caligdong", "Ángel Guirado"),
    ),
    (
        "2018 World Cup qualification (scorers)",
        2016,
        "https://en.wikipedia.org/wiki/2018_FIFA_World_Cup_qualification_%E2%80%93_AFC_second_round",
        ("Misagh Bahadoran", "Javier Patiño", "Iain Ramsay", "Stephan Schröck", "Manuel Ott"),
    ),
    (
        "2022 World Cup qualification (scorers)",
        2021,
        "https://en.wikipedia.org/wiki/2022_FIFA_World_Cup_qualification_%E2%80%93_AFC_second_round",
        (
            "Ángel Guirado",
            "John-Patrick Strauß",
            "Mark Hartmann",
            "Mike Ott",
            "Javier Patiño",
            "Iain Ramsay",
            "Patrick Reichelt",
            "Stephan Schröck",
        ),
    ),
    (
        "2026 World Cup qualification (scorers)",
        2024,
        "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_qualification_%E2%80%93_AFC_second_round",
        ("Patrick Reichelt", "Kevin Ingreso"),
    ),
)


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self.table: list[list[str]] | None = None
        self.row: list[str] | None = None
        self.cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table" and self.table is None:
            self.table = []
        elif self.table is not None and tag == "tr":
            self.row = []
        elif self.row is not None and tag in {"td", "th"}:
            self.cell = []
        elif self.cell is not None and tag == "br":
            self.cell.append(" ")

    def handle_data(self, data: str) -> None:
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self.cell is not None and self.row is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row is not None and self.table is not None:
            if self.row:
                self.table.append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            self.tables.append(self.table)
            self.table = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--input-dir",
        type=Path,
        help="Optional directory containing downloaded pages named by Wikipedia slug",
    )
    return parser.parse_args()


def load_html(source: SquadSource, input_dir: Path | None) -> str:
    if input_dir:
        return (input_dir / source.slug).read_text(encoding="utf-8")

    request = urllib.request.Request(
        source.url,
        headers={"User-Agent": "ThePassGraphBuilder/1.0 (source normalization)"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def parse_roster(document: str) -> list[dict[str, str]]:
    start = document.find('<h3 id="Philippines"')
    if start < 0:
        raise ValueError("Philippines section not found")
    end = document.find("</section>", start)
    if end < 0:
        raise ValueError("Philippines section did not terminate")

    parser = TableParser()
    parser.feed(document[start:end])
    if not parser.tables:
        raise ValueError("Philippines roster table not found")

    table = parser.tables[0]
    headers = table[0]
    player_column = headers.index("Player")
    position_column = headers.index("Pos.")
    club_column = headers.index("Club")

    roster = []
    for row in table[1:]:
        if len(row) <= max(player_column, position_column, club_column):
            continue
        player = re.sub(r"\s*\((?:c|captain)\)\s*$", "", row[player_column], flags=re.I)
        position = re.sub(r"^\d+", "", row[position_column])
        roster.append(
            {
                "player_name": player.strip(),
                "position": position.strip(),
                "club": row[club_column].strip(),
            }
        )
    return roster


def main() -> None:
    args = parse_args()
    rows: list[dict[str, object]] = []
    for source in SOURCES:
        for player in parse_roster(load_html(source, args.input_dir)):
            rows.append(
                {
                    "event_label": source.label,
                    "event_year": source.year,
                    **player,
                    "source_url": source.url,
                }
            )

    for label, year, source_url, players in QUALIFYING_SCORERS:
        rows.extend(
            {
                "event_label": label,
                "event_year": year,
                "player_name": player,
                "position": "",
                "club": "",
                "source_url": source_url,
            }
            for player in players
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=(
                "event_label",
                "event_year",
                "player_name",
                "position",
                "club",
                "source_url",
            ),
        )
        writer.writeheader()
        writer.writerows(rows)

    unique_players = len({str(row["player_name"]).casefold() for row in rows})
    print(
        f"Wrote {len(rows)} memberships across "
        f"{len(SOURCES) + len(QUALIFYING_SCORERS)} sourced events "
        f"for {unique_players} unique players"
    )


if __name__ == "__main__":
    main()
