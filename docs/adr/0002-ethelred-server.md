---
status: accepted
---

# Ethelred gets a server, and the app stays offline-first without it

Until now the app had no backend. `CLAUDE.md` said that a server buys only
cross-device sync, and that sync was deferred. Issue #45 adds Ethelred, a
travel agent that answers questions in plain language from the site data. A
language model answers those questions, and a language model needs a server.
We change the rule: the app can have one server, for Ethelred only.

## Why the server runs the agent loop

Three shapes were possible. The browser can call the model direct with a key
from each user. A server can relay each model turn and let the browser run the
tools. Or a server can run the whole loop and the tools. We picked the third.

A key for each user limits Ethelred to technical users, and Ethelred is for
every user. A relay costs one round trip for each tool call. One question can
need four to six tool calls, and the target use is weak rural signal. With the
loop on the server, one question is one request. The model can take as many
turns as it needs, and the phone waits on one connection.

The server holds its own copy of `sites.json`, `places.json` and the semantic
index. All three come from the same build as the app. The geometry code is
dependency-free TypeScript, so the server uses the same corridor as the map.
"On the way" means one thing in both places.

## What the server does not own

User state stays on the device. Each question carries a snapshot of the
visited, wishlist and hidden ids. The server uses the snapshot for that one
answer and does not keep it. The conversation also stays on the device, and
the app sends it again with each question. The server keeps only counters for
the daily budget, and the reports that users choose to send.

The rest of the app does not depend on the server. The mental test in
`CLAUDE.md` still holds: after one online session, a region works in airplane
mode. With no signal, or with the daily budget spent, the Ethelred button is
not shown. Nothing else changes. This is the rule of the location search in
issue #28: a lost signal changes what the app offers, never whether it works.

## Considered options

A model on the device (WebLLM or similar) keeps the app offline. The download
is several gigabytes, and small models are weak at tool calls. The bundle rule
in `CLAUDE.md` rejects it.

An MCP server or a Claude skill keeps the app free of a server. But an answer
from outside the app cannot show its sites on the map or set a journey.

## Consequences

The server is a public endpoint on a paid model, open to anonymous users. The
server caps questions for each device and each IP address. A global daily
budget is the real limit, because a user can reset a device id with no effort.

The model is behind one OpenAI-compatible adapter. Development uses vLLM on a
laptop GPU, and production uses Azure OpenAI. A change of model is a change of
configuration, and the eval set measures the result.

The server does not open the question of sync. Sync needs user state on the
server, and this server keeps none. That decision stays deferred.
