# Wardrobe extraction checks

Run `node --test worker/wardrobe/extraction.test.mjs` from the repository root with Node 24.

To test the fixture path in an isolated Site environment, set `WARDROBE_EXTRACTION_FIXTURES=1` and upload one of these four PNGs without re-encoding it. The Worker checks the exact file digest and reports `source: "fixture"` for matching uploads. The synthetic shirt, bag, sneakers, and jeans images fit the fixture silhouettes and exercise transparent pixel output, including disconnected shoes and the open bag handle.

Live extraction needs `OPENAI_API_KEY` as a Sites runtime secret for a project with GPT-6 Luna and Fast processing access. The Sites connector reported the Closet project accessible through its metadata tool and returned `project_not_found` for its runtime environment lookup. The tests exercise the documented request and cutout rendering against a mocked API response. Live access, latency, and outline quality still need a credentialed test. [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) · [Fast mode](https://developers.openai.com/api/docs/guides/fast-mode)

Live extraction sends a resized copy of the uploaded photo to the Responses API with `store: false`. Luna identifies the item and returns text metadata and normalized polygon coordinates. The Worker applies the returned shape to the photo pixels and stores the resulting PNG in the authenticated account’s private storage. The Worker supports JPEG and non-interlaced, 8-bit or 16-bit grayscale and true-color PNGs subject to upload and decode size limits. The manual review flow can still use uploads if extraction is unavailable or the photo encoding is unsupported.
