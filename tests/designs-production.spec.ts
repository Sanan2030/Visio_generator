import { expect, test } from "@playwright/test";

test.describe("production interface gallery visibility", () => {
  test.skip(process.env.VISIOFLOW_PRODUCTION_TESTS !== "1", "Bu yoxlama production server tələb edir.");

  test("the interface gallery returns a localized 404 in production", async ({ page }) => {
    const response = await page.goto("/designs");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Səhifə tapılmadı", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "İş axınına qayıt", exact: true })).toHaveAttribute("href", "/");
    await expect(page.getByRole("heading", { name: /İnterfeys nümunələri/ })).toHaveCount(0);
  });

  test("the production workspace menu omits the interface gallery", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Visio üçün yüklə", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Layihə menyusu", exact: true }).click();
    await expect(page.getByRole("link", { name: "İnterfeys nümunələri", exact: true })).toHaveCount(0);
    await expect(page.locator('a[href="/designs"]')).toHaveCount(0);
  });
});
