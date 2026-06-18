import { expect, test } from "@playwright/test";

test("renders the dapp landing page", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "UP/DOWN" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Launch App" })).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Docs", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "GitHub" })).toBeVisible();
  await expect(page.getByText("Test First")).toBeVisible();
  await expect(page.getByText("Built Around Verifiable Settlement")).toBeVisible();
});

test("renders the trading desk and local controls", async ({ page }) => {
  await page.goto("/app");

  await expect(page.getByRole("heading", { name: "Prediction Markets" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Docs", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "GitHub" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Markets" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bitcoin" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Portfolio" })).toBeVisible();
  await expect(page.getByRole("button", { name: "History" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Crypto" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sports" })).toBeVisible();
  await expect(page.getByRole("button", { name: "1m" })).toBeVisible();
  await expect(page.getByRole("button", { name: "5m" })).toBeVisible();
  await expect(page.getByRole("button", { name: "1h" })).toBeVisible();
  await expect(page.getByRole("button", { name: "1d" })).toBeVisible();
  await expect(page.getByRole("button", { name: "UP", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "DOWN", exact: true })).toBeVisible();
  await expect(page.getByText("Preview payout")).toBeVisible();
  await expect(page.getByText("Bet opens").or(page.getByText("Bet closes"))).toBeVisible();
  await expect(page.getByText("Prediction starts").or(page.getByText("Prediction left"))).toBeVisible();
  await expect(page.locator(".poolStats").getByText("Public pool", { exact: true })).toBeVisible();
  await expect(page.getByText("Connect to exclude your trades")).toBeVisible();
  await expect(page.getByText("Total volume")).toBeVisible();
  await expect(page.getByText("UP volume")).toBeVisible();
  await expect(page.getByText("DOWN volume")).toBeVisible();
  await expect(page.getByText("Latest trades")).toBeVisible();
  await expect(page.getByText("Page 1 / 1")).toBeVisible();
  await expect(page.getByText("UP pool", { exact: true })).toBeVisible();
  await expect(page.getByText("DOWN pool", { exact: true })).toBeVisible();
  await expect(page.getByText("Anvil tools")).toBeVisible();
  await expect(page.getByRole("button", { name: "Get test USDC" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Oracle UP" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Oracle DOWN" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tie" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invalid" })).toBeVisible();
});

test("switches market duration without layout failure", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "1m Markets" })).toBeVisible();

  await page.getByRole("button", { name: "5m" }).click();
  await expect(page.getByRole("button", { name: "5m" })).toHaveClass(/active/);
  await expect(page.getByRole("heading", { name: "5m Markets" })).toBeVisible();

  await page.getByRole("button", { name: "1h" }).click();
  await expect(page.getByRole("button", { name: "1h" })).toHaveClass(/active/);
  await expect(page.getByRole("heading", { name: "1h Markets" })).toBeVisible();

  await page.getByRole("button", { name: "1d" }).click();
  await expect(page.getByRole("button", { name: "1d" })).toHaveClass(/active/);
  await expect(page.getByRole("heading", { name: "1d Markets" })).toBeVisible();
});

test("opens portfolio and history views", async ({ page }) => {
  await page.goto("/app");

  await page.getByRole("button", { name: "Portfolio" }).click();
  await expect(page.getByRole("heading", { name: "Positions" })).toBeVisible();
  await expect(page.getByText("Connect wallet to view portfolio.")).toBeVisible();

  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "Trades" })).toBeVisible();
  await expect(page.getByText("Connect wallet to view history.")).toBeVisible();
});

test("renders docs resources", async ({ page }) => {
  await page.goto("/docs");

  await expect(page.getByRole("heading", { name: "Protocol Notes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Protocol", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Testing", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Security", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "README" })).toBeVisible();
});

test("deployment API exposes local contracts", async ({ request }) => {
  const response = await request.get("/api/deployment");
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.chainId).toBe(31337);
  expect(body.mockUSDC).toMatch(/^0x[a-fA-F0-9]{40}$/);
  expect(body.markets.length).toBeGreaterThanOrEqual(28);
  expect(body.markets.some((market: { label?: string }) => market.label === "1m")).toBeTruthy();
  expect(body.markets.some((market: { category?: string }) => market.category === "Sports")).toBeTruthy();
});
