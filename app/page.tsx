"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

type Player = {
  id: number;
  shortName: string;
  longName: string;
  nationality: string;
  position: string;
  club: string;
  overall: number;
  firstYear: number;
  lastYear: number;
};

type ConnectionGroup = {
  kind: "club" | "nation";
  name: string;
  fifaYear: number;
  label?: string;
  sourceUrl?: string;
  members: number[];
};

type GraphPayload = {
  meta: {
    playerCount: number;
    eventCount: number;
    membershipCount: number;
    years: number[];
    currentEdition: number;
  };
  players: Player[];
  events: ConnectionGroup[];
};

type SearchableGraph = GraphPayload & {
  playerGroups: number[][];
  playerIdToIndex: Map<number, number>;
  searchText: string[];
  searchNames: string[][];
};

type Route = {
  players: number[];
  eventIds: number[];
  fromPerson: boolean;
};

type VisitorProfile = {
  id?: string;
  slug?: string;
  editToken?: string;
  name: string;
  linkedPlayerIds: number[];
};

type PublicPerson = {
  id: string;
  slug: string;
  displayName: string;
  playerIds: number[];
  updatedAt: string;
};

type DistanceStats = {
  buckets: {
    degree: number;
    count: number;
    percentage: number;
  }[];
  reachedWithinSix: number;
  reachedPercentage: number;
  outsideSix: number;
};

const DEFAULT_SOURCE_ID = 239085; // Erling Haaland
const DEFAULT_TARGET_ID = 158023; // Lionel Messi
const PROFILE_KEY = "the-pass-profile-v1";
const SEARCH_CHARACTER_FOLD: Record<string, string> = {
  ø: "o",
  ł: "l",
  đ: "d",
  ð: "d",
};

function normalizeSearchText(value: string) {
  return value
    .toLocaleLowerCase()
    .replaceAll("ß", "ss")
    .replaceAll("æ", "ae")
    .replaceAll("œ", "oe")
    .replace(/[øłđð]/g, (character) => SEARCH_CHARACTER_FOLD[character])
    .replaceAll("þ", "th")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function isOneEditAway(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }

  return edits + Number(leftIndex < left.length || rightIndex < right.length) <= 1;
}

function playerNameAliases(player: Player) {
  const longParts = player.longName.split(/\s+/).filter(Boolean);
  return Array.from(new Set([
    normalizeSearchText(player.shortName),
    normalizeSearchText(player.longName),
    longParts.length > 1
      ? normalizeSearchText(`${longParts[0]} ${longParts[longParts.length - 1]}`)
      : normalizeSearchText(player.longName),
  ].filter(Boolean)));
}

function buildSearchableGraph(payload: GraphPayload): SearchableGraph {
  const playerGroups = Array.from(
    { length: payload.players.length },
    () => [] as number[],
  );

  payload.events.forEach((event, eventId) => {
    event.members.forEach((playerIndex) => playerGroups[playerIndex].push(eventId));
  });

  return {
    ...payload,
    playerGroups,
    playerIdToIndex: new Map(
      payload.players.map((player, index) => [player.id, index]),
    ),
    searchText: payload.players.map((player) => normalizeSearchText(
      `${player.shortName} ${player.longName} ${player.club} ${player.nationality}`,
    )),
    searchNames: payload.players.map(playerNameAliases),
  };
}

function findShortestRoute(
  graph: SearchableGraph,
  sourceIndexes: number[],
  targetIndex: number,
  fromPerson: boolean,
): Route | null {
  if (sourceIndexes.length === 0 || targetIndex < 0) return null;

  const playerSeen = new Uint8Array(graph.players.length);
  const groupSeen = new Uint8Array(graph.events.length);
  const parent = new Int32Array(graph.players.length);
  const parentEvent = new Int32Array(graph.players.length);
  parent.fill(-2);
  parentEvent.fill(-1);

  const queue = new Int32Array(graph.players.length);
  let head = 0;
  let tail = 0;

  sourceIndexes.forEach((sourceIndex) => {
    if (!playerSeen[sourceIndex]) {
      playerSeen[sourceIndex] = 1;
      parent[sourceIndex] = -1;
      queue[tail++] = sourceIndex;
    }
  });

  while (head < tail && !playerSeen[targetIndex]) {
    const currentPlayer = queue[head++];
    for (const eventId of graph.playerGroups[currentPlayer]) {
      if (groupSeen[eventId]) continue;
      groupSeen[eventId] = 1;

      for (const nextPlayer of graph.events[eventId].members) {
        if (playerSeen[nextPlayer]) continue;
        playerSeen[nextPlayer] = 1;
        parent[nextPlayer] = currentPlayer;
        parentEvent[nextPlayer] = eventId;
        queue[tail++] = nextPlayer;
        if (nextPlayer === targetIndex) break;
      }
    }
  }

  if (!playerSeen[targetIndex]) return null;

  const players: number[] = [targetIndex];
  const eventIds: number[] = [];
  let cursor = targetIndex;

  while (parent[cursor] !== -1) {
    eventIds.unshift(parentEvent[cursor]);
    cursor = parent[cursor];
    players.unshift(cursor);
  }

  return { players, eventIds, fromPerson };
}

function calculateDistanceStats(
  graph: SearchableGraph,
  sourceIndexes: number[],
  sourceDistance = 0,
): DistanceStats | null {
  const sources = Array.from(new Set(sourceIndexes.filter((index) => index >= 0)));
  if (sources.length === 0) return null;

  const playerSeen = new Uint8Array(graph.players.length);
  const groupSeen = new Uint8Array(graph.events.length);
  const distance = new Int8Array(graph.players.length);
  distance.fill(-1);
  const queue = new Int32Array(graph.players.length);
  const counts = new Int32Array(7);
  let head = 0;
  let tail = 0;

  sources.forEach((sourceIndex) => {
    playerSeen[sourceIndex] = 1;
    distance[sourceIndex] = sourceDistance;
    if (sourceDistance > 0) counts[sourceDistance] += 1;
    queue[tail++] = sourceIndex;
  });

  while (head < tail) {
    const currentPlayer = queue[head++];
    const currentDistance = distance[currentPlayer];
    if (currentDistance >= 6) continue;

    for (const eventId of graph.playerGroups[currentPlayer]) {
      if (groupSeen[eventId]) continue;
      groupSeen[eventId] = 1;

      for (const nextPlayer of graph.events[eventId].members) {
        if (playerSeen[nextPlayer]) continue;
        const nextDistance = currentDistance + 1;
        playerSeen[nextPlayer] = 1;
        distance[nextPlayer] = nextDistance;
        counts[nextDistance] += 1;
        queue[tail++] = nextPlayer;
      }
    }
  }

  const universe = graph.players.length;
  const reachedWithinSix = counts.reduce((sum, count) => sum + count, 0);
  return {
    buckets: Array.from({ length: 6 }, (_, index) => {
      const degree = index + 1;
      const count = counts[degree];
      return {
        degree,
        count,
        percentage: (count / universe) * 100,
      };
    }),
    reachedWithinSix,
    reachedPercentage: (reachedWithinSix / universe) * 100,
    outsideSix: universe - reachedWithinSix - (sourceDistance === 0 ? sources.length : 0),
  };
}

function getInitials(name: string) {
  const parts = name.split(/[\s.]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toLocaleUpperCase();
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function formatPercentage(value: number) {
  if (value >= 10) return `${value.toFixed(1)}%`;
  if (value >= 1) return `${value.toFixed(2)}%`;
  return `${value.toFixed(3)}%`;
}

function formatEdition(edition: number) {
  return edition >= 24 ? `EA FC ${edition}` : `FIFA ${edition}`;
}

function PlayerPicker({
  id,
  label,
  graph,
  selectedIndex,
  query,
  onQueryChange,
  onSelect,
  placeholder,
}: {
  id: string;
  label: string;
  graph: SearchableGraph;
  selectedIndex: number;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (index: number) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);

  const suggestions = useMemo(() => {
    const normalized = normalizeSearchText(query);
    if (normalized.length < 2) return [];

    const matches: { index: number; score: number }[] = [];
    graph.searchText.forEach((searchable, index) => {
      const player = graph.players[index];
      const short = normalizeSearchText(player.shortName);
      const long = normalizeSearchText(player.longName);
      const names = graph.searchNames[index];
      if (
        !searchable.includes(normalized) &&
        !names.some((name) => name.includes(normalized))
      ) return;
      const score = short.startsWith(normalized)
        ? 0
        : long.startsWith(normalized)
          ? 1
          : names.some((name) => name.startsWith(normalized))
            ? 2
          : short.includes(normalized)
            ? 3
            : 4;
      matches.push({ index, score });
    });

    if (normalized.length >= 4 && matches.length < 7) {
      const matchedIndexes = new Set(matches.map((match) => match.index));
      graph.searchNames.forEach((names, index) => {
        if (matchedIndexes.has(index)) return;
        if (names.some((name) => isOneEditAway(normalized, name))) {
          matches.push({ index, score: 5 });
        }
      });
    }

    return matches
      .sort(
        (a, b) =>
          a.score - b.score ||
          graph.players[b.index].overall - graph.players[a.index].overall,
      )
      .slice(0, 7)
      .map((match) => match.index);
  }, [graph, query]);

  const choose = (index: number) => {
    onSelect(index);
    onQueryChange(graph.players[index].shortName);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && open && suggestions.length > 0) {
      event.preventDefault();
      choose(suggestions[0]);
    }
    if (event.key === "Escape") setOpen(false);
  };

  const selectedPlayer = graph.players[selectedIndex];

  return (
    <div className="picker">
      <label htmlFor={id}>{label}</label>
      <div className="picker-field">
        <span className="picker-avatar" aria-hidden="true">
          {selectedPlayer ? getInitials(selectedPlayer.shortName) : "?"}
        </span>
        <input
          id={id}
          type="search"
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setOpen(true);
          }}
          onFocus={(event) => {
            event.currentTarget.select();
            setOpen(true);
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={`${id}-suggestions`}
        />
        <span className="picker-caret" aria-hidden="true">⌄</span>
      </div>

      {open && suggestions.length > 0 && (
        <div className="suggestions" id={`${id}-suggestions`} role="listbox">
          {suggestions.map((index) => {
            const player = graph.players[index];
            return (
              <button
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                key={player.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                <span className="suggestion-initials" aria-hidden="true">
                  {getInitials(player.shortName)}
                </span>
                <span className="suggestion-copy">
                  <strong>{player.shortName}</strong>
                  <small>
                    {player.club || player.nationality} · {player.position}
                  </small>
                </span>
                <span className="suggestion-rating">{player.overall || "PH"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PeoplePicker({
  graph,
  onSelect,
  label = "FROM A PERSON",
  id = "community-person",
}: {
  graph: SearchableGraph;
  onSelect: (person: PublicPerson) => void;
  label?: string;
  id?: string;
}) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<PublicPerson[]>([]);
  const [open, setOpen] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length === 1) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      const endpoint = normalized
        ? `/api/people?q=${encodeURIComponent(normalized)}`
        : "/api/people?recent=1";
      fetch(endpoint, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("People search unavailable");
          return response.json() as Promise<{ people: PublicPerson[] }>;
        })
        .then((payload) => {
          setPeople(payload.people);
          setUnavailable(false);
        })
        .catch((error: Error) => {
          if (error.name !== "AbortError") {
            setPeople([]);
            setUnavailable(true);
          }
        });
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  const choose = (person: PublicPerson) => {
    onSelect(person);
    setQuery(person.displayName);
    setOpen(false);
  };

  return (
    <div className="people-picker">
      <label htmlFor={id}>{label}</label>
      <div className="people-field">
        <span aria-hidden="true">⌕</span>
        <input
          id={id}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          placeholder="Search community profiles"
          autoComplete="off"
        />
      </div>
      {open && query.trim().length !== 1 && (
        <div className="people-results">
          {people.map((person) => {
            const linkedNames = person.playerIds
              .map((id) => graph.playerIdToIndex.get(id))
              .filter((index): index is number => index !== undefined)
              .slice(0, 3)
              .map((index) => graph.players[index].shortName);
            return (
              <button
                type="button"
                key={person.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(person)}
              >
                <span>{getInitials(person.displayName)}</span>
                <span>
                  <strong>{person.displayName}</strong>
                  <small>
                    {linkedNames.join(", ") || `${person.playerIds.length} player links`}
                  </small>
                </span>
                <i aria-hidden="true">→</i>
              </button>
            );
          })}
          {!unavailable && people.length === 0 && (
            <p>{query.trim() ? "No shared profiles found." : "No community profiles yet."}</p>
          )}
          {unavailable && <p>Community search needs the shared database.</p>}
        </div>
      )}
    </div>
  );
}

function LoadingMap() {
  return (
    <div className="map-loading" role="status">
      <span className="loading-ball" aria-hidden="true" />
      <strong>Building the player network</strong>
      <span>Indexing twelve FIFA and EA Sports FC editions…</span>
    </div>
  );
}

export default function Home() {
  const [graph, setGraph] = useState<SearchableGraph | null>(null);
  const [loadError, setLoadError] = useState("");
  const [sourceIndex, setSourceIndex] = useState(-1);
  const [targetIndex, setTargetIndex] = useState(-1);
  const [sourceQuery, setSourceQuery] = useState("Lionel Messi");
  const [targetQuery, setTargetQuery] = useState("Harry Kane");
  const [statsPlayerIndex, setStatsPlayerIndex] = useState(-1);
  const [statsQuery, setStatsQuery] = useState("Lionel Messi");
  const [statsMode, setStatsMode] = useState<"player" | "community">("player");
  const [statsCommunityPerson, setStatsCommunityPerson] = useState<PublicPerson | null>(null);
  const [sourceMode, setSourceMode] = useState<"player" | "visitor" | "community">("player");
  const [visitor, setVisitor] = useState<VisitorProfile>({
    name: "",
    linkedPlayerIds: [],
  });
  const [communityPerson, setCommunityPerson] = useState<PublicPerson | null>(null);
  const [sourcePickerMode, setSourcePickerMode] = useState<"player" | "person">("player");
  const [joinOpen, setJoinOpen] = useState(false);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkCandidateIndex, setLinkCandidateIndex] = useState(-1);
  const [profileStatus, setProfileStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [profileMessage, setProfileMessage] = useState("");
  const [routePulse, setRoutePulse] = useState(0);
  const [pathScale, setPathScale] = useState(1);
  const [pathSize, setPathSize] = useState({ width: 0, height: 0 });
  const [fitRevision, setFitRevision] = useState(0);
  const profileLoaded = useRef(false);
  const pathViewportRef = useRef<HTMLDivElement>(null);
  const pathTrackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/fifa-graph.json")
      .then((response) => {
        if (!response.ok) throw new Error("The network data could not be loaded.");
        return response.json() as Promise<GraphPayload>;
      })
      .then((payload) => {
        if (cancelled) return;
        const searchable = buildSearchableGraph(payload);
        const source = searchable.playerIdToIndex.get(DEFAULT_SOURCE_ID) ?? 0;
        const target = searchable.playerIdToIndex.get(DEFAULT_TARGET_ID) ?? 1;
        setGraph(searchable);
        setSourceIndex(source);
        setTargetIndex(target);
        setStatsPlayerIndex(source);
        setSourceQuery(searchable.players[source].shortName);
        setTargetQuery(searchable.players[target].shortName);
        setStatsQuery(searchable.players[source].shortName);
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(PROFILE_KEY);
        if (saved) setVisitor(JSON.parse(saved) as VisitorProfile);
      } catch {
        // A blocked or malformed local profile should never block the explorer.
      } finally {
        profileLoaded.current = true;
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!profileLoaded.current) return;
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(visitor));
  }, [visitor]);

  const linkedIndexes = useMemo(() => {
    if (!graph) return [];
    return visitor.linkedPlayerIds
      .map((id) => graph.playerIdToIndex.get(id))
      .filter((index): index is number => index !== undefined);
  }, [graph, visitor.linkedPlayerIds]);

  const communityLinkedIndexes = useMemo(() => {
    if (!graph || !communityPerson) return [];
    return communityPerson.playerIds
      .map((id) => graph.playerIdToIndex.get(id))
      .filter((index): index is number => index !== undefined);
  }, [communityPerson, graph]);

  const sourceLinkedIndexes = useMemo(
    () => sourceMode === "visitor"
      ? linkedIndexes
      : sourceMode === "community"
        ? communityLinkedIndexes
        : [],
    [communityLinkedIndexes, linkedIndexes, sourceMode],
  );
  const sourcePersonName = sourceMode === "community"
    ? communityPerson?.displayName || "Community profile"
    : visitor.name || "You";

  const route = useMemo(() => {
    if (!graph || targetIndex < 0) return null;
    const sources = sourceMode === "player" ? [sourceIndex] : sourceLinkedIndexes;
    return findShortestRoute(
      graph,
      sources.filter((index) => index >= 0),
      targetIndex,
      sourceMode !== "player",
    );
  }, [graph, sourceIndex, sourceLinkedIndexes, sourceMode, targetIndex]);

  const degreeCount = route
    ? route.eventIds.length + (route.fromPerson ? 1 : 0)
    : 0;

  useEffect(() => {
    if (!route) return;
    const viewport = pathViewportRef.current;
    const track = pathTrackRef.current;
    if (!viewport || !track) return;

    const fit = () => {
      const width = track.scrollWidth;
      const height = track.scrollHeight;
      if (!width || !height) return;
      setPathSize({ width, height });
      setPathScale(Math.min(
        1,
        Math.max(0.1, (viewport.clientWidth - 56) / width),
        Math.max(0.1, (viewport.clientHeight - 36) / height),
      ));
    };

    const frame = window.requestAnimationFrame(fit);
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fitRevision, route]);

  const statsCommunityIndexes = useMemo(() => {
    if (!graph || !statsCommunityPerson) return [];
    return statsCommunityPerson.playerIds
      .map((id) => graph.playerIdToIndex.get(id))
      .filter((index): index is number => index !== undefined);
  }, [graph, statsCommunityPerson]);

  const distanceStats = useMemo(() => {
    if (!graph) return null;
    return statsMode === "community"
      ? calculateDistanceStats(graph, statsCommunityIndexes, 1)
      : calculateDistanceStats(graph, [statsPlayerIndex]);
  }, [graph, statsCommunityIndexes, statsMode, statsPlayerIndex]);

  const statsSourceName = statsMode === "community"
    ? statsCommunityPerson?.displayName || "Community profile"
    : graph && statsPlayerIndex >= 0
      ? graph.players[statsPlayerIndex].shortName
      : "Player";

  const addVisitorLink = (playerIndex = linkCandidateIndex) => {
    if (!graph || playerIndex < 0 || !visitor.name.trim()) return;
    const playerId = graph.players[playerIndex].id;
    if (
      visitor.linkedPlayerIds.length >= 12 &&
      !visitor.linkedPlayerIds.includes(playerId)
    ) {
      setProfileStatus("error");
      setProfileMessage("A shared profile can have up to 12 direct player links.");
      return;
    }
    setVisitor((current) => ({
      ...current,
      name: current.name.trim(),
      linkedPlayerIds: Array.from(new Set([...current.linkedPlayerIds, playerId])),
    }));
    setProfileStatus("idle");
    setProfileMessage("");
    setLinkQuery("");
    setLinkCandidateIndex(-1);
    setLinkEditorOpen(false);
    setSourceMode("visitor");
    setJoinOpen(true);
  };

  const prepareVisitorLink = (playerIndex: number) => {
    setJoinOpen(true);
    setLinkEditorOpen(true);
    setLinkCandidateIndex(playerIndex);
    setLinkQuery(graph?.players[playerIndex].shortName ?? "");
    if (visitor.name.trim()) addVisitorLink(playerIndex);
  };

  const removeVisitorLink = (playerId: number) => {
    setVisitor((current) => ({
      ...current,
      linkedPlayerIds: current.linkedPlayerIds.filter((id) => id !== playerId),
    }));
    setProfileStatus("idle");
    setProfileMessage("");
  };

  const saveVisitorProfile = async () => {
    if (!visitor.name.trim() || visitor.linkedPlayerIds.length === 0) return;
    setProfileStatus("saving");
    setProfileMessage("");

    try {
      const updating = Boolean(visitor.id && visitor.editToken);
      const submit = (method: "POST" | "PUT") => fetch("/api/people", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(method === "PUT" ? { id: visitor.id, editToken: visitor.editToken } : {}),
          displayName: visitor.name,
          playerIds: visitor.linkedPlayerIds,
        }),
      });

      let response = await submit(updating ? "PUT" : "POST");
      if (updating && (response.status === 401 || response.status === 403)) {
        response = await submit("POST");
      }
      const payload = (await response.json()) as {
        person?: PublicPerson;
        editToken?: string;
        error?: string;
      };
      if (!response.ok || !payload.person) {
        throw new Error(payload.error || "Your profile could not be saved.");
      }

      setVisitor((current) => ({
        id: payload.person?.id,
        slug: payload.person?.slug,
        editToken: payload.editToken || current.editToken,
        name: payload.person?.displayName || current.name,
        linkedPlayerIds: payload.person?.playerIds || current.linkedPlayerIds,
      }));
      setProfileStatus("saved");
      setProfileMessage("Saved — other people can now find and route from you.");
    } catch (error) {
      setProfileStatus("error");
      setProfileMessage(
        error instanceof Error ? error.message : "Your profile could not be saved.",
      );
    }
  };

  const swapPlayers = () => {
    if (!graph || sourceMode !== "player") return;
    setSourceIndex(targetIndex);
    setTargetIndex(sourceIndex);
    setSourceQuery(graph.players[targetIndex].shortName);
    setTargetQuery(graph.players[sourceIndex].shortName);
  };

  const traceRoute = () => {
    setRoutePulse((value) => value + 1);
    document.getElementById("network-map")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  const linkedPlayerIds = new Set(visitor.linkedPlayerIds);

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="The Pass home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>THE PASS</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#explorer">Explorer</a>
          <a href="#reach">Player reach</a>
          <a href="#method">How it works</a>
        </nav>
        <button
          type="button"
          className="header-join"
          onClick={() => {
            setJoinOpen(true);
            document.getElementById("join-card")?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          {visitor.linkedPlayerIds.length > 0 ? `${visitor.name} is in` : "Join the network"}
          <span aria-hidden="true">↗</span>
        </button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">
            <span /> FIFA 15—EA FC 26 · THE FOOTBALL CONNECTION GRAPH
          </p>
          <h1>
            Every player is
            <br />
            <em>closer than you think.</em>
          </h1>
          <p className="hero-lede">
            Pick any two footballers. We&apos;ll trace the shortest chain of
            teammates connecting them—club by club, country by country.
          </p>
          <a className="hero-how-link" href="#method">
            How it works &amp; data sources <span aria-hidden="true">↓</span>
          </a>
        </div>
        <div className="hero-stat" aria-label="Key finding from the original analysis">
          <span className="stat-kicker">THE BIG FINDING</span>
          <strong>99.26%</strong>
          <p>of FIFA 21 players belonged to one connected football universe.</p>
          <span className="stat-source">Original FIFA 21 finding · Andrew Yu</span>
        </div>
      </section>

      <section className="explorer-shell" id="explorer">
        <aside className="control-panel">
          <div className="panel-heading">
            <div>
              <span className="section-number">01</span>
              <h2>Trace a connection</h2>
            </div>
            <span className="live-pill"><i /> LIVE GRAPH</span>
          </div>

          {!graph && !loadError && <div className="control-loading">Loading player index…</div>}

          {loadError && (
            <div className="load-error" role="alert">
              <strong>We lost the ball.</strong>
              <span>{loadError}</span>
            </div>
          )}

          {graph && (
            <>
              {sourceMode !== "player" ? (
                <div className="visitor-source">
                  <span className="visitor-avatar" aria-hidden="true">
                    {getInitials(sourcePersonName)}
                  </span>
                  <span>
                    <small>STARTING FROM</small>
                    <strong>{sourcePersonName}</strong>
                    <em>
                      {sourceLinkedIndexes.length} direct player link
                      {sourceLinkedIndexes.length === 1 ? "" : "s"}
                    </em>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSourceMode("player");
                      setSourcePickerMode("player");
                    }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="source-selector">
                  <div className="source-mode-tabs" aria-label="Choose who to start from">
                    <button
                      type="button"
                      className={sourcePickerMode === "player" ? "active" : ""}
                      aria-pressed={sourcePickerMode === "player"}
                      onClick={() => setSourcePickerMode("player")}
                    >
                      Player
                    </button>
                    <button
                      type="button"
                      className={sourcePickerMode === "person" ? "active" : ""}
                      aria-pressed={sourcePickerMode === "person"}
                      onClick={() => setSourcePickerMode("person")}
                    >
                      Community profiles
                    </button>
                  </div>

                  {sourcePickerMode === "player" ? (
                    <PlayerPicker
                      id="source-player"
                      label="FROM"
                      graph={graph}
                      selectedIndex={sourceIndex}
                      query={sourceQuery}
                      onQueryChange={setSourceQuery}
                      onSelect={setSourceIndex}
                      placeholder="Search a player"
                    />
                  ) : (
                    <PeoplePicker
                      graph={graph}
                      label="FROM A COMMUNITY PROFILE"
                      onSelect={(person) => {
                        setCommunityPerson(person);
                        setSourceMode("community");
                      }}
                    />
                  )}
                </div>
              )}

              <div className="swap-row" aria-hidden="true">
                <span />
                <button
                  type="button"
                  onClick={swapPlayers}
                  disabled={sourceMode !== "player"}
                  aria-label="Swap players"
                  title="Swap players"
                >
                  ⇅
                </button>
                <span />
              </div>

              <PlayerPicker
                id="target-player"
                label="TO"
                graph={graph}
                selectedIndex={targetIndex}
                query={targetQuery}
                onQueryChange={setTargetQuery}
                onSelect={setTargetIndex}
                placeholder="Search a player"
              />

              <button type="button" className="trace-button" onClick={traceRoute}>
                TRACE THE LINK <span aria-hidden="true">→</span>
              </button>

              <div className="route-summary" aria-live="polite">
                <span>SHORTEST ROUTE</span>
                {route ? (
                  <strong>
                    {degreeCount} degree{degreeCount === 1 ? "" : "s"} apart
                  </strong>
                ) : (
                  <strong>
                    {sourceMode !== "player" && sourceLinkedIndexes.length === 0
                      ? "Add your first link"
                      : "No route found"}
                  </strong>
                )}
              </div>
            </>
          )}

          <div className={`join-card ${joinOpen ? "is-open" : ""}`} id="join-card">
            <button
              type="button"
              className="join-card-toggle"
              onClick={() => {
                setJoinOpen((open) => {
                  if (open) setLinkEditorOpen(false);
                  return !open;
                });
              }}
              aria-expanded={joinOpen}
            >
              <span className="join-plus" aria-hidden="true">+</span>
              <span>
                <strong>Put yourself on the map</strong>
                <small>Connect to anyone you&apos;ve met</small>
              </span>
              <span className="join-chevron" aria-hidden="true">⌄</span>
            </button>

            {joinOpen && graph && (
              <div className="join-form">
                <label htmlFor="visitor-name">YOUR NAME</label>
                <input
                  id="visitor-name"
                  className="name-input"
                  value={visitor.name}
                  onChange={(event) => {
                    setVisitor((current) => ({ ...current, name: event.target.value }));
                    setProfileStatus("idle");
                    setProfileMessage("");
                  }}
                  placeholder="e.g. Andrew"
                />

                {(linkedIndexes.length === 0 || linkEditorOpen) && (
                  <div className="link-editor">
                    <PlayerPicker
                      id="linked-player"
                      label="PLAYER YOU KNOW"
                      graph={graph}
                      selectedIndex={linkCandidateIndex}
                      query={linkQuery}
                      onQueryChange={setLinkQuery}
                      onSelect={setLinkCandidateIndex}
                      placeholder="Search names without accents"
                    />

                    <button
                      type="button"
                      className="add-link-button"
                      onClick={() => addVisitorLink()}
                      disabled={
                        !visitor.name.trim() ||
                        linkCandidateIndex < 0 ||
                        visitor.linkedPlayerIds.length >= 12
                      }
                    >
                      ADD MY CONNECTION
                    </button>
                  </div>
                )}

                {linkedIndexes.length > 0 && (
                  <>
                    <div className="linked-list">
                      <span>YOUR DIRECT LINKS · {linkedIndexes.length}/12</span>
                      {linkedIndexes.map((index) => {
                        const player = graph.players[index];
                        return (
                          <button
                            type="button"
                            key={player.id}
                            onClick={() => removeVisitorLink(player.id)}
                            title={`Remove ${player.shortName}`}
                          >
                            {player.shortName} <span aria-hidden="true">×</span>
                          </button>
                        );
                      })}
                    </div>
                    {linkedIndexes.length < 12 && !linkEditorOpen && (
                      <button
                        type="button"
                        className="add-another-link"
                        onClick={() => {
                          setLinkQuery("");
                          setLinkCandidateIndex(-1);
                          setLinkEditorOpen(true);
                        }}
                      >
                        + CONNECT ANOTHER PLAYER
                      </button>
                    )}
                    <button
                      type="button"
                      className="save-profile-button"
                      onClick={saveVisitorProfile}
                      disabled={profileStatus === "saving"}
                    >
                      {profileStatus === "saving"
                        ? "SAVING…"
                        : visitor.id
                          ? "UPDATE SHARED PROFILE"
                          : "SAVE TO COMMUNITY"}
                    </button>
                    {profileMessage && (
                      <p className={`profile-message ${profileStatus}`} role="status">
                        {profileMessage}
                      </p>
                    )}
                    {visitor.id && (
                      <p className="profile-owner-note">
                        This updates {visitor.name}. A different person should create
                        their own profile on their device.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </aside>

        <div className="network-panel" id="network-map">
          <div className="pitch-lines" aria-hidden="true">
            <span className="halfway" />
            <span className="center-circle" />
            <span className="left-box" />
            <span className="right-box" />
          </div>

          <div className="network-toolbar">
            <div>
              <span className="section-number light">02</span>
              <h2>The shortest path</h2>
            </div>
            {graph && (
              <div className="network-meta">
                <div className="network-stats">
                  <span><strong>{formatNumber(graph.meta.playerCount)}</strong> players</span>
                  <span><strong>{graph.meta.years.length}</strong> editions</span>
                </div>
                {route && (
                  <div className="path-resize">
                    <label htmlFor="path-size">PATH SIZE</label>
                    <input
                      id="path-size"
                      type="range"
                      min="10"
                      max="125"
                      value={Math.round(pathScale * 100)}
                      onChange={(event) => setPathScale(Number(event.target.value) / 100)}
                    />
                    <button type="button" onClick={() => setFitRevision((value) => value + 1)}>
                      FIT
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {!graph && !loadError && <LoadingMap />}

          {graph && route && (
            <div
              className="path-scroll"
              key={`${sourceMode}-${sourceIndex}-${targetIndex}-${routePulse}`}
              ref={pathViewportRef}
            >
              <div
                className="path-scale-shell"
                style={{
                  height: pathSize.height ? pathSize.height * pathScale : undefined,
                  width: pathSize.width ? pathSize.width * pathScale : undefined,
                }}
              >
              <div
                className="path-track"
                ref={pathTrackRef}
                style={{ transform: `scale(${pathScale})` }}
              >
                {route.fromPerson && (
                  <>
                    <article className="player-node visitor-node">
                      <span className="node-degree">
                        {sourceMode === "visitor" ? "YOU" : "PERSON"}
                      </span>
                      <div className="node-avatar">{getInitials(sourcePersonName)}</div>
                      <div className="node-copy">
                        <strong>{sourcePersonName}</strong>
                        <small>
                          {sourceMode === "visitor" ? "Your profile" : "Community profile"}
                        </small>
                      </div>
                    </article>
                    <div className="connection personal-connection">
                      <span className="connection-line"><i /></span>
                      <div className="connection-label">
                        <strong>PERSONAL LINK</strong>
                        <small>Knows this player</small>
                      </div>
                    </div>
                  </>
                )}

                {route.players.map((playerIndex, step) => {
                  const player = graph.players[playerIndex];
                  const isLinked = linkedPlayerIds.has(player.id);
                  const connection = step < route.eventIds.length
                    ? graph.events[route.eventIds[step]]
                    : null;
                  const number = step + (route.fromPerson ? 1 : 0);

                  return (
                    <div className="path-segment" key={`${player.id}-${step}`}>
                      <article className="player-node">
                        <span className="node-degree">
                          {number === 0 ? "START" : `DEGREE ${number}`}
                        </span>
                        <div className="node-avatar">{getInitials(player.shortName)}</div>
                        <div className="node-copy">
                          <strong>{player.shortName}</strong>
                          <small>{player.position} · {player.nationality}</small>
                          <em>{player.club || formatEdition(player.lastYear)}</em>
                        </div>
                        <button
                          type="button"
                          className={`node-link-me ${isLinked ? "is-linked" : ""}`}
                          onClick={() => !isLinked && prepareVisitorLink(playerIndex)}
                          disabled={isLinked}
                        >
                          {isLinked ? "Linked to you" : "+ Link me"}
                        </button>
                      </article>

                      {connection && (
                        <div className="connection">
                          <span className="connection-line"><i /></span>
                          <div className="connection-label">
                            <strong>
                              {connection.kind === "club" ? "CLUBMATES" : "NATIONAL TEAM"}
                            </strong>
                            <small>
                              {connection.sourceUrl ? (
                                <a
                                  href={connection.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {connection.label || `${connection.name} · ${formatEdition(connection.fifaYear)}`}
                                </a>
                              ) : (
                                `${connection.name} · ${formatEdition(connection.fifaYear)}`
                              )}
                            </small>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              </div>
            </div>
          )}

          {graph && !route && (
            <div className="empty-map">
              <span aria-hidden="true">?</span>
              <strong>
                {sourceMode !== "player" && sourceLinkedIndexes.length === 0
                  ? "This person needs a way into the network"
                  : "These players sit in different networks"}
              </strong>
              <p>
                {sourceMode !== "player" && sourceLinkedIndexes.length === 0
                  ? "Add a direct player connection, then we’ll carry the route to the target."
                  : "Try another pairing or add a personal connection to bridge the gap."}
              </p>
            </div>
          )}

          <div className="map-legend">
            <span><i className="legend-club" /> Club connection</span>
            <span><i className="legend-nation" /> National team</span>
            <span><i className="legend-personal" /> Your connection</span>
          </div>
        </div>
      </section>

      <section className="reach" id="reach">
        <div className="reach-heading">
          <div>
            <p className="eyebrow"><span /> PLAYER REACH</p>
            <h2>How far does one<br /><em>name travel?</em></h2>
          </div>
          <p>
            Choose a player or community profile to see how much of the football
            universe sits exactly one, two, three—up to six—links away.
          </p>
        </div>

        {graph && statsPlayerIndex >= 0 ? (
          <div className="reach-dashboard">
            <aside className="reach-profile">
              <span className="section-number">03 · SELECT A STARTING POINT</span>
              <div className="reach-source-tabs" aria-label="Choose reach source type">
                <button
                  type="button"
                  className={statsMode === "player" ? "active" : ""}
                  aria-pressed={statsMode === "player"}
                  onClick={() => setStatsMode("player")}
                >
                  Player
                </button>
                <button
                  type="button"
                  className={statsMode === "community" ? "active" : ""}
                  aria-pressed={statsMode === "community"}
                  onClick={() => setStatsMode("community")}
                >
                  Community profile
                </button>
              </div>

              {statsMode === "player" ? (
                <PlayerPicker
                  id="stats-player"
                  label="PLAYER"
                  graph={graph}
                  selectedIndex={statsPlayerIndex}
                  query={statsQuery}
                  onQueryChange={setStatsQuery}
                  onSelect={setStatsPlayerIndex}
                  placeholder="Search a player"
                />
              ) : (
                <PeoplePicker
                  id="stats-community-person"
                  graph={graph}
                  label="COMMUNITY PROFILE"
                  onSelect={setStatsCommunityPerson}
                />
              )}

              <div className="reach-player-card">
                <div className="reach-player-avatar">
                  {getInitials(statsSourceName)}
                </div>
                <div>
                  <strong>{statsSourceName}</strong>
                  {statsMode === "community" && statsCommunityPerson ? (
                    <>
                      <span className="community-profile-label">COMMUNITY PROFILE</span>
                      <small>
                        {statsCommunityIndexes.length} direct player connection
                        {statsCommunityIndexes.length === 1 ? "" : "s"}
                      </small>
                    </>
                  ) : statsMode === "player" ? (
                    <>
                      <span>
                        {graph.players[statsPlayerIndex].position} · {graph.players[statsPlayerIndex].nationality}
                      </span>
                      <small>
                        {graph.players[statsPlayerIndex].club || formatEdition(graph.players[statsPlayerIndex].lastYear)}
                      </small>
                    </>
                  ) : (
                    <span className="community-profile-label">SELECT A COMMUNITY PROFILE</span>
                  )}
                </div>
              </div>

              {distanceStats ? (
                <div className="reach-total">
                  <span>WITHIN SIX DEGREES</span>
                  <strong>{formatNumber(distanceStats.reachedWithinSix)}</strong>
                  <em>{formatPercentage(distanceStats.reachedPercentage)} of all players</em>
                </div>
              ) : (
                <div className="reach-select-prompt">Search and select a shared profile to calculate its reach.</div>
              )}

              <p className="reach-note">
                Percentages use all {formatNumber(graph.meta.playerCount)} players as the universe.
                {statsMode === "community"
                  ? " Direct connections begin at degree 1."
                  : " The selected player is degree 0 and is not included below."}
              </p>
            </aside>

            <div className={`reach-chart-panel ${distanceStats ? "" : "is-empty"}`}>
              {distanceStats ? (
                <>
              <div className="reach-chart-header">
                <span>
                  EXACT DISTANCE FROM {statsSourceName.toLocaleUpperCase()}
                  {statsMode === "community" && " · COMMUNITY PROFILE"}
                </span>
                <span>PLAYERS · % OF UNIVERSE</span>
              </div>
              <ol className="degree-chart">
                {distanceStats.buckets.map((bucket) => (
                  <li key={bucket.degree}>
                    <div className="degree-label">
                      <strong>{bucket.degree}</strong>
                      <span>degree{bucket.degree === 1 ? "" : "s"}</span>
                    </div>
                    <div className="degree-meter">
                      <i
                        style={{
                          width: `${Math.max(bucket.percentage, bucket.count > 0 ? 0.4 : 0)}%`,
                        }}
                      />
                    </div>
                    <div className="degree-value">
                      <strong>{formatNumber(bucket.count)}</strong>
                      <span>{formatPercentage(bucket.percentage)}</span>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="outside-six">
                <span>Outside six degrees or disconnected</span>
                <strong>{formatNumber(distanceStats.outsideSix)}</strong>
                <em>
                  {formatPercentage((distanceStats.outsideSix / graph.meta.playerCount) * 100)}
                </em>
              </div>
                </>
              ) : (
                <div className="reach-empty-chart">
                  <span aria-hidden="true">⌕</span>
                  <strong>Select a community profile</strong>
                  <p>We’ll measure the football universe from all of its direct player links.</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="reach-loading" role="status">Calculating player reach…</div>
        )}
      </section>

      <section className="method" id="method">
        <div className="method-heading">
          <p className="eyebrow"><span /> THE RULES OF THE GRAPH</p>
          <h2>One shared dressing room<br />is all it takes.</h2>
          <p>
            Choose a FROM and TO player, then trace the link. The original
            notebook&apos;s breadth-first search checks the graph and explains every hop.
          </p>
        </div>

        <div className="method-content">
          <div className="method-grid">
            <article>
              <span>01</span>
              <div className="method-icon club-icon" aria-hidden="true"><i /><i /></div>
              <h3>Club teammates</h3>
              <p>Two players connect when they appeared for the same club in the same FIFA edition.</p>
            </article>
            <article>
              <span>02</span>
              <div className="method-icon nation-icon" aria-hidden="true">★</div>
              <h3>National squads</h3>
              <p>Called-up internationals connect by year, including sourced Philippine squad cohorts.</p>
            </article>
            <article>
              <span>03</span>
              <div className="method-icon route-icon" aria-hidden="true"><i /><i /><i /></div>
              <h3>Breadth-first search</h3>
              <p>BFS explores the graph layer by layer and returns the valid route with the fewest hops.</p>
            </article>
            <article>
              <span>04</span>
              <div className="method-icon data-icon" aria-hidden="true">15—26</div>
              <h3>Public data</h3>
              <p>Kaggle player datasets cover FIFA 15 through EA FC 26, supplemented by sourced squad records.</p>
            </article>
            <article>
              <span>05</span>
              <div className="method-icon community-icon" aria-hidden="true">YOU</div>
              <h3>Add yourself or a friend to the graph</h3>
              <p>Open Put yourself on the map, add a name and one or more known players, then save the profile to the community.</p>
            </article>
          </div>
          <a className="method-cta" href="#explorer">
            Find a connection <span aria-hidden="true">↑</span>
          </a>
        </div>
      </section>

      <footer>
        <a className="brand footer-brand" href="#top">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>THE PASS</span>
        </a>
        <p>An interactive continuation of Andrew Yu&apos;s Six Degrees of FIFA analysis.</p>
        <div>
          <a
            href="https://www.kaggle.com/code/andnyu/six-degrees-of-fifa-15-21-separation"
            target="_blank"
            rel="noreferrer"
          >
            Original notebook ↗
          </a>
          <a
            href="https://www.kaggle.com/datasets/rovnez/fc-26-fifa-26-player-data"
            target="_blank"
            rel="noreferrer"
          >
            Current dataset ↗
          </a>
        </div>
      </footer>
    </main>
  );
}
