# Wardrobe integration

The Worker resolves the Google provider subject from the authenticated session to the numeric users.id. API callers supply a session cookie. Each query and private file operation uses the resolved account ID.

GET /api/wardrobe/items returns {"items":[...]} with numeric id, name, category, color, imageFileId and imageUrl. Items belong to this account, have confirmed_at set and archived_at null. Category values are top, bottom, dress, shoes, outerwear, accessory and other. Use the returned imageUrl for authenticated image requests. Treat imageFileId as opaque. Uploaded drafts appear at GET /api/wardrobe/items?status=draft until confirmed.

An upload batch returns one entry per photo. Each successful entry's `extraction.items` lists the detected garments in review order. Each garment has its own ID, private image and editable details. The original single-item fields remain available. When extraction needs manual review, the entry's `id` identifies the original photo draft.

GET /api/wardrobe/items/{id}/delete-impact returns `{"savedLooks":[...]}` with the ID and title of each saved look that uses the item. An unused item returns an empty list. An unknown item or one belonging to another account returns HTTP 404.

After the user confirms deletion, send DELETE /api/wardrobe/items/{id} with `{"savedLookIds":[...]}`. Send `{"savedLookIds":[]}` for an unused item. The API checks that the list still matches, then removes the item and those looks together. A bodyless DELETE or a changed list returns HTTP 409 with `code: "saved_looks_affected"` and the current `savedLooks` list for confirmation. PATCH with `{"archive":true}` keeps the saved looks when removing an item from the closet.

When a user swaps shoes, save the selected shoe ID, slot and item name in saved_look_items alongside the other final slots. On reopen, read the saved slots and resolve those garments' private image references, including archived items owned by the account. The source outfit_option_items retain the original shoe ID.
