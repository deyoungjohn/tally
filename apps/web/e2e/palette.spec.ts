import { expect, test, type Page } from "@playwright/test";

/**
 * Palette rule (owner, 2026-10-07): black, white, faint white and orange only. No greys. Pop-ups are liquid glass over
 * transparent black; hover, selected and pressed highlights are orange glass.
 */

type Rgba = [number, number, number, number];
const parse = (c: string): Rgba | null => {
  const m = c.match(/[\d.]+/g)?.map(Number);
  if (!m || m.length < 3) return null;
  return [m[0]!, m[1]!, m[2]!, m[3] ?? 1];
};
/** A solid or near-solid colour whose channels are (nearly) equal and that is neither black nor white. */
const isGrey = ([r, g, b, a]: Rgba) =>
  a >= 0.9 &&
  Math.max(r, g, b) - Math.min(r, g, b) <= 10 &&
  (r + g + b) / 3 > 8 &&
  (r + g + b) / 3 < 247;

async function greys(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      for (const prop of ["backgroundColor", "color", "borderTopColor"] as const) {
        if (prop === "borderTopColor" && cs.borderTopWidth === "0px") continue;
        if (prop === "backgroundColor" && cs.backgroundColor === "rgba(0, 0, 0, 0)") continue;
        out.push(`${el.tagName}.${String(el.className).slice(0, 40)}|${prop}|${cs[prop]}`);
      }
    }
    return out;
  });
}

test.describe("palette: no greys", () => {
  for (const path of ["/", "/trade/NVDA", "/radar", "/docs"]) {
    test(`no solid grey fill, text or border on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForTimeout(1500);
      const found = (await greys(page)).filter((row) => {
        const c = parse(row.split("|")[2]!);
        return c !== null && isGrey(c);
      });
      expect(found, found.slice(0, 8).join("\n")).toEqual([]);
    });
  }
});

test.describe("palette: pop-ups and highlights", () => {
  test("a modal is pure liquid glass like the nav bar (almost no fill, a blur behind it), not grey", async ({
    page,
  }) => {
    await page.goto("/trade/NVDA");
    await page
      .getByRole("button", { name: /learn more/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const style = await dialog.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, filter: cs.backdropFilter };
    });
    // Pure liquid glass like the nav bar: almost no fill, and a blur of whatever is behind the surface.
    const [, , , alpha] = parse(style.bg)!;
    expect(alpha).toBeLessThan(0.05);
    expect(style.filter).toContain("blur(4px)");
  });

  test("the Select dropdown is the same glass and its hover highlight is orange", async ({
    page,
  }) => {
    await page.goto("/trade/NVDA");
    await page.locator("button[aria-haspopup='listbox']").first().click();
    const panel = page.locator(".select-panel");
    await expect(panel).toBeVisible();
    const [, , , panelAlpha] = parse(
      await panel.evaluate((el) => getComputedStyle(el).backgroundColor),
    )!;
    expect(panelAlpha).toBeLessThan(0.05);
    expect(await panel.evaluate((el) => getComputedStyle(el).backdropFilter)).toContain(
      "blur(4px)",
    );
    await page.getByRole("option").nth(2).hover();
    const pill = panel.locator("[data-glide-pill]");
    await expect(pill).toHaveCSS("opacity", "1");
    const [r, g, b, a] = parse(await pill.evaluate((el) => getComputedStyle(el).backgroundColor))!;
    expect(r).toBeGreaterThan(200); // orange: strong red, weak green and blue
    expect(g).toBeLessThan(110);
    expect(b).toBeLessThan(60);
    expect(a).toBeGreaterThan(0.08); // fainter than the nav pill (0.26), still visibly orange
    expect(a).toBeLessThan(0.2);
  });

  test("the pressed state is a stronger orange", async ({ page }) => {
    await page.goto("/trade/NVDA");
    await page.locator("button[aria-haspopup='listbox']").first().click();
    const panel = page.locator(".select-panel");
    const option = page.getByRole("option").nth(1);
    await option.hover();
    const pill = panel.locator("[data-glide-pill]");
    const rest = parse(await pill.evaluate((el) => getComputedStyle(el).backgroundColor))!;
    const box = (await option.boundingBox())!;
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    const pressed = parse(await pill.evaluate((el) => getComputedStyle(el).backgroundColor))!;
    await page.mouse.up();
    expect(pressed[3]).toBeGreaterThan(rest[3]);
  });
});
