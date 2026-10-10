# Building with a team of AI agents

From the third day, Tally was built by **one human chief engineer directing a team of AI coding agents**, with an orchestrator agent keeping the plan, reviewing every change and protecting scope. This page describes the workflow because it is part of how the product ended up the way it did.

{% hint style="info" %}
This page is about the *software*. The hackathon's Developer Experience Report is written by the chief engineer in their own words and is not part of these docs.
{% endhint %}

## Roles

| Role | Does | Never does |
|---|---|---|
| **Chief engineer (human)** | Owns every key, every deployment and every transaction. Reviews after the orchestrator and merges. Final say. | Delegates keys or merges. |
| **Orchestrator (an AI)** | Keeps work orders and the calendar. Reviews each pull request against its work order. Approves small additive scope. Writes the review notes. | Sends transactions, deploys or merges. |
| **Implementation agents** | Each builds one work order on its own branch: logic, tests and a plain view model. | Touch secrets, send transactions, edit files they do not own. |
| **UI agent** | Builds the pages from view models and fixtures, in a cloud session with no secrets. | Call the engine or change trading logic. |

## Work orders and ownership

Every unit of work is a **work order**: a goal, an `Owns` list of the exact paths the agent may touch, tasks, exit checks and an out-of-scope list. Anything outside `Owns` needs an approval written into the work order by the orchestrator. A script checks every pull request's changed files against the list.

## The review pack

A script runs the same checks for every branch: install with a frozen lockfile, typecheck, lint, format, unit tests, build, end-to-end tests at three widths, and the owned-path check. The output goes to a review folder. Reviews were written from the pack and the diff, never from the author's summary. In practice, "the tests pass" in a report was wrong a few times, and the pack caught it.

## Hard rules

* No secrets, keys, seed phrases or RPC URLs in code, logs, prompts or fixtures.
* Nobody but the chief engineer sends transactions, deploys or merges.
* Recorded evidence and fixtures are never edited.
* ShareGuard and the buy path are not changed without the chief engineer's explicit approval.
* Shares are `bigint`, never 1:1 by default, and fixture data is never labelled live.
* New branches only when named.

## What worked

* **Ownership lists** prevented almost all conflicts between agents.
* **Plain view models** let the UI agent work in parallel from fixtures.
* **Recorded responses** let cloud agents, which run in a country the API refuses, build and test the whole engine offline.
* **Reviews that read the diff** caught what green tests did not: a deleted guard, a lost rounding step, a mock that did not match the real SDK, a receipt that claimed a sale had not been simulated when it had.

## What did not

* Several agents running full test packs on one machine made end-to-end tests fail on timing. Packs now run one at a time.
* A build that downloaded fonts from Google at build time failed when the network hiccupped. The fonts are bundled now.
* Agents sometimes approved their own scope in a work order. Only the orchestrator writes approvals.
