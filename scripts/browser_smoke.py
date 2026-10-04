"""Manual browser verification: uv run python scripts/browser_smoke.py [base URL]."""

import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
artifacts = Path("artifacts")
artifacts.mkdir(exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(
        viewport={"width": 1440, "height": 1000}, device_scale_factor=1, reduced_motion="reduce"
    )
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(base)
    expect(page.locator(".pr-entry")).to_have_count(3)
    expect(page).to_have_title("Eye of God · Pull request reviews")
    expect(page.locator(".summary-result")).to_have_count(3)
    page.screenshot(path=str(artifacts / "dashboard.png"), full_page=True)
    page.get_by_role("link", name="Add backoff to failed delivery retries").click()
    expect(page.locator(".diff-add")).to_have_count(4)
    page.locator("#tone").fill("10")
    expect(page.locator("#tone-value")).to_have_text("10")
    page.locator("#archaic_english").fill("10")
    expect(page.locator("#archaic_english-value")).to_have_text("10")
    page.get_by_role("button", name="Seek judgement").click()
    expect(page.locator("#reviews .notice.success")).to_contain_text("Review generated")
    latest = page.locator(".review-result").first
    expect(latest.locator(".finding")).to_have_count(1)
    expect(latest.locator("textarea")).to_contain_text("Behold")
    expect(latest.locator("textarea")).to_contain_text("ZeroDivisionError")
    expect(page.locator(".inline-finding-row")).to_have_count(1)
    expect(page.locator(".inline-finding-row")).to_contain_text("ZeroDivisionError")
    latest.get_by_role("button", name="View in diff").click()
    expect(page.locator(".diff-focus")).to_have_count(1)
    latest.locator("textarea").fill("Handle zero remaining retries before calculating backoff.")
    latest.get_by_role("button", name="Approve comment").click()
    expect(page.locator("#reviews .notice.success")).to_contain_text("saved")
    latest = page.locator(".review-result").first
    expect(latest.locator(".decision")).to_have_text("approved")
    page.evaluate("window.scrollTo(0, 0)")
    page.screenshot(path=str(artifacts / "review.png"), full_page=True)
    latest.get_by_role("link", name="Publish this").click()
    expect(page.locator(".publish-comment")).to_have_count(1)
    expect(page.locator(".publish-comment")).to_contain_text("Handle zero remaining")
    page.screenshot(path=str(artifacts / "publish.png"), full_page=True)
    page.get_by_role("button", name="Simulate publishing 1 approved comment(s)").click()
    expect(page.locator(".review-result").first.locator(".published")).to_contain_text(
        "Simulated publish"
    )
    page.get_by_role("link", name="Settings", exact=True).click()
    initial_values = {
        name: page.locator(f"#{name}").input_value()
        for name in ["thoroughness", "nitpicking", "conventions", "tone", "archaic_english"]
    }
    page.locator("#thoroughness").fill("7")
    page.locator("#archaic_english").fill("8")
    page.get_by_role("button", name="Save settings").click()
    expect(page.locator(".notice.success")).to_contain_text("Settings saved")
    expect(page.locator("#thoroughness")).to_have_value("7")
    expect(page.locator("#archaic_english")).to_have_value("8")
    page.screenshot(path=str(artifacts / "settings.png"), full_page=True)
    for name, value in initial_values.items():
        page.locator(f"#{name}").fill(value)
    page.get_by_role("button", name="Save settings").click()
    expect(page.locator(".notice.success")).to_contain_text("Settings saved")
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(base + "/prs/142")
    expect(page.locator(".summary-result")).to_have_count(1)
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (
        "Mobile page overflows"
    )
    page.screenshot(path=str(artifacts / "mobile.png"), full_page=True)
    expect(page.locator(".controls-disclosure")).not_to_have_attribute("open", "")
    page.locator(".controls-heading").click()
    expect(page.locator("#archaic_english")).to_be_visible()
    for path in ["/", "/settings"]:
        page.goto(base + path)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (
            f"Mobile {path} overflows"
        )
    page.set_viewport_size({"width": 1440, "height": 1000})
    page.goto(base + "/prs/137")
    page.locator("#nitpicking").fill("10")
    page.get_by_role("button", name="Seek judgement").click()
    expect(page.locator(".no-findings").first).to_contain_text(
        "The work is without discernible flaw"
    )
    page.evaluate("window.scrollTo(0, 0)")
    page.screenshot(path=str(artifacts / "no-findings.png"), full_page=True)
    page.goto(base + "/prs/9999")
    expect(page.locator(".error-page")).to_contain_text("Demo PR not found")
    page.screenshot(path=str(artifacts / "error.png"), full_page=True)
    assert not errors, errors
    browser.close()
    print(
        "Browser workflow passed: summaries, sliders, HTMX review/edit/approve, publishing, settings, mobile."
    )
