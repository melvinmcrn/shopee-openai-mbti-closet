"""Run after npm run build with Python Playwright and Chromium installed.

Set PLANNER_CHROMIUM to a local browser executable to use system Chromium.
Optionally pass the path to the static export (defaults to out).
"""

import csv
import os
import re
from pathlib import Path
import subprocess
import sys
from uuid import uuid4
from urllib.parse import parse_qs, unquote, urljoin, urlparse

from playwright.sync_api import expect, sync_playwright


OCCASION = "Anniversary dinner"
WEAR_DATE = "2025-03-08"
NOTE = "The flats were comfortable all evening."


def mobile_session(browser, device, base, session):
    context = browser.new_context(**device, locale="en-US", timezone_id="UTC")
    context.add_cookies(
        [{"name": "planner-fixture", "value": session, "url": base, "httpOnly": True}]
    )
    page = context.new_page()
    page.set_default_timeout(7000)
    return context, page


def expect_heading(page, name):
    expect(page.get_by_role("heading", name=name, level=1, exact=True)).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth === window.innerWidth"), (
        f'The "{name}" screen overflows the mobile viewport'
    )


def expect_navigation(page, active_tab=None):
    header = page.get_by_role("banner")
    expect(header).to_have_count(1)
    expect(page.locator("header img[src='/closet-logo.svg']")).to_have_count(1)
    expect(header.get_by_role("link").locator("img[src='/closet-logo.svg']")).to_be_visible()
    for name in ("Saved", "Account"):
        expect(page.locator("header").get_by_role("link", name=name, exact=True)).to_have_count(0)
    expect(page.get_by_role("contentinfo")).to_have_count(1)
    footer = page.get_by_role("navigation", name="Main navigation")
    expect(footer).to_have_count(1)
    for name in ("Home", "Wardrobe", "Saved", "Profile"):
        expect(footer.get_by_role("link", name=name, exact=True)).to_be_visible()
    if active_tab:
        expect(footer.locator('[aria-current="page"]')).to_have_count(1)
        expect(footer.get_by_role("link", name=active_tab, exact=True)).to_have_attribute("aria-current", "page")
    return footer


def open_saved(page, base):
    page.goto(f"{base}/planner/")
    expect_heading(page, "Outfit planner")
    footer = expect_navigation(page, "Home")
    saved = footer.get_by_role("link", name="Saved", exact=True)
    saved.tap()
    expect_heading(page, "Saved looks")
    expect(saved).to_have_attribute("aria-current", "page")
    expect(page.get_by_text("Walking flats", exact=True)).to_be_visible()
    expect(page.get_by_text("Leather heels", exact=True)).to_have_count(0)
    page.get_by_role("button", name=f"Open saved look for {OCCASION}").tap()
    expect_heading(page, OCCASION)
    expect_navigation(page, "Saved")
    expect(page.get_by_text("Walking flats", exact=True)).to_be_visible()
    expect(page.get_by_text("Leather heels", exact=True)).to_have_count(0)
    flats_photo = page.get_by_role("listitem").filter(has_text="Walking flats").locator("img")
    flats_photo.scroll_into_view_if_needed()
    expect(flats_photo).to_have_js_property("naturalWidth", 1)


def check_shared_navigation(browser, device, base):
    context, page = mobile_session(browser, device, base, "returning-session")
    page.goto(f"{base}/planner/")
    expect_heading(page, "Outfit planner")
    footer = expect_navigation(page, "Home")
    initial_header = page.get_by_role("banner").element_handle()
    initial_footer = page.get_by_role("contentinfo").element_handle()

    footer.get_by_role("link", name="Wardrobe").tap()
    expect_heading(page, "Closet")
    expect_navigation(page, "Wardrobe")
    page.get_by_role("link", name="Add items").tap()
    expect_heading(page, "Add wardrobe photos")
    expect_navigation(page, "Wardrobe")

    footer.get_by_role("link", name="Profile").tap()
    expect_heading(page, "Account")
    expect_navigation(page, "Profile")
    expect(page.get_by_role("heading", name="Private profile picture")).to_be_visible()
    page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
    assert page.evaluate("window.scrollY > 0")
    expect(page.get_by_role("banner")).to_be_in_viewport(ratio=1)
    expect(footer).to_be_in_viewport(ratio=1)
    page.get_by_role("link", name="Back to planner setup").tap()
    expect_heading(page, "Review your setup")
    expect_navigation(page, "Profile")
    footer.get_by_role("link", name="Saved").tap()
    expect_heading(page, "Saved looks")
    expect_navigation(page, "Saved")
    assert urlparse(page.url).fragment == "saved"

    footer.get_by_role("link", name="Home").tap()
    expect_heading(page, "Outfit planner")
    expect_navigation(page, "Home")
    page.go_back()
    expect_heading(page, "Saved looks")
    expect_navigation(page, "Saved")
    page.go_back()
    expect_heading(page, "Review your setup")
    expect_navigation(page, "Profile")
    assert initial_header.evaluate("node => node.isConnected"), "Navigating replaced the header"
    assert initial_footer.evaluate("node => node.isConnected"), "Navigating replaced the footer"
    page.goto(f"{base}/missing-app-route?q=2#saved")
    expect(page.get_by_role("heading", name="404", exact=True)).to_be_visible()
    assert page.url == f"{base}/missing-app-route?q=2#saved"
    context.close()

    # The static document paints before JavaScript can confirm an account.
    context = browser.new_context(**device, java_script_enabled=False)
    page = context.new_page()
    page.goto(f"{base}/account")
    expect(page.get_by_role("heading", name="Account", exact=True)).to_have_count(0)
    expect(page.get_by_role("contentinfo")).to_have_count(0)
    context.close()

    context = browser.new_context(**device)
    page = context.new_page()
    page.goto(base)
    expect(page.get_by_role("button", name="Sign in to get started")).to_be_visible()
    expect(page.get_by_role("contentinfo")).to_have_count(0)
    expect(page.get_by_role("link", name="Closet home")).to_have_attribute("href", "/")

    for resource in ("/auth/missing", "/missing-image.svg"):
        page.goto(base + resource)
        expect(page.get_by_role("heading", name="404", exact=True)).to_be_visible()
        assert page.url == base + resource

    for destination in (
        "/account", "/closet", "/profile/details", "/profile/style", "/profile/ready",
        "/profile/settings", "/wardrobe/add", "/wardrobe/confirm?batch=3%2C5",
        "/missing-app-route?q=2#saved", "/planner#saved",
    ):
        page.goto(base + destination)
        expect(page.get_by_role("button", name="Sign in to get started")).to_be_visible()
        login = urlparse(page.url)
        assert login.path == "/" and parse_qs(login.query)["returnTo"] == [destination]
        expect(page.locator('input[name="callbackUrl"]')).to_have_value(destination)
        expect(page.get_by_role("contentinfo")).to_have_count(0)

    context.add_cookies([{"name": "planner-fixture", "value": "returning-session", "url": base}])
    page.reload()
    expect_heading(page, "Saved looks")
    expect_navigation(page, "Saved")

    page.get_by_role("link", name="Profile", exact=True).tap()
    height = page.get_by_label("Height (cm)")
    height.fill("179.5")
    context.clear_cookies()
    page.get_by_role("button", name="Save preferences").tap()
    expect(page.get_by_role("button", name="Sign in to get started")).to_be_visible()
    assert parse_qs(urlparse(page.url).query)["returnTo"] == ["/account"]
    expect(page.get_by_role("contentinfo")).to_have_count(0)
    page.go_back()
    expect(page.get_by_role("button", name="Sign in to get started")).to_be_visible()
    expect(page.get_by_role("contentinfo")).to_have_count(0)
    context.close()


def check_session_invalidation(browser, device, base):
    for reason in ("expiry", "signout"):
        context, page = mobile_session(browser, device, base, "returning-session")
        page.clock.install()
        expired = page.evaluate("new Date(Date.now() + 60000).toISOString()")
        def shorten_session(route):
            body = route.fetch().json()
            body["expires"] = expired
            route.fulfill(json=body)
        page.route("**/api/account", shorten_session, times=1)
        page.goto(f"{base}/account")
        expect(page.get_by_label("Height (cm)")).to_be_visible()
        context.clear_cookies()
        # Keep the next account check pending and inspect the UI before it resolves.
        pending = []
        page.route("**/api/account", lambda route: pending.append(route), times=1)
        with page.expect_request(lambda req: req.url.endswith("/api/account")):
            if reason == "expiry":
                page.clock.fast_forward(61000)
            else:
                other_tab = context.new_page()
                other_tab.goto(f"{base}/offline.html")
                other_tab.evaluate("localStorage.setItem('closet:session-ended', String(Date.now()))")
        expect(page.get_by_label("Height (cm)")).to_have_count(0)
        expect(page.get_by_role("contentinfo")).to_have_count(0)
        pending[0].fulfill(body="null", content_type="application/json")
        expect(page.get_by_role("button", name="Sign in to get started")).to_be_visible()
        context.close()


def compare_photo(page, choice):
    button = page.get_by_role("button", name=choice, exact=True)
    card = page.get_by_role("article").filter(has=button)
    return card.get_by_role("img", name="Full-body virtual try-on of this outfit")


def expect_photo_overview(page):
    expect(page.get_by_role("article").first).to_be_visible()
    expect(page.get_by_role("link", name=re.compile("Buy on Shopee"))).to_have_count(0)
    expect(page.get_by_text("Elevate your look", exact=True)).to_have_count(0)


def choose_photo(page, choice):
    photo = compare_photo(page, choice)
    photo.scroll_into_view_if_needed()
    expect(photo).to_have_js_property("naturalWidth", 1)
    src = photo.evaluate("img => img.src")
    page.get_by_role("button", name=choice, exact=True).tap()
    expect_heading(page, "Review your outfit")
    expect(page.get_by_role("img", name="Full-body try-on of your selected look")).to_have_js_property("src", src)
    expect(page.get_by_role("button", name="Preview outfit")).to_have_count(0)
    return src


def save_chosen_photo(page, src, purchase_urls):
    csv_path = Path(__file__).resolve().parents[1] / "Shopee Database/new_clothes_sample_full.csv"
    with csv_path.open(encoding="utf-8-sig", newline="") as catalog:
        ids_by_url = {unquote(row["url"]): row["item_id"] for row in csv.DictReader(catalog)}
    with page.expect_request(lambda req: req.url.endswith("/api/planner") and req.post_data_json["action"] == "save") as save:
        page.get_by_role("button", name="Save outfit").tap()
    payload = save.value.post_data_json["input"]
    assert payload["previewRef"] == unquote(urlparse(src).path.removeprefix("/api/files/"))
    assert sorted(payload["catalogItemIds"]) == sorted(ids_by_url[unquote(url)] for url in purchase_urls)


def evict_photo(context, base, src):
    ref = unquote(urlparse(src).path.removeprefix("/api/files/"))
    eviction = context.request.post(base + "/__fixture/evict-preview", data={"ref": ref})
    assert eviction.json()["changes"] == 1


def block_separate_shopping_lookup(page):
    calls = []

    def intercept(route):
        action = route.request.post_data_json["action"]
        if action == "shopping":
            calls.append(action)
            route.fulfill(status=503, json={"message": "Shopping lookup unavailable"})
        else:
            route.continue_()

    page.route("**/api/planner", intercept)
    return calls


def provider_calls(context, base):
    return context.request.get(base + "/__fixture/provider-calls").json()


def run_flow(browser, device, base):
    context, page = mobile_session(browser, device, base, "first-session")
    page.clock.install()
    product_photo = Path(__file__).resolve().parents[1] / "Shopee Database/clothes_image_database/b6326a099e743eebc194.jpg"
    page.route("https://down-th.img.susercontent.com/file/**", lambda route: route.fulfill(path=product_photo))
    page.goto(f"{base}/planner/")
    expect_heading(page, "Outfit planner")
    expect(page.get_by_text("Tops", exact=True).locator("..").locator("dd")).to_have_text("1")
    expect(page.get_by_text("Outerwear", exact=True).locator("..").locator("dd")).to_have_text("0")
    page.get_by_role("button", name="Plan a new outfit").tap()
    expect_heading(page, "What are you dressing for?")
    expect_navigation(page, "Home")
    page.get_by_role("textbox", name="Occasion", exact=True).fill(OCCASION)
    page.get_by_role("button", name="Continue").tap()
    expect_heading(page, "Today’s style")
    expect(page.get_by_text("Garment preferences", exact=True)).to_have_count(0)
    expect(page.locator("input[name=preferences]")).to_have_count(0)
    expect(page.get_by_role("checkbox", name=re.compile("profile photo", re.I))).to_have_count(0)
    page.get_by_role("button", name="Create looks with my profile photo").tap()

    expect_heading(page, "Compare looks")
    expect(page.get_by_role("checkbox", name=re.compile("profile photo", re.I))).to_have_count(0)
    retry = page.get_by_role("button", name="Retry photos", exact=True)
    expect(page.get_by_text("No completed outfit photos are available for this brief.", exact=True)).to_be_visible()
    expect(retry).to_be_visible()
    expect_photo_overview(page)
    choices = page.get_by_role("button", name=re.compile("^Choose "))
    expect(choices).to_have_count(0)
    first_card = page.get_by_role("article").filter(has=page.get_by_role("heading", name="Look 1", exact=True))
    expect(first_card.get_by_role("img", name="Silk blouse")).to_be_visible()

    stalled = []
    def stall_preview(route):
        payload = route.request.post_data_json
        if payload["action"] == "preview" and "top" in payload["input"]["slots"]:
            stalled.append(route)
        else:
            route.continue_()

    page.route("**/api/planner", stall_preview)
    with page.expect_request(lambda req: req.url.endswith("/api/planner") and req.post_data_json["action"] == "preview"
                             and "top" in req.post_data_json["input"]["slots"]):
        retry.tap()
    expect(page.get_by_role("status")).to_contain_text("Creating")
    expect(choices).to_have_count(0)
    expect(first_card.get_by_text("3 owned pieces · 1 Shopee item", exact=True)).to_be_visible()
    expect(first_card.get_by_text(re.compile(r"THB|฿"))).to_be_visible()
    page.clock.fast_forward(5 * 60 * 1000)
    expect(page.get_by_text(re.compile("took too long", re.I))).to_be_visible()
    expect(retry).to_be_visible()
    assert len(stalled) == 1
    stalled[0].abort()
    page.unroute("**/api/planner", stall_preview)

    def invalid_preview(route):
        if route.request.post_data_json["action"] == "preview":
            route.fulfill(json={"imageRef": ""})
        else:
            route.continue_()

    page.route("**/api/planner", invalid_preview)
    retry.tap()
    expect(page.get_by_text(re.compile("couldn.t open the try-on photo", re.I))).to_be_visible()
    expect(choices).to_have_count(0)
    expect(retry).to_be_visible()
    page.unroute("**/api/planner", invalid_preview)
    retry.tap()
    first = page.get_by_role("article").filter(has=page.get_by_role("button", name="Choose look 1"))
    generated = first.get_by_role("img", name="Full-body virtual try-on of this outfit")
    expect(generated).to_be_visible()
    expect(generated).to_have_js_property("naturalWidth", 1)
    # The provider fixture returns red pixels only for a render containing the selected listing.
    assert generated.evaluate("""img => {
        const context = document.createElement("canvas").getContext("2d");
        context.drawImage(img, 0, 0);
        const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
        return red > 240 && green < 10 && blue < 10;
    }""")
    expect(page.get_by_role("button", name="Choose look 2")).to_have_count(0)
    expect(page.get_by_text("Some outfit photos couldn’t be completed.", exact=True)).to_be_visible()
    expect_photo_overview(page)
    generated_src = choose_photo(page, "Choose look 1")
    generated_bytes = context.request.get(urljoin(base, generated_src)).body()
    wardrobe = page.get_by_role("group", name="Selected wardrobe photos")
    expect(wardrobe.get_by_role("img")).to_have_count(3)
    for name in ["Silk blouse", "Wool trousers", "Walking flats"]:
        expect(wardrobe.get_by_role("img", name=name)).to_be_visible()
    product_link = page.get_by_role("link", name=re.compile("Buy on Shopee"))
    expect(product_link.get_by_text("Elevate your look", exact=True)).to_be_visible()
    expect(product_link.get_by_text("✨", exact=True)).to_be_visible()
    expect(product_link.locator("img")).to_be_visible()
    purchase_url = product_link.evaluate("(link) => link.href")
    source = Path(__file__).resolve().parents[1] / "Shopee Database/new_clothes_sample_full.csv"
    with source.open(encoding="utf-8-sig", newline="") as catalog:
        listing = next(row for row in csv.DictReader(catalog) if unquote(row["url"]) == unquote(purchase_url))
    expect(product_link.get_by_text(listing["name"], exact=True)).to_be_visible()
    context.route("https://shopee.co.th/**", lambda route: route.fulfill(body="Listing"))
    with page.expect_popup() as opened:
        product_link.locator("img").tap()
    expect(opened.value).to_have_url(purchase_url)
    opened.value.close()
    before_save = provider_calls(context, base)
    save_chosen_photo(page, generated_src, [purchase_url])
    expect_heading(page, OCCASION)
    expect(page.get_by_text("Walking flats", exact=True)).to_be_visible()
    shopping = page.get_by_role("region", name="Elevate your look")
    expect(shopping.get_by_role("link", name="Buy on Shopee")).to_have_js_property("href", purchase_url)
    expect(shopping.locator("img")).to_be_visible()
    expect(shopping.get_by_text(re.compile(r"THB"))).to_be_visible()
    saved_photo = page.get_by_role("img", name=f"Full-body AI try-on for {OCCASION}")
    expect(saved_photo).to_have_js_property("src", generated_src)
    assert provider_calls(context, base) == before_save, "Saving the chosen photo called the model"
    saved_url = page.url
    evict_photo(context, base, generated_src)
    context.close()
    context, page = mobile_session(browser, device, base, "returning-session")
    calls = provider_calls(context, base)
    attempted_lookups = block_separate_shopping_lookup(page)
    open_saved(page, base)
    pinned_photo = page.get_by_role("img", name=f"Full-body AI try-on for {OCCASION}")
    expect(pinned_photo).to_have_js_property("src", generated_src)
    pinned_photo.scroll_into_view_if_needed()
    expect(pinned_photo).to_have_js_property("naturalWidth", 1)
    assert context.request.get(urljoin(base, pinned_photo.get_attribute("src"))).body() == generated_bytes
    shopping = page.get_by_role("region", name="Elevate your look")
    expect(shopping.get_by_role("link", name="Buy on Shopee")).to_have_js_property("href", purchase_url)
    assert provider_calls(context, base) == calls, "Reopening a saved outfit called the model"
    assert not attempted_lookups, "The saved detail requested shopping separately from its snapshot"
    shopping.get_by_role("button", name=re.compile("^Hide ")).tap()
    expect(page.locator(f'img[src$="{urlparse(generated_src).path}"]')).to_have_count(0)
    expect(page.get_by_role("region", name="Elevate your look")).to_have_count(0)
    context.close()

    context, page = mobile_session(browser, device, base, "returning-session")
    open_saved(page, base)
    assert page.url == saved_url
    expect(page.get_by_role("region", name="Elevate your look")).to_have_count(0)
    expect(page.get_by_text("No wears logged yet.")).to_be_visible()
    page.get_by_label("Date worn").fill(WEAR_DATE)
    page.get_by_role("button", name="Log wear").tap()
    expect_heading(page, "Wear entry")
    expect(page.get_by_role("radio", name="No rating")).to_be_checked()
    page.get_by_role("button", name="Back to saved look").tap()
    expect_heading(page, OCCASION)
    expect(page.get_by_role("button", name="Edit wear from Mar 8, 2025")).to_be_visible()
    expect(page.get_by_text("Rated", exact=False)).to_have_count(0)
    context.close()

    context, page = mobile_session(browser, device, base, "rating-session")
    open_saved(page, base)
    page.get_by_role("button", name="Edit wear from Mar 8, 2025").tap()
    expect_heading(page, "Wear entry")
    expect(page.get_by_role("radio", name="No rating")).to_be_checked()
    page.get_by_text("4", exact=True).tap()
    expect(page.get_by_role("radio", name="4", exact=True)).to_be_checked()
    page.get_by_label("Note").fill(NOTE)
    page.get_by_role("button", name="Save wear entry").tap()
    expect_heading(page, OCCASION)
    expect(page.get_by_text("Rated 4/5", exact=True)).to_be_visible()
    expect(page.get_by_text(NOTE, exact=True)).to_be_visible()
    page.reload()
    expect_heading(page, OCCASION)
    expect(page.get_by_text("Rated 4/5", exact=True)).to_be_visible()
    expect(page.get_by_text(NOTE, exact=True)).to_be_visible()
    context.close()

    context, page = mobile_session(browser, device, base, "other-account")
    page.goto(f"{base}/planner/#saved")
    expect(page.get_by_role("heading", name="No saved looks yet")).to_be_visible()
    assert context.request.get(f"{base}/api/files/flats").status == 404
    page.goto(saved_url)
    expect(page.get_by_text("This item could not be found.", exact=True)).to_be_visible()
    context.close()

    context = browser.new_context(**device)
    page = context.new_page()
    page.goto(f"{base}/planner/")
    expect(page.get_by_role("alert").filter(has_text="Sign in to open your planner.")).to_be_visible()
    context.close()


def check_comparison_pieces(browser, device, base, capture=None):
    context, page = mobile_session(browser, device, base, "first-session")
    stalled = []
    requests = []
    fail_photos = True

    def hold_photos(route):
        payload = route.request.post_data_json
        if payload["action"] in ("generate", "enhancements", "preview"):
            requests.append((payload["action"], payload["input"].get("optionId")))
        if payload["action"] != "preview":
            route.continue_()
        elif fail_photos:
            route.fulfill(json={"imageRef": None})
        else:
            stalled.append(route)

    page.route("**/api/planner", hold_photos)
    page.goto(f"{base}/planner/")
    page.get_by_role("button", name="Plan a new outfit").tap()
    page.get_by_role("textbox", name="Occasion", exact=True).fill("Dinner with friends")
    page.get_by_role("button", name="Continue").tap()
    page.get_by_role("button", name="Create looks with my profile photo").tap()
    expect_heading(page, "Compare looks")
    regular, dress = [page.get_by_role("article").filter(
        has=page.get_by_role("heading", name=f"Look {n}", exact=True)) for n in (1, 2)]
    expect(regular.get_by_role("img", name="Silk blouse")).to_be_visible()
    expect(dress.get_by_text("All from your closet", exact=True)).to_be_visible()
    expect(dress.get_by_role("img", name="Column dress")).to_be_visible()
    choices = page.get_by_role("button", name=re.compile("^Choose "))
    expect(choices).to_have_count(0)
    retry = page.get_by_role("button", name="Retry photos", exact=True)
    expect(retry).to_be_visible()
    expect(dress.get_by_text("Try-on photo unavailable", exact=True)).to_be_visible()
    fail_photos = False
    retry.tap()
    expect(regular.get_by_text("3 owned pieces · 1 Shopee item", exact=True)).to_be_visible()
    expect(regular.get_by_text(re.compile(r"Shopee price · (THB|฿)"))).to_be_visible()
    expect(dress.get_by_text("All from your closet", exact=True)).to_be_visible()
    expect(regular.get_by_role("img", name="Walking flats")).to_be_visible()
    expect(choices).to_have_count(0)
    if capture:
        capture(page)
    for route in stalled:
        has_top = "top" in route.request.post_data_json["input"]["slots"]
        route.fulfill(json={"imageRef": "blouse" if has_top else None})
    choose = regular.get_by_role("button", name="Choose look 1")
    expect(choose).to_be_enabled()
    expect(dress.get_by_text("Try-on photo unavailable", exact=True)).to_be_visible()
    expect(choices).to_have_count(1)
    before = list(requests)
    choose.tap()
    expect_heading(page, "Review your outfit")
    expect(page.get_by_role("button", name="Save outfit")).to_be_visible()
    page.get_by_role("button", name="Back to compare looks").tap()
    expect(choose).to_be_enabled()
    assert requests == before, "Reopening these comparison cards requested their selections or photos again"
    context.close()


def check_two_catalog_basics(browser, device, base, session):
    context, page = mobile_session(browser, device, base, session)
    product_photo = Path(__file__).resolve().parents[1] / "Shopee Database/clothes_image_database/b6326a099e743eebc194.jpg"
    page.route("https://down-th.img.susercontent.com/file/**", lambda route: route.fulfill(path=product_photo))
    page.goto(f"{base}/planner/")
    page.get_by_role("button", name="Plan a new outfit").tap()
    page.get_by_role("textbox", name="Occasion", exact=True).fill("Museum visit")
    page.get_by_role("button", name="Continue").tap()
    expect_heading(page, "Today’s style")
    page.get_by_role("button", name="Create looks with my profile photo").tap()
    expect_heading(page, "Compare looks")
    expect_photo_overview(page)
    card = page.get_by_role("article").filter(has=page.get_by_role("button", name="Choose look 1"))
    summary = "1 owned piece · 3 Shopee items" if session == "other-account" else "3 Shopee items"
    expect(card.get_by_text(summary, exact=True)).to_be_visible()
    initial = choose_photo(page, "Choose look 1")
    if session == "other-account":
        expect(page.get_by_role("img", name="Private scarf")).to_be_visible()
    else:
        expect(page.get_by_role("group", name="Selected wardrobe photos")).to_have_count(0)
    links = page.get_by_role("link", name=re.compile("Buy on Shopee"))
    gaps = ["Suggested top", "Suggested pants", "Suggested shoes"]
    expect(links).to_have_count(len(gaps))
    by_gap = {gap: links.filter(has_text=gap).get_attribute("href") for gap in gaps}
    assert len(set(by_gap.values())) == len(gaps)
    source = Path(__file__).resolve().parents[1] / "Shopee Database/new_clothes_sample_full.csv"
    with source.open(encoding="utf-8-sig", newline="") as catalog:
        by_url = {unquote(row["url"]): row for row in csv.DictReader(catalog)}
    assert by_url[unquote(by_gap["Suggested top"])]["search_term"] == "women sweater"
    assert by_url[unquote(by_gap["Suggested pants"])]["search_term"] == "women pants"
    assert by_url[unquote(by_gap["Suggested shoes"])]["search_term"] == "women shoes"
    save_chosen_photo(page, initial, by_gap.values())
    expect_heading(page, "Museum visit")
    expect(page.get_by_role("img", name="Full-body AI try-on for Museum visit")).to_have_js_property("src", initial)
    shopping = page.get_by_role("region", name="Elevate your look")
    top = shopping.get_by_role("listitem").filter(has_text="Suggested top")
    top.get_by_role("button", name=re.compile("^Hide ")).tap()
    expect(page.locator(f'img[src$="{urlparse(initial).path}"]')).to_have_count(0)
    remaining = sorted(url for gap, url in by_gap.items() if gap != "Suggested top")
    visible = shopping.get_by_role("link")
    expect(visible).to_have_count(len(remaining))
    assert sorted(visible.evaluate_all("links => links.map(link => link.getAttribute('href'))")) == remaining
    page.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Saved", exact=True).tap()
    expect_heading(page, "Saved looks")
    expect(page.locator(f'img[src$="{urlparse(initial).path}"]')).to_have_count(0)
    saved = page.get_by_role("article")
    saved_links = saved.get_by_role("link", name=re.compile("Buy on Shopee"))
    expect(saved_links).to_have_count(len(remaining))
    assert sorted(saved_links.evaluate_all("links => links.map(link => link.getAttribute('href'))")) == remaining
    if session == "other-account":
        expect(saved.get_by_role("img", name="Private scarf")).to_be_visible()
    context.close()


def check_wardrobe_deletion(browser, device, base):
    context, page = mobile_session(browser, device, base, "returning-session")
    page.goto(f"{base}/closet/")
    dialog = page.get_by_role("dialog")
    confirm_item = dialog.get_by_role("button", name="Delete item", exact=True)
    delete_heels = page.get_by_role("button", name="Delete Leather heels")
    held_impact = []
    page.route("**/api/wardrobe/items/*/delete-impact", lambda route: held_impact.append(route), times=1)
    delete_heels.tap()
    expect(dialog).to_contain_text("Leather heels")
    expect(confirm_item).to_be_disabled()
    dialog.get_by_role("button", name="Cancel").tap()
    held_impact.pop().continue_()
    expect(dialog).to_be_hidden()
    page.reload()
    expect(page.get_by_role("heading", name="Leather heels")).to_be_visible()

    delete_heels.tap()
    expect(dialog).to_contain_text("Leather heels")
    expect(dialog).to_contain_text("No saved looks use it")
    confirm_item.tap()
    expect(dialog).to_be_hidden()
    expect(page.get_by_role("heading", name="Leather heels")).to_have_count(0)
    page.get_by_role("button", name="Delete Walking flats").tap()
    expect(dialog).to_contain_text("Deleting this item will also delete this saved look")
    expect(dialog).to_contain_text(OCCASION)
    dialog.get_by_role("button", name="Cancel").tap()
    expect(page.get_by_role("heading", name="Walking flats")).to_be_visible()
    open_saved(page, base)

    page.goto(f"{base}/closet/")
    page.get_by_role("button", name="Delete Walking flats").tap()
    expect(dialog).to_contain_text(OCCASION)
    dialog.get_by_role("button", name="Delete item and look").tap()
    expect(dialog).to_be_hidden()
    expect(page.get_by_role("heading", name="Walking flats")).to_have_count(0)
    expect(page.get_by_role("heading", name="Silk blouse")).to_be_visible()
    page.goto(f"{base}/planner/#saved")
    expect(page.get_by_role("heading", name="No saved looks yet")).to_be_visible()
    context.close()


def check_outfit_upload(browser, device, base):
    context, page = mobile_session(browser, device, base, "other-account")
    page.goto(f"{base}/wardrobe/add/?from=closet")
    photo = Path(__file__).resolve().parents[1] / "public/sample-wardrobe/studio-model.webp"
    page.get_by_label("Choose photos").set_input_files(photo)
    page.get_by_role("button", name="Upload photos").tap()
    review = page.get_by_role("link", name="Review 3 items")
    expect(review).to_be_visible()
    page.get_by_label("Choose more photos").set_input_files(photo)
    remove = page.get_by_role("button", name=f"Remove {photo.name}")
    expect(remove).to_be_visible()
    expect(review).to_have_count(0)
    remove.tap()
    review.tap()
    expect(page.get_by_text("3 items to review", exact=True)).to_be_visible()
    cards = page.get_by_role("article")
    expect(cards).to_have_count(3)
    photos = []
    for card, name, category in zip(cards.all(), ["Striped shirt", "Straight jeans", "White sneakers"], ["top", "bottom", "shoes"]):
        expect(card.get_by_label("Name", exact=True)).to_have_value(name)
        expect(card.get_by_role("combobox", name="Category")).to_have_value(category)
        expect(card.get_by_role("checkbox")).to_be_checked()
        image = card.get_by_role("img")
        image.scroll_into_view_if_needed()
        expect(image).not_to_have_js_property("naturalWidth", 0)
        photos.append(image.get_attribute("src"))
    assert len(set(photos)) == 3
    cards.first.get_by_label("Name", exact=True).fill("My striped shirt")
    cards.last.get_by_role("checkbox").uncheck()

    # The second save fails after the first succeeds. Only the remaining selected
    # item should be retried, and the unchecked shoes should remain a draft.
    attempts = []
    def fail_second(route):
        attempts.append(route.request.post_data_json["name"])
        if len(attempts) == 2:
            route.fulfill(status=503)
        else:
            route.continue_()
    page.route("**/api/wardrobe/items/*", fail_second)
    page.get_by_role("button", name="Save 2 selected items and continue").tap()
    expect(cards.get_by_role("alert")).to_contain_text("Try again")
    expect(page.get_by_text("2 items to review · 1 confirmed")).to_be_visible()
    page.get_by_role("button", name="Save 1 selected item and continue").tap()
    expect_heading(page, "Closet")
    assert attempts == ["My striped shirt", "Straight jeans", "Straight jeans"]
    page.unroute("**/api/wardrobe/items/*", fail_second)
    for name in ["My striped shirt", "Straight jeans"]:
        expect(page.get_by_role("heading", name=name)).to_be_visible()
    expect(page.get_by_role("heading", name="White sneakers")).to_have_count(0)

    review_remaining = page.get_by_role("link", name="Review 1 draft")
    review_remaining.tap()
    expect(page.get_by_label("Name", exact=True)).to_have_value("White sneakers")
    page.get_by_role("checkbox").uncheck()
    expect(page.get_by_role("button", name="Save 0 selected items and continue")).to_be_disabled()
    page.get_by_role("link", name="Review later").tap()
    expect_heading(page, "Closet")
    review_remaining.tap()
    page.get_by_role("button", name="Save 1 selected item and continue").tap()
    expect_heading(page, "Closet")
    expect(page.get_by_role("heading", name="White sneakers")).to_be_visible()
    expect(review_remaining).to_have_count(0)
    context.close()


def check_wardrobe_return(browser, device, base):
    context, page = mobile_session(browser, device, base, "profile-only")
    page.goto(f"{base}/wardrobe/add/?from=onboarding")
    page.get_by_role("link", name="Add clothes later").tap()
    expect_heading(page, "Confirm style")
    page.goto(f"{base}/wardrobe/confirm/?from=onboarding")
    page.get_by_role("link", name="Continue to style profile").tap()
    expect_heading(page, "Confirm style")
    page.get_by_role("checkbox", name="Classic").check()
    page.get_by_role("button", name="Save and continue").tap()
    page.get_by_role("button", name="Open planner").tap()
    expect_heading(page, "Outfit planner")

    page.get_by_role("link", name="Add new clothes to wardrobe").tap()
    page.get_by_role("link", name="Review saved drafts").tap()
    page.get_by_role("link", name="Return to planner").tap()
    expect_heading(page, "Outfit planner")
    page.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Wardrobe").tap()
    page.get_by_role("link", name="Add items").tap()
    page.get_by_role("link", name="Review saved drafts").tap()
    page.get_by_role("link", name="Return to closet").tap()
    expect_heading(page, "Closet")

    page.goto(f"{base}/wardrobe/confirm/?from=onboarding")
    expect(page.get_by_role("link", name="Return to closet")).to_be_visible()
    page.goto(f"{base}/profile/style/")
    expect_heading(page, "Account")
    expect(page.get_by_role("checkbox", name="Classic")).to_be_checked()
    page.get_by_role("checkbox", name="Classic").uncheck()
    page.get_by_role("button", name="Save preferences").tap()
    expect(page.get_by_text("Preferences saved.")).to_be_visible()
    page.reload()
    expect(page.get_by_role("checkbox", name="Classic")).not_to_be_checked()
    # A completed account with only pending uploads can recover them directly from Closet.
    page.goto(f"{base}/wardrobe/add/?from=onboarding")
    expect(page.get_by_role("link", name="Add clothes later")).to_have_count(0)
    photo = Path(__file__).resolve().parents[1] / "public/sample-wardrobe/studio-model.webp"
    page.get_by_label("Choose photos").set_input_files(photo)
    page.get_by_role("button", name="Upload photos").tap()
    page.get_by_role("link", name="Review 3 items").tap()
    page.get_by_role("link", name="Review later").tap()
    expect_heading(page, "Closet")
    expect(page.get_by_text("0 items", exact=True)).to_be_visible()
    page.get_by_role("link", name="Review 3 drafts").tap()
    page.get_by_role("button", name="Save 3 selected items and continue").tap()
    expect_heading(page, "Closet")
    expect(page.get_by_text("3 items", exact=True)).to_be_visible()
    context.close()


def check_automatic_cutout_retry(browser, device, base):
    photo = Path(__file__).resolve().parents[1] / "public/sample-wardrobe/studio-model.webp"
    for action, succeeds in [("extract_primary", True), ("extract_primary", False), ("manual_review", False)]:
        context, page = mobile_session(browser, device, base, "other-account")
        requests = []
        def upload(route):
            requests.append("upload")
            draft = route.fetch().json()["items"][0]
            draft["extraction"] = {"status": "manual", "code": "invalid_extraction", "nextAction": action}
            route.fulfill(json={"items": [draft]})

        def primary(route):
            requests.append("primary")
            assert route.request.method == "POST" and not route.request.post_data_buffer
            draft_id = int(route.request.url.split("/items/")[1].split("/")[0])
            if succeeds:
                route.fulfill(json={"items": [{"id": draft_id, "name": "Printed sundress"}]})
            else:
                route.fulfill(status=502, json={"code": "invalid_extraction"})

        page.route("**/api/wardrobe/upload", upload)
        page.route("**/extract?mode=primary", primary)
        page.goto(f"{base}/wardrobe/add/")
        page.get_by_label("Choose photos").set_input_files(photo)
        page.get_by_role("button", name="Upload photos").tap()
        review = page.get_by_role("link", name="Review item", exact=True)
        expect(review).to_be_visible()
        if succeeds:
            expect(page.get_by_text("Printed sundress")).to_be_visible()
        else:
            expect(page.get_by_text("Your photo is saved. The automatic cutout failed. You can review it manually.")).to_be_visible()
            assert "manual=" in review.get_attribute("href")
        expect(page.get_by_role("button", name="Retry failed photos")).to_have_count(0)
        assert requests == (["upload", "primary"] if action == "extract_primary" else ["upload"])
        context.close()


def check_failed_photo_removal(browser, device, base):
    context, page = mobile_session(browser, device, base, "other-account")
    photo = Path(__file__).resolve().parents[1] / "public/sample-wardrobe/studio-model.webp"
    def draft_ids():
        response = context.request.get(f"{base}/api/wardrobe/items?status=draft")
        assert response.ok
        return {item["id"] for item in response.json()["items"]}

    original_ids = draft_ids()
    page.goto(f"{base}/wardrobe/add/?from=closet")
    page.get_by_label("Choose photos").set_input_files(photo)
    page.get_by_role("button", name="Upload photos").tap()
    review = page.get_by_role("link", name="Review 3 items")
    expect(review).to_be_visible()
    retained_ids = draft_ids()
    assert len(retained_ids - original_ids) == 3

    def manual_upload(route):
        draft = route.fetch().json()["items"][0]
        draft["extraction"] = {"status": "manual", "code": "extraction_failed", "nextAction": "manual_review"}
        route.fulfill(json={"items": [draft]})

    page.route("**/api/wardrobe/upload", manual_upload, times=1)
    page.get_by_label("Choose more photos").set_input_files(photo)
    page.get_by_role("button", name="Upload photos").tap()
    remove = page.get_by_role("button", name=f"Remove {photo.name}")
    expect(page.get_by_text("Ready for manual review", exact=True)).to_be_visible()
    failed_names = ["first.webp", "second.webp"]
    page.get_by_label("Choose more photos").set_input_files([
        {"name": name, "mimeType": "image/webp", "buffer": photo.read_bytes()} for name in failed_names
    ])
    page.route("**/api/wardrobe/upload", lambda route: route.fulfill(status=413), times=1)
    page.get_by_role("button", name="Upload photos").tap()
    batch_error = page.get_by_role("alert").filter(has_text="The batch is too large to send")
    expect(batch_error).to_be_visible()
    page.route("**/api/wardrobe/upload?draftKey=*", lambda route: route.fulfill(status=503), times=1)
    remove.tap()
    expect(page.get_by_role("alert").filter(has_text="Couldn’t confirm removal")).to_be_visible()
    remove.tap()
    expect(remove).to_have_count(0)
    expect(batch_error).to_be_visible()
    page.get_by_role("button", name="Remove first.webp").tap()
    expect(batch_error).to_be_visible()
    page.get_by_role("button", name="Remove second.webp").tap()
    expect(batch_error).to_have_count(0)
    expect(review).to_be_visible()
    assert draft_ids() == retained_ids

    review.tap()
    expect(page.get_by_text("3 items to review")).to_be_visible()
    first_card = page.get_by_role("article").first
    first_card.get_by_role("checkbox").uncheck()
    save_remaining = page.get_by_role("button", name="Save 2 selected items and continue")
    expect(save_remaining).to_be_enabled()
    first_card.get_by_role("button", name="Discard item").tap()
    expect(save_remaining).to_be_enabled()
    expect(page.get_by_text("2 items to review")).to_be_visible()
    page.reload()
    expect(page.get_by_text("2 items to review")).to_be_visible()
    assert len(retained_ids - draft_ids()) == 1
    save_remaining.tap()
    expect_heading(page, "Closet")
    assert draft_ids() == original_ids
    context.close()


def check_wardrobe_session_expiry(browser, device, base):
    context, page = mobile_session(browser, device, base, "other-account")
    photo = Path(__file__).resolve().parents[1] / "public/sample-wardrobe/studio-model.webp"
    def require_signin():
        expect(page.get_by_role("button", name="Sign in to get started")).to_be_visible()
        expect(page.get_by_role("contentinfo")).to_have_count(0)

    def restore_session():
        context.add_cookies([{"name": "planner-fixture", "value": "other-account", "url": base}])

    def saved_manual_upload(route):
        draft = route.fetch().json()["items"][0]
        draft["extraction"] = {"status": "manual", "code": "extraction_failed", "nextAction": "manual_review"}
        route.fulfill(json={"items": [draft]})

    page.goto(f"{base}/wardrobe/add?from=closet")
    page.route("**/api/wardrobe/upload", saved_manual_upload, times=1)
    page.get_by_label("Choose photos").set_input_files(photo)
    page.get_by_role("button", name="Upload photos").tap()
    expect(page.get_by_text("Ready for manual review", exact=True)).to_be_visible()
    context.clear_cookies()
    page.get_by_role("button", name=f"Remove {photo.name}").tap()
    require_signin()

    restore_session()
    page.goto(f"{base}/wardrobe/confirm?from=closet")
    discard = page.get_by_role("button", name="Discard item").first
    expect(discard).to_be_visible()
    context.clear_cookies()
    discard.tap()
    require_signin()

    restore_session()
    def expire_setup_lookup(route):
        context.clear_cookies()
        route.fulfill(status=401)
    page.route("**/api/profile", expire_setup_lookup, times=1)
    page.goto(f"{base}/wardrobe/add")
    require_signin()
    context.close()


def refresh_stale_choice(page, context, base, image_url, other_image, choice):
    evict_photo(context, base, image_url)
    requests = []
    def track(request):
        if request.url.endswith("/api/planner"):
            requests.append(request.post_data_json)
    page.on("request", track)
    with page.expect_response(lambda response: response.url.endswith("/api/planner") and
                              response.request.post_data_json["action"] == "save") as rejected:
        page.get_by_role("button", name="Save outfit").tap()
    assert rejected.value.status == 409
    target_id = rejected.value.request.post_data_json["input"]["optionId"]
    expect_heading(page, "Compare looks")
    expect(page.get_by_text("This outfit changed before it could be saved. Choose a current photo to continue.")).to_be_visible()
    expect(compare_photo(page, "Choose look 1")).to_have_js_property("src", other_image)
    refreshed = choose_photo(page, choice)
    assert refreshed != image_url, "The rejected photo was presented again"
    assert any(request["action"] == "wardrobe" for request in requests)
    assert {request["action"] for request in requests if request["input"].get("optionId") == target_id} >= {
        "enhancements", "preview"
    }
    page.remove_listener("request", track)
    return refreshed


def leave_while_saving(page, image_url, purchase_urls):
    pending = []
    def delay_save(route):
        if route.request.post_data_json["action"] == "save":
            pending.append(route)
        else:
            route.continue_()
    page.route("**/api/planner", delay_save)
    save_chosen_photo(page, image_url, purchase_urls)
    page.go_back()
    expect_heading(page, "Compare looks")
    response = pending[0].fetch()
    assert response.ok
    with page.expect_response(lambda reply: reply.url.endswith("/api/planner") and
                              reply.request.post_data_json["action"] == "save"):
        pending[0].fulfill(response=response)
    page.evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))")
    expect_heading(page, "Compare looks")
    return page.url.split("#")[0] + "#saved/" + str(response.json()["id"])


def check_occasion_look(browser, device, base, session):
    context, page = mobile_session(browser, device, base, session)
    product_photo = Path(__file__).resolve().parents[1] / "Shopee Database/clothes_image_database/b6326a099e743eebc194.jpg"
    page.route("https://down-th.img.susercontent.com/file/**", lambda route: route.fulfill(path=product_photo))
    blocked_photo = []
    if session == "returning-session":
        def fail_one_photo(route):
            if blocked_photo:
                route.continue_()
                return
            blocked_photo.append(route.request.url)
            route.fulfill(status=404, headers={"Cache-Control": "no-store"})

        page.route(re.compile(r"/api/files/private(?:%2F|/)"), fail_one_photo)
    page.goto(f"{base}/planner/")
    page.get_by_role("button", name="Plan a new outfit").tap()
    page.get_by_role("textbox", name="Occasion", exact=True).fill("Charity gala")
    page.get_by_role("button", name="Continue").tap()
    expect_heading(page, "Today’s style")
    page.get_by_role("button", name="Create looks with my profile photo").tap()
    expect_heading(page, "Compare looks")
    heading = "Styled for your occasion"
    occasion_choice = "Choose occasion look"
    if session == "returning-session":
        expect(page.get_by_text("Some outfit photos couldn’t be completed.", exact=True)).to_be_visible()
        options = page.get_by_role("button", name=re.compile("^Choose "))
        expect(options).to_have_count(1)
        previous_src = options.get_by_role("img").evaluate("img => img.src")
        assert blocked_photo and urljoin(base, previous_src) != blocked_photo[0]
        page.get_by_role("button", name="Retry photos").tap()
        expect(options).to_have_count(2)
        offered = options.get_by_role("img").evaluate_all("images => images.map(image => image.src)")
        assert sorted(offered) == sorted([urljoin(base, previous_src), blocked_photo[0]])
    style_photo = compare_photo(page, occasion_choice)
    style_photo.scroll_into_view_if_needed()
    expect(style_photo).to_have_js_property("naturalWidth", 1)
    image_url = style_photo.evaluate("img => img.src")

    if session == "empty-closet":
        expect(page.get_by_text("Studio model", exact=True)).to_have_count(0)

    if session == "returning-session":
        # This fixture also produces a wardrobe-led photo, plus a dress rejected by its audit.
        regular = compare_photo(page, "Choose look 1")
        expect(regular).to_be_visible()
        other_image = regular.evaluate("img => img.src")
        assert other_image != image_url
        expect(page.get_by_role("button", name="Choose look 2")).to_have_count(0)
        def is_generation(response):
            return response.url.endswith("/api/planner") and response.request.post_data_json["action"] == "generate"

        with page.expect_response(is_generation):
            page.get_by_role("button", name="Show more looks").tap()
        expect(style_photo).to_have_js_property("src", image_url)
        expect_photo_overview(page)
        assert choose_photo(page, "Choose look 1") == other_image
        expect(page.get_by_role("img", name="Wool trousers", exact=True)).to_be_visible()
        page.get_by_role("button", name="Back to compare looks").tap()
        expect_heading(page, "Compare looks")
        expect(regular).to_have_js_property("src", other_image)
        assert choose_photo(page, "Choose look 1") == other_image
        first_review = page.url
        regular_links = page.get_by_role("link", name=re.compile("Buy on Shopee"))
        save_chosen_photo(page, other_image, regular_links.evaluate_all("links => links.map(link => link.href)"))
        expect_heading(page, "Charity gala")
        page.get_by_role("button", name="Back to compare looks", exact=True).tap()
        expect_heading(page, "Compare looks")
    else:
        expect(page.get_by_role("button", name="Choose look 1")).to_be_visible()
        expect(page.get_by_role("button", name=re.compile("^Choose "))).to_have_count(2)
        expect(page.get_by_role("button", name="Show more looks")).to_have_count(0)

    expect_photo_overview(page)
    assert choose_photo(page, occasion_choice) == image_url
    if session == "returning-session":
        occasion_review = page.url
        assert occasion_review != first_review
        page.evaluate("history.go(-3)")
        expect(page).to_have_url(first_review)
        reviewed = page.get_by_role("img", name="Full-body try-on of your selected look")
        expect(reviewed).to_have_js_property("src", other_image)
        page.evaluate("history.go(3)")
        expect(page).to_have_url(occasion_review)
        expect(reviewed).to_have_js_property("src", image_url)
    expect(page.get_by_text(heading, exact=True)).to_be_visible()
    if session == "returning-session":
        expect(page.get_by_text("Studio model", exact=True)).to_have_count(0)
        expect(page.get_by_role("img", name="Silk blouse")).to_be_visible()
        expect(page.get_by_role("img", name="Wool trousers", exact=True)).to_have_count(0)
    else:
        expect(page.get_by_text("Studio model", exact=True)).to_have_count(0)
        expect(page.get_by_role("group", name="Selected wardrobe photos")).to_have_count(0)
    links = page.get_by_role("list", name="Suggested items").get_by_role("link", name=re.compile("Buy on Shopee"))
    expected_listing_count = 1 if session == "returning-session" else 2
    expect(links).to_have_count(expected_listing_count)
    purchase_urls = sorted(links.evaluate_all("links => links.map(link => link.href)"))
    if session == "returning-session":
        image_url = refresh_stale_choice(page, context, base, image_url, other_image, occasion_choice)
        save_chosen_photo(page, image_url, purchase_urls)
        expect_heading(page, "Charity gala")
        saved_url = page.url
    else:
        saved_url = leave_while_saving(page, image_url, purchase_urls)
    context.close()
    context, page = mobile_session(browser, device, base, session)
    calls = provider_calls(context, base)
    page.goto(saved_url)
    expect_heading(page, "Charity gala")
    expect(page.get_by_text(heading, exact=True)).to_be_visible()
    expect(page.get_by_role("img", name="Full-body AI try-on for Charity gala")).to_have_js_property("src", image_url)
    if session == "returning-session":
        expect(page.get_by_role("img", name="Silk blouse")).to_be_visible()
    else:
        expect(page.get_by_role("group", name="Selected wardrobe photos")).to_have_count(0)
    saved_links = page.get_by_role("link", name=re.compile("Buy on Shopee"))
    expect(saved_links).to_have_count(expected_listing_count)
    assert sorted(saved_links.evaluate_all("links => links.map(link => link.href)")) == purchase_urls
    assert provider_calls(context, base) == calls
    context.close()


def check_deferred_photo(browser, device, base):
    context, page = mobile_session(browser, device, base, "empty-closet")
    assert context.request.delete(base + "/api/profile/photo", headers={"Origin": base}).ok
    assert context.request.patch(base + "/api/profile", headers={"Origin": base},
                                 data={"setupCompletedAt": None}).ok
    page.goto(base)
    expect_heading(page, "Add wardrobe photos")
    assert urlparse(page.url).query == "from=onboarding"
    page.goto(base + "/profile/details/")
    expect_heading(page, "Add wardrobe photos")
    page.goto(base + "/profile/ready/")
    page.get_by_role("button", name="Open planner").tap()
    expect_heading(page, "Outfit planner")
    assert context.request.get(base + "/api/profile").json()["facePhotoUrl"] is None
    page.get_by_role("button", name="Plan a new outfit").tap()
    page.get_by_role("textbox", name="Occasion", exact=True).fill("Sunday lunch")
    page.get_by_role("button", name="Continue").tap()
    page.get_by_role("button", name="Loose fit").tap()
    create = page.get_by_role("button", name="Create looks with my profile photo")
    create.tap()
    expect_heading(page, "Add your try-on photo")
    expect(page.get_by_text(re.compile("OpenAI uses"))).to_be_visible()
    page.get_by_role("button", name="Not now").tap()
    expect_heading(page, "Today’s style")
    expect(page.get_by_role("button", name="Loose fit")).to_have_attribute("aria-pressed", "true")
    assert context.request.get(base + "/api/profile").json()["facePhotoUrl"] is None
    create.tap()
    picture = page.get_by_label("Choose a photo")
    picture.set_input_files({"name": "broken.jpg", "mimeType": "image/jpeg", "buffer": b"invalid"})
    page.get_by_role("button", name="Save photo and create looks").tap()
    expect(page.get_by_role("main").get_by_role("alert")).to_contain_text("could not be read")
    assert context.request.get(base + "/api/profile").json()["facePhotoUrl"] is None
    picture.set_input_files(Path(__file__).resolve().parents[1] / "public/google-sign-in.png")
    page.get_by_role("button", name="Save photo and create looks").tap()
    expect_heading(page, "Compare looks")
    assert context.request.get(base + "/api/profile").json()["facePhotoUrl"]
    page.goto(base)
    expect_heading(page, "Outfit planner")
    context.close()



def check_setup_recovery(browser, device, base):
    context, page = mobile_session(browser, device, base, "empty-closet")
    origin = {"Origin": base}
    assert context.request.patch(base + "/api/profile", headers=origin, data={"setupCompletedAt": None}).ok
    photo = Path(__file__).resolve().parents[1] / "public/google-sign-in.png"
    upload = context.request.post(base + "/api/wardrobe/upload", headers=origin, multipart={
        "draftKey": str(uuid4()),
        "image": {"name": "piece.png", "mimeType": "image/png", "buffer": photo.read_bytes()},
    })
    assert upload.ok, upload.text()
    page.goto(base)
    expect(page).to_have_url(re.compile(r"/wardrobe/confirm/?\?from=onboarding$"))
    page.goto(base + "/profile/style/")
    page.get_by_role("checkbox", name="Classic").check()
    page.goto(base)
    expect_heading(page, "Confirm style")
    expect(page.get_by_role("checkbox", name="Classic")).to_be_checked()
    page.get_by_role("button", name="Save and continue").tap()
    expect_heading(page, "Review your setup")
    context.close()
    context, page = mobile_session(browser, device, base, "empty-closet")
    page.goto(base)
    expect_heading(page, "Review your setup")
    page.get_by_role("button", name="Open planner").tap()
    expect_heading(page, "Outfit planner")
    context.close()


def check_journey_recovery(browser, device, base, screenshot=None):
    context, page = mobile_session(browser, device, base, "returning-session")
    page.goto(base + "/planner/")
    page.get_by_role("button", name="Plan a new outfit").tap()
    page.get_by_role("textbox", name="Occasion", exact=True).fill("Charity gala")
    page.reload()
    expect(page.get_by_role("textbox", name="Occasion", exact=True)).to_have_value("Charity gala")
    page.get_by_role("button", name="Continue").tap()
    page.get_by_role("checkbox", name="Classic", exact=True).check()
    page.get_by_role("button", name="Loose fit").tap()
    page.reload()
    expect(page.get_by_role("checkbox", name="Classic", exact=True)).to_be_checked()
    expect(page.get_by_role("button", name="Loose fit")).to_have_attribute("aria-pressed", "true")
    page.get_by_role("button", name="Create looks with my profile photo").tap()
    expect_heading(page, "Compare looks")
    choice = page.get_by_role("button", name="Choose occasion look")
    expect(choice).to_be_visible()
    photo = choice.get_by_role("img").evaluate("image => image.src")
    compare_url = page.url
    # The wardrobe return carries only the saved brief ID and the comparison screen.
    page.goto(base + "/wardrobe/add/?" + urlparse(compare_url).query + "&from=planner")
    page.get_by_role("link", name="Return to outfit").tap()
    expect(choice).to_be_visible()
    expect(choice.get_by_role("img")).to_have_js_property("src", photo)
    card = page.get_by_role("article").filter(has=choice)
    expect(card.get_by_text(re.compile("owned piece.*Shopee item"))).to_be_visible()
    expect(card.get_by_text(re.compile("Shopee price"))).to_be_visible()
    choice.tap()
    expect_heading(page, "Review your outfit")
    page.reload()
    expect(page.get_by_role("img", name="Full-body try-on of your selected look")).to_have_js_property("src", photo)
    context.close()

    other, other_page = mobile_session(browser, device, base, "other-account")
    other_page.goto(compare_url)
    expect_heading(other_page, "Outfit planner")
    expect(other_page.get_by_role("button", name="Continue “Charity gala”")).to_have_count(0)
    other.close()

    context, page = mobile_session(browser, device, base, "returning-session")
    page.goto(base + "/planner/")
    resume = page.get_by_role("button", name="Continue “Charity gala”")
    expect(resume).to_be_visible()
    if screenshot:
        page.screenshot(path=screenshot)
    before = provider_calls(context, base)
    resume.tap()
    expect_heading(page, "Review your outfit")
    expect(page.get_by_role("img", name="Full-body try-on of your selected look")).to_have_js_property("src", photo)
    assert provider_calls(context, base) == before
    page.get_by_role("button", name="Save outfit").tap()
    expect_heading(page, "Charity gala")
    page.reload()
    expect_heading(page, "Charity gala")
    page.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Home").tap()
    expect_heading(page, "Outfit planner")
    expect(resume).to_have_count(0)
    page.get_by_role("button", name="Plan a new outfit").tap()
    page.get_by_role("textbox", name="Occasion", exact=True).fill("Birthday picnic")
    page.get_by_role("button", name="Continue").tap()
    expect_heading(page, "Today’s style")
    page.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Home").tap()
    page.get_by_role("button", name="Discard plan").tap()
    page.reload()
    expect_heading(page, "Outfit planner")
    expect(page.get_by_role("button", name="Continue “Birthday picnic”")).to_have_count(0)
    context.close()

def main():
    root = Path(__file__).resolve().parent.parent
    output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / "out"
    if not (output / "planner.html").is_file():
        raise SystemExit("Run npm run build before running the mobile browser test.")

    with subprocess.Popen(
        ["node", str(root / "tests/returning-mobile-server.mjs"), str(output)],
        stdout=subprocess.PIPE,
        text=True,
    ) as server:
        try:
            base = server.stdout.readline().strip()
            if urlparse(base).hostname != "127.0.0.1":
                raise RuntimeError("The planner test fixture did not start.")
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path=os.getenv("PLANNER_CHROMIUM"))
                try:
                    device = playwright.devices["iPhone 13"]
                    check_shared_navigation(browser, device, base)
                    check_session_invalidation(browser, device, base)
                    run_flow(browser, device, base)
                    check_two_catalog_basics(browser, device, base, "other-account")
                    check_two_catalog_basics(browser, device, base, "profile-only")
                    check_wardrobe_deletion(browser, device, base)
                    check_outfit_upload(browser, device, base)
                    check_automatic_cutout_retry(browser, device, base)
                    check_comparison_pieces(browser, device, base)
                    check_failed_photo_removal(browser, device, base)
                    check_occasion_look(browser, device, base, "returning-session")
                    check_occasion_look(browser, device, base, "empty-closet")
                    check_deferred_photo(browser, device, base)
                    check_wardrobe_session_expiry(browser, device, base)
                    check_wardrobe_return(browser, device, base)
                    check_journey_recovery(browser, device, base)
                    check_setup_recovery(browser, device, base)
                finally:
                    browser.close()
        finally:
            server.terminate()
    print("Returning-user mobile browser flow passed.")


if __name__ == "__main__":
    main()
