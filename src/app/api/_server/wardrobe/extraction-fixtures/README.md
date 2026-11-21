# Wardrobe extraction checks

Run `node --test src/app/api/_server/wardrobe/extraction.test.mjs` from the repository root with Node 24.

To test the fixture path in an isolated Site environment, set `WARDROBE_EXTRACTION_FIXTURES=1` and upload one of these four PNGs without re-encoding it. The Worker checks the exact file digest and reports `source: "fixture"` for matching uploads. The synthetic shirt, bag, sneakers, and jeans images fit the fixture silhouettes and exercise transparent pixel output, including disconnected shoes and the open bag handle.

Live extraction needs `OPENAI_API_KEY` as a Sites runtime secret for a project with GPT-6 Luna and Fast processing access. The Sites connector reported the Closet project accessible through its metadata tool and returned `project_not_found` for its runtime environment lookup. The tests exercise the documented request and cutout rendering against a mocked API response. Live access, latency, and outline quality still need a credentialed test. [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) · [Fast mode](https://developers.openai.com/api/docs/guides/fast-mode)

Live extraction sends normalized photos to the Responses API with `store: false`. The response supplies metadata for each visible wardrobe item and a transparent image. For a full outfit, the Worker splits the image into individual cutouts and stores them as separate private drafts. The original photo remains available for manual review if extraction fails.
