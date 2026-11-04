import { expect, test, type Browser, type Page } from "@playwright/test";

// Two separate people, in two browsers: one borrows and defaults, the other buys
// the business at auction and ends up in control of it.

const REGISTRY = "v1.lien-13569.testnet";
const label = `ui-s${Date.now().toString(36)}`;
const id = `${label}.${REGISTRY}`;

async function guest(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await page.goto("/market");
  await page.getByRole("button", { name: "Use a free test account" }).first().click();
  await expect(page.getByText("500.00 tUSD").first()).toBeVisible({ timeout: 90_000 });
  return page;
}

test("a stranger buys a foreclosed business and takes control", async ({ browser }) => {
  test.setTimeout(420_000);
  const borrower = await guest(browser);
  const buyer = await guest(browser);

  await borrower.goto("/create");
  await borrower.getByTestId("create-label").fill(label);
  await expect(borrower.getByTestId("create-form")).toContainText("is free");
  await borrower.getByTestId("create-submit").click();
  await expect(borrower).toHaveURL(new RegExp(`/b/${id}`), { timeout: 90_000 });

  await borrower.getByTestId("preset-demo").click();
  await borrower.getByTestId("offer-principal").fill("20");
  await borrower.getByTestId("offer-min").fill("10");
  await borrower.getByTestId("offer-window").fill("1");
  await borrower.getByTestId("offer-grace").fill("1");
  await borrower.getByTestId("offer-submit").click();
  await expect(borrower.getByTestId("lend-amount")).toBeVisible();
  await borrower.getByTestId("lend-amount").fill("20");
  await borrower.getByTestId("lend-submit").click();
  await expect(borrower.getByTestId("headline")).toContainText("Paying on time");

  // A stranger forecloses once the clock runs out.
  await buyer.goto(`/b/${id}`);
  await expect(buyer.getByTestId("foreclose")).toBeVisible({ timeout: 120_000 });
  await expect(buyer.getByTestId("foreclose")).toBeEnabled({ timeout: 120_000 });
  await buyer.getByTestId("foreclose").click();
  await expect(buyer.getByTestId("foreclosure-notice")).toBeVisible();

  // A low bid is refused before it can be signed.
  await buyer.getByTestId("bid-amount").fill("0.5");
  await expect(buyer.getByText(/The minimum is/)).toBeVisible();

  // The real bid. Reserve is half the debt.
  await buyer.getByTestId("bid-amount").fill("15");
  await buyer.getByTestId("bid-submit").click();
  await expect(buyer.getByTestId("auction")).toContainText("15.00");

  // Demo clocks run a five minute auction.
  await expect(buyer.getByTestId("settle")).toBeVisible({ timeout: 330_000 });
  await buyer.getByTestId("settle").click();

  // Control has really changed hands.
  await expect(buyer.getByTestId("operator")).toBeVisible();
  await expect(borrower.getByTestId("position")).toBeVisible();
  await borrower.reload();
  await expect(borrower.getByTestId("headline")).toBeVisible();
  await expect(borrower.getByTestId("operator")).toHaveCount(0);

  // The lender still collects, after the loan has closed.
  await expect(borrower.getByTestId("claim")).toBeEnabled();
  await borrower.getByTestId("claim").click();
  await expect(borrower.getByTestId("claimable")).toContainText("0.00");
});
