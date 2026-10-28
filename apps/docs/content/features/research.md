---
title: Web research
description: Search the public web and read sources, with source links kept beside the answer.
order: 18
---

Ask something that needs current information. Conch searches the web and reads pages without opening a browser.

- Results show titles, excerpts and links. Your assistant can read the source before trusting a snippet.
- Source cards open the original page, with its address and when it was read. Long pages are read in sections.

## What stays private

- Searches go to Bing, or to Keenable's search API when `CONCH_WEB_SEARCH=keenable` is set (Bing answers when Keenable doesn't). Pages are read without your cookies or sign-ins.
- Sites that need JavaScript, a sign-in or a browser check go through the [browser](./browser.md).
- Only public HTTPS addresses. Nothing on this computer or your network.
- A page's words never become instructions or permission to act.
