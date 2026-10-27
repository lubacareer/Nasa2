import { expect, test } from '@playwright/test';

test('development server loads the synthetic workbench without browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.locator('.preview-banner strong')).toHaveText('Synthetic preview — no satellite measurements');
  for (const plot of ['time-series', 'coverage-strip', 'change-histogram', 'spatial-grid']) {
    await expect(page.getByTestId(plot)).toBeVisible();
  }
  expect(errors).toEqual([]);
});
