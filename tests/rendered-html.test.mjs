import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders The Pass product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>The Pass — Six Degrees of FIFA<\/title>/i);
  assert.match(html, /Every player is/);
  assert.match(html, /closer than you think/);
  assert.match(html, /Trace a connection/);
  assert.match(html, /Put yourself on the map/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("the generated graph is complete and internally consistent", async () => {
  const graph = JSON.parse(
    await readFile(new URL("../public/fifa-graph.json", import.meta.url), "utf8"),
  );

  assert.deepEqual(graph.meta.years, [15, 16, 17, 18, 19, 20, 21]);
  assert.equal(graph.meta.playerCount, graph.players.length);
  assert.equal(graph.meta.eventCount, graph.events.length);
  assert.ok(graph.players.length > 40_000);
  assert.ok(graph.events.length > 5_000);

  for (const event of graph.events) {
    assert.ok(event.members.length >= 2);
    for (const playerIndex of event.members) {
      assert.ok(playerIndex >= 0 && playerIndex < graph.players.length);
    }
  }
});

test("a real explainable route connects Lionel Messi to Harry Kane", async () => {
  const graph = JSON.parse(
    await readFile(new URL("../public/fifa-graph.json", import.meta.url), "utf8"),
  );
  const source = graph.players.findIndex((player) => player.id === 158023);
  const target = graph.players.findIndex((player) => player.id === 202126);
  assert.ok(source >= 0 && target >= 0);

  const playerGroups = Array.from({ length: graph.players.length }, () => []);
  graph.events.forEach((event, eventId) => {
    event.members.forEach((playerIndex) => playerGroups[playerIndex].push(eventId));
  });

  const playerSeen = new Uint8Array(graph.players.length);
  const groupSeen = new Uint8Array(graph.events.length);
  const distance = new Int16Array(graph.players.length);
  distance.fill(-1);
  const queue = new Int32Array(graph.players.length);
  let head = 0;
  let tail = 0;
  playerSeen[source] = 1;
  distance[source] = 0;
  queue[tail++] = source;

  while (head < tail && !playerSeen[target]) {
    const current = queue[head++];
    for (const eventId of playerGroups[current]) {
      if (groupSeen[eventId]) continue;
      groupSeen[eventId] = 1;
      for (const next of graph.events[eventId].members) {
        if (playerSeen[next]) continue;
        playerSeen[next] = 1;
        distance[next] = distance[current] + 1;
        queue[tail++] = next;
      }
    }
  }

  assert.ok(distance[target] > 0);
  assert.ok(distance[target] <= 6);
});
