import { expect, test, type Page } from "@playwright/test";

// A whole loan through the real interface and the real chain: a free test account
// starts a business, borrows, sells a job through a live TEE, falls behind, is
// foreclosed, keeps serving, and is sold.

const REGISTRY = "v1.lien-13569.testnet";
const label = `ui-${Date.now().toString(36)}`;
const id = `${label}.${REGISTRY}`;

async function startGuest(page: Page) {
  await page.goto("/market");
  await page.getByRole("button", { name: "Use a free test account" }).first().click();
  await expect(page.getByText("Free test account in this browser").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("500.00 tUSD").first()).toBeVisible();
}

test("one loan, from creation to sale, through the app", async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await startGuest(page);

  // Start a business.
  await page.goto("/create");
  await page.getByTestId("create-label").fill(label);
  await expect(page.getByTestId("create-form")).toContainText("is free");
  await page.getByTestId("create-submit").click();
  await expect(page).toHaveURL(new RegExp(`/b/${id}`), { timeout: 90_000 });
  await expect(page.getByTestId("operator")).toBeVisible();

  // Open a loan on short clocks.
  await page.getByTestId("preset-demo").click();
  await page.getByTestId("offer-principal").fill("20");
  await page.getByTestId("offer-min").fill("10");
  await page.getByTestId("offer-window").fill("2");
  await page.getByTestId("offer-grace").fill("1");
  await page.getByTestId("offer-submit").click();
  await expect(page.getByTestId("big-figure")).toContainText("20.00");

  // A lender can see what they are agreeing to before signing.
  await page.getByTestId("lend-amount").fill("0.01");
  await expect(page.getByText(/The minimum is/)).toBeVisible();
  await page.getByTestId("lend-amount").fill("20");
  await expect(page.getByTestId("lend-preview")).toContainText("100%");
  await page.getByTestId("lend-submit").click();
  await expect(page.getByTestId("headline")).toContainText("Paying on time");
  await expect(page.getByTestId("position")).toContainText("20.00");

  // The operator cannot take the money: the controls are simply not there.
  await expect(page.getByText("Withdraw working capital")).toHaveCount(0);

  // Buy real work from the enclave.
  await page.getByTestId("job-input").fill("is outlayer.testnet safe?");
  await page.getByTestId("job-submit").click();
  await expect(page.getByTestId("job-result").getByTestId("report")).toContainText("outlayer.testnet", { timeout: 120_000 });

  // A bad input refunds, and says so.
  await page.getByTestId("job-input").fill("there is no account in this sentence");
  await page.getByTestId("job-submit").click();
  await expect(page.getByTestId("job-result")).toContainText("refunded in full", { timeout: 120_000 });

  // Lenders can collect what the sale paid.
  await expect(page.getByTestId("claimable")).toContainText(/0\.(075|125)/, { timeout: 30_000 });
  await page.getByTestId("claim").click();
  await expect(page.getByTestId("claimable")).toContainText("0.00");

  // Stop paying: wait out the payment window and the grace period.
  await expect(page.getByTestId("foreclose")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("foreclose")).toBeEnabled({ timeout: 120_000 });
  await page.getByTestId("foreclose").click();
  await expect(page.getByTestId("foreclosure-notice")).toBeVisible();

  // It keeps serving, and the operator's share is locked.
  await expect(page.getByTestId("withdraw-share")).toBeDisabled();
  await page.getByTestId("job-input").fill("check usd.lien-13569.testnet");
  await page.getByTestId("job-submit").click();
  await expect(page.getByTestId("job-result").getByTestId("report")).toContainText("usd.lien-13569.testnet", { timeout: 120_000 });

  // Redemption: paying the rest hands it back without a sale.
  await page.getByRole("button", { name: /Pay it all/ }).click();
  await page.getByTestId("repay-submit").click();
  await expect(page.getByTestId("headline")).toContainText("No open loan");
  await expect(page.getByTestId("foreclosure-notice")).toHaveCount(0);
  await expect(page.getByText(/Paid in full/)).toBeVisible();

  // Everything is on the positions screen too.
  await page.goto("/portfolio");
  await expect(page.getByTestId("notes-table")).toContainText("Sentinel");
});
