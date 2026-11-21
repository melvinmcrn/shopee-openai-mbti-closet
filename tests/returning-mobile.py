"""Run after npm run build with Python Playwright and Chromium installed.

Set PLANNER_CHROMIUM to a local browser executable to use system Chromium.
Optionally pass the path to the static export (defaults to out).
"""

import os
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
    page.get_by_role("link", name="Saved", exact=True).tap()
    expect_heading(page, "Saved looks")
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
    page.goto(f"{base}/planner/")
    expect_heading(page, "Outfit planner")
    expect(page.get_by_text("Tops", exact=True).locator("..").locator("dd")).to_have_text("1")
    expect(page.get_by_text("Outerwear", exact=True).locator("..").locator("dd")).to_have_text("0")
    page.get_by_role("button", name="Plan a new outfit").tap()
    expect_heading(page, "What are you dressing for?")
    page.get_by_label("Occasion").fill(OCCASION)
    page.get_by_role("button", name="Continue").tap()
    expect_heading(page, "Today’s style")
    expect(page.get_by_role("checkbox")).to_have_count(6)
    expect(page.locator("input[name=preferences]:checked")).to_have_count(0)
    page.get_by_text("Shoes", exact=True).tap()
    expect(page.get_by_role("checkbox", name="Shoes")).to_be_checked()
    page.get_by_role("button", name="Clear preferences").tap()
    expect(page.locator("input[name=preferences]:checked")).to_have_count(0)
    page.get_by_role("button", name="Continue").tap()

    expect_heading(page, "Compare looks")
    expect(page.get_by_role("article")).to_have_count(2)
    expect(page.get_by_role("article").nth(0)).to_contain_text("Silk blouse")
    expect(page.get_by_role("article").nth(1)).to_contain_text("Column dress")
    page.get_by_role("button", name="Choose look 1").tap()
    expect_heading(page, "Refine your outfit")
    shoes = page.get_by_role("combobox", name="Shoes")
    expect(shoes).to_have_value("13")
    shoes.select_option(label="Walking flats · Black")
    expect(shoes).to_have_value("14")
    expect(page.get_by_text("Changed", exact=True)).to_be_visible()
    expect(page.get_by_text("Leather heels", exact=True)).to_be_visible()
    page.get_by_role("button", name="Save outfit").tap()
    expect_heading(page, OCCASION)
    expect(page.get_by_text("Walking flats", exact=True)).to_be_visible()
    saved_url = page.url
    context.close()

    context, page = mobile_session(browser, device, base, "returning-session")
    open_saved(page, base)
    assert page.url == saved_url
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
