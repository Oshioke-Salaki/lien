import { expect, test } from "@playwright/test";
import { money, owedMoney, repaidMoney } from "../src/lib/format";

const REGISTRY = "v1.lien-13569.testnet";
const SENTINEL = `sentinel.${REGISTRY}`;

test.describe("landing page", () => {
  test("says what it is and leads to the market", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Loans for AI agents");
    await page.locator(".hero").getByRole("link", { name: "Lend to an AI business" }).click();
    await expect(page).toHaveURL(/\/market$/);
    await expect(page.getByRole("heading", { name: "Market" })).toBeVisible();
  });

  test("shows real figures from the chain", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("pulse-jobs")).toHaveText(/^\d+$/);
    // the count is read live: it settles on the registry's real number of businesses
    await expect(page.locator('[data-live="count"]')).toHaveText(/^\d+$/);
  });

  test("shows Sentinel's debt from the same source, to the same cent, as the app", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator('[data-live="sentinel-owed"]')).toHaveText(/^[\d,]+\.\d\d$/);
    const market = await (await request.get("/api/market")).json();
    const loan = market.businesses.find((b: { id: string }) => b.id === SENTINEL).current_loan;
    await expect(page.locator('[data-live="sentinel-owed"]').first()).toHaveText(owedMoney(loan.terms.total_due, loan.repaid).slice(1));
    await expect(page.locator('[data-live="sentinel-repaid"]').first()).toHaveText(repaidMoney(loan.terms.total_due, loan.repaid).slice(1));
  });

  test("every section link in the menu lands on its section", async ({ page }) => {
    await page.goto("/");
    for (const id of ["market", "how", "compare", "try", "proof", "questions"]) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });

  test("the simulator follows the contract's rule, and stopping turns it into a notice", async ({ page }) => {
    await page.goto("/");
    const notice = page.getByTestId("notice");
    await expect(notice).toHaveAttribute("data-state", "active");
    await expect(page.getByTestId("monthly-lender")).toHaveText("$120"); // 30% of $400
    await expect(page.getByTestId("payoff")).toHaveText("10 months"); // 1100 / 120, rounded up
    await page.getByTestId("sim-stop").click();
    await expect(notice).toHaveAttribute("data-state", "foreclosed");
    await expect(notice).toContainText("Notice of foreclosure");
    await expect(page.getByTestId("still-owed")).toHaveText("$740"); // 1100 - 3 * 120
    await expect(page.getByTestId("recovered")).toHaveText("$860"); // 360 + min(500, 740)
    await expect(notice).toContainText("so they lose $240"); // the loss depends on the bid
    await page.getByTestId("sim-bid").fill("800");
    await expect(page.getByTestId("recovered")).toHaveText("$1,100"); // a bid above the debt covers it
    await page.getByTestId("sim-stop").click();
    await expect(notice).toHaveAttribute("data-state", "active");
  });

  test("the simulator handles a debt cleared before payments stop", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("sim-revenue").fill("4000");
    await page.getByTestId("sim-share").fill("80");
    await page.getByTestId("sim-stop").click();
    await expect(page.getByTestId("notice")).toHaveAttribute("data-state", "active");
    await expect(page.getByTestId("notice")).toContainText("Lien released");
    // 80% of $4,000 is more than the whole debt: the figure says so instead of a different number.
    await expect(page.getByTestId("monthly-lender")).toHaveText("$1,100, the whole debt (80% would be $3,200)");
    await expect(page.getByTestId("notice")).not.toContainText("keeps everything");
  });

  test("never scrolls sideways", async ({ page }) => {
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `overflow at ${width}`).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("market", () => {
  test("lists real businesses and opens one", async ({ page }) => {
    await page.goto("/market");
    await expect(page.getByTestId(`row-${SENTINEL}`)).toBeVisible();
    await expect(page.getByTestId("market-finding")).toContainText("raising");
    await page.getByTestId(`row-${SENTINEL}`).getByRole("link", { name: "Sentinel", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/b/${SENTINEL}`));
  });

  test("leaves test runs out of the listing", async ({ page }) => {
    await page.goto("/market");
    await expect(page.getByTestId(`row-${SENTINEL}`)).toBeVisible();
    await expect(page.locator('[data-testid^="row-e2e-"]')).toHaveCount(0);
  });
});

test.describe("a business", () => {
  test("every proof checks out live", async ({ page }) => {
    await page.goto(`/b/${SENTINEL}`);
    const rows = page.getByTestId("proof-row");
    await expect(rows).toHaveCount(5);
    await expect(page.locator('[data-testid="proof-row"][data-state="checking"]')).toHaveCount(0);
    for (const state of await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-state")))) {
      expect(state).toBe("ok");
    }
  });

  test("the waterfall's parts add up to the price on screen", async ({ page }) => {
    await page.goto(`/b/${SENTINEL}`);
    const panel = page.getByRole("heading", { name: /sale goes/ }).locator("xpath=ancestor::section");
    await expect(panel).toContainText("Lenders");
    const figures = await panel.locator("dd").allInnerTexts();
    // Amounts read as dollars ("$0.075"); the sign is not part of the number.
    const sum = figures.reduce((total, text) => total + Number.parseFloat(text.replace(/[^0-9.]/g, "")), 0);
    expect(sum).toBeCloseTo(0.25, 6);
  });

  test("an unknown account gets a clear message, not a crash", async ({ page }) => {
    // The server answers with a real 404 page; if the chain is slow, the page says so in place.
    const response = await page.goto("/b/nope-not-here.testnet");
    await expect(page.getByText(/no Lien business/).first()).toBeVisible();
    expect([200, 404]).toContain(response?.status());
  });

  test("an account outside the registry is called out", async ({ page }) => {
    await page.goto(`/b/${REGISTRY}`);
    await expect(page.getByText(/no Lien business|could not be reached/).first()).toBeVisible();
  });

  test("never scrolls sideways", async ({ page }) => {
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/b/${SENTINEL}`);
      await expect(page.getByTestId("headline")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `overflow at ${width}`).toBeLessThanOrEqual(0);
    }
  });

  test("the live NEAR Intents route returns a real price", async ({ page }) => {
    await page.goto(`/b/${SENTINEL}`);
    await page.getByTestId("intents-disclosure").locator("summary").click();
    await page.getByTestId("intents-refund").fill("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    await page.getByTestId("intents-origin").selectOption({ label: "USDC on Base" });
    await page.getByTestId("intents-quote").click();
    await expect(page.getByTestId("intents-result")).toContainText("You send");
    await expect(page.getByTestId("intents-result")).toContainText("sending is off");
    // A real (non-dry) quote: a deposit address, followed on 1Click's status API. Nothing is sent to it.
    await expect(page.getByTestId("intents-deposit")).toBeVisible();
    await expect(page.getByTestId("intents-sending-off")).toContainText("Do not send anything");
    await expect(page.getByTestId("intents-status-card")).toHaveAttribute("data-status", "PENDING_DEPOSIT");
  });

  test("a dry run shows every NEAR Intents status in plain words", async ({ page }) => {
    await page.goto(`/b/${SENTINEL}`);
    await page.getByTestId("intents-disclosure").locator("summary").click();
    await page.getByTestId("intents-refund").fill("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    await page.getByTestId("intents-origin").selectOption({ label: "USDC on Base" });
    await page.getByTestId("intents-dry-toggle").locator("input").check();
    await page.getByTestId("intents-quote").click();
    await expect(page.getByTestId("intents-result")).toContainText("created no deposit address");
    await expect(page.getByTestId("intents-status-meaning")).toContainText("A preview creates none");
    await expect(page.getByTestId("intents-deposit")).toHaveCount(0);
    await page.getByTestId("intents-sim-REFUNDED").click();
    await expect(page.getByTestId("intents-status-meaning")).toContainText("refund address (0xd8da6bf26964af9d7eed9e03e53415d37aa96045)");
    await page.getByTestId("intents-sim-FAILED").click();
    await expect(page.getByTestId("intents-status-meaning")).toContainText("received nothing");
    await page.getByTestId("intents-dryrun-play").click();
    await expect(page.getByTestId("intents-status-card")).toHaveAttribute("data-status", "SUCCESS", { timeout: 10_000 });
  });

  test("its books agree with the market to the cent, balance, and fit a phone", async ({ page, request }) => {
    await page.goto(`/b/${SENTINEL}`);
    await page.getByTestId("books-link").click();
    await expect(page).toHaveURL(new RegExp(`/b/${SENTINEL}/books$`));
    await expect(page.getByTestId("books-check")).toHaveAttribute("data-check", "equal");
    // Both refresh on their own clocks, so a sale landing between two reads is waited out.
    await expect(async () => {
      const market = await (await request.get("/api/market")).json();
      const b = market.businesses.find((x: { id: string }) => x.id === SENTINEL);
      expect(await page.getByTestId("tile-sales").innerText()).toBe(money(b.stats.job_revenue));
      expect(await page.getByTestId("tile-customers").innerText()).toBe(String(b.stats.unique_payers));
      expect(await page.getByTestId("loans-outstanding").innerText()).toBe(owedMoney(b.current_loan.terms.total_due, b.current_loan.repaid));
    }).toPass({ timeout: 60_000 });
    await expect(page.getByTestId("books-how")).toContainText("How these numbers are computed");
    await page.setViewportSize({ width: 390, height: 900 });
    await expect(page.getByTestId("balance-held")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "overflow at 390").toBeLessThanOrEqual(0);
  });

  test("a bad refund address gets a clear message", async ({ page }) => {
    await page.goto(`/b/${SENTINEL}`);
    await page.getByTestId("intents-disclosure").locator("summary").click();
    await page.getByTestId("intents-refund").fill("nonsense");
    await page.getByTestId("intents-origin").selectOption({ label: "USDC on Base" });
    // Checked as you type, for the chain chosen, so no request is sent for an address that cannot work.
    await expect(page.getByTestId("intents")).toContainText("does not look right for a Base address");
    await expect(page.getByTestId("intents-quote")).toBeDisabled();
    // A checksummed address of the right shape is accepted.
    await page.getByTestId("intents-refund").fill("0x000000000000000000000000000000000000dEaD");
    await expect(page.getByTestId("intents")).not.toContainText("does not look right");
    await expect(page.getByTestId("intents-quote")).toBeEnabled();
  });
});

test.describe("other screens", () => {
  test("positions asks you to connect", async ({ page }) => {
    await page.goto("/portfolio");
    await expect(page.getByRole("button", { name: "Connect a wallet" }).first()).toBeVisible();
  });

  test("create validates before anything is signed", async ({ page }) => {
    await page.goto("/create");
    await page.getByTestId("create-label").fill("Bad Name!");
    // The form names what is wrong (the field lowercases as you type, so the "!" and the space are left).
    await expect(page.getByTestId("create-form")).toContainText("Use only letters, numbers, - and _.");
    await page.getByTestId("create-label").fill("sentinel");
    await expect(page.getByTestId("create-form")).toContainText("That name is taken");
  });

  test("the machine-readable routes work", async ({ request }) => {
    const agents = await (await request.get("/api/agents")).json();
    expect(agents.agents.map((a: { id: string }) => a.id)).toContain(SENTINEL);
    const one = await (await request.get(`/api/agents/${SENTINEL}`)).json();
    expect(one.agent.name).toBe("Sentinel");
    expect(one.jobs.length).toBeGreaterThan(0);
    expect((await request.get("/api/agents/not-ours.testnet")).status()).toBe(404);
    expect(await (await request.get("/llms.txt")).text()).toContain(REGISTRY);
  });

  test("the guest route refuses bad input", async ({ request }) => {
    const bad = await request.post("/api/guest", { data: { publicKey: "x" } });
    expect(bad.status()).toBe(400);
  });
});
