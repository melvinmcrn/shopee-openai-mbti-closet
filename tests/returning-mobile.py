"""Run after npm run build with Python Playwright and Chromium installed.

Set PLANNER_CHROMIUM to a local browser executable to use system Chromium.
Optionally pass the path to the static export (defaults to out).
"""

import os
import re
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse

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


def open_saved(page, base):
    page.goto(f"{base}/planner/")
    expect_heading(page, "Outfit planner")
    footer = page.get_by_role("navigation", name="Main navigation")
    for name in ("Home", "Wardrobe", "Saved", "Profile"):
        expect(footer.get_by_role("link", name=name, exact=True)).to_be_visible()
    expect(footer.get_by_role("link", name="Home", exact=True)).to_have_attribute("aria-current", "page")
    saved = footer.get_by_role("link", name="Saved", exact=True)
    saved.tap()
    expect_heading(page, "Saved looks")
    expect(saved).to_have_attribute("aria-current", "page")
    expect(page.get_by_text("Walking flats", exact=True)).to_be_visible()
    expect(page.get_by_text("Leather heels", exact=True)).to_have_count(0)
    page.get_by_role("button", name=f"Open saved look for {OCCASION}").tap()
    expect_heading(page, OCCASION)
    expect(page.get_by_text("Walking flats", exact=True)).to_be_visible()
    expect(page.get_by_text("Leather heels", exact=True)).to_have_count(0)
    flats_photo = page.get_by_role("listitem").filter(has_text="Walking flats").locator("img")
    flats_photo.scroll_into_view_if_needed()
    expect(flats_photo).to_have_js_property("naturalWidth", 1)


def run_flow(browser, device, base):
    context, page = mobile_session(browser, device, base, "first-session")
    product_photo = Path(__file__).resolve().parents[1] / "Shopee Database/clothes_image_database/b6326a099e743eebc194.jpg"
    page.route("https://down-th.img.susercontent.com/file/**", lambda route: route.fulfill(path=product_photo))
    page.goto(f"{base}/planner/")
    expect_heading(page, "Outfit planner")
    expect(page.get_by_text("Tops", exact=True).locator("..").locator("dd")).to_have_text("1")
    expect(page.get_by_text("Outerwear", exact=True).locator("..").locator("dd")).to_have_text("0")
    page.get_by_role("button", name="Plan a new outfit").tap()
    expect_heading(page, "What are you dressing for?")
    expect(page.get_by_role("navigation", name="Main navigation")).to_have_count(0)
    page.get_by_role("textbox", name="Occasion", exact=True).fill(OCCASION)
    page.get_by_role("button", name="Continue").tap()
    expect_heading(page, "Today’s style")
    expect(page.get_by_text("Garment preferences", exact=True)).to_have_count(0)
    expect(page.locator("input[name=preferences]")).to_have_count(0)
    expect(page.get_by_role("checkbox", name=re.compile("^Use my profile photo"))).not_to_be_checked()
    page.get_by_role("button", name="Continue").tap()

    expect_heading(page, "Compare looks")
    expect(page.get_by_role("article")).to_have_count(2)
    expect(page.get_by_role("article").nth(0)).to_contain_text("Silk blouse")
    expect(page.get_by_role("article").nth(1)).to_contain_text("Column dress")
    expect(page.get_by_role("img", name="Full-body virtual try-on of this outfit")).to_have_count(2)
    page.get_by_role("article").nth(0).get_by_role("button", name="Retry enhancement check").tap()
    expect(page.get_by_role("article").nth(0).get_by_text("Optional enhancement")).to_be_visible()
    expect(page.get_by_role("article").nth(0).get_by_role("link", name="Buy on Shopee")).to_have_attribute(
        "href", re.compile(r"^https://shopee\.co\.th/")
    )
    expect(page.get_by_role("article").nth(1).get_by_text("Optional enhancement")).to_have_count(0)
    purchase_url = page.get_by_role("article").nth(0).get_by_role("link", name="Buy on Shopee").evaluate("(link) => link.href")
    page.get_by_role("button", name="Choose look 1").tap()
    expect_heading(page, "Review your outfit")
    expect(page.get_by_text("Walking flats", exact=True)).to_be_visible()
    expect(page.get_by_role("link", name="Buy on Shopee")).to_have_js_property("href", purchase_url)
    page.get_by_role("button", name="Save outfit").tap()
    expect_heading(page, OCCASION)
    expect(page.get_by_text("Walking flats", exact=True)).to_be_visible()
    shopping = page.get_by_role("region", name="Shop this look")
    expect(shopping.get_by_role("link", name="Buy on Shopee")).to_have_js_property("href", purchase_url)
    expect(shopping.locator("img")).to_be_visible()
    expect(shopping.get_by_text(re.compile(r"THB"))).to_be_visible()
    shopping.get_by_role("button", name=re.compile("^Hide ")).tap()
    expect(page.get_by_role("region", name="Shop this look")).to_have_count(0)
    saved_url = page.url
    context.close()

    context, page = mobile_session(browser, device, base, "returning-session")
    open_saved(page, base)
    assert page.url == saved_url
    expect(page.get_by_role("region", name="Shop this look")).to_have_count(0)
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
                    run_flow(browser, playwright.devices["iPhone 13"], base)
                finally:
                    browser.close()
        finally:
            server.terminate()
    print("Returning-user mobile browser flow passed.")


if __name__ == "__main__":
    main()
