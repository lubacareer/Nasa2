import { expect, test } from '@playwright/test';
import { expectNoOverflow, syntheticLabel } from './calculation-reference';
import type { StudyDataset } from '../../contracts/dataset';

test('renders linked scientific views and responds coherently to a date change', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await expect(page).toHaveTitle(/NISAR Surface Change/);
  await expect(page.getByText(syntheticLabel, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Before', exact: true })).toHaveValue('preview-day-25');
  await expect(page.getByRole('combobox', { name: 'After', exact: true })).toHaveValue('preview-day-61');
  await expect(page.getByTestId('comparison-label')).toContainText(/Day 61.*Day 25/);

  const histogram = page.getByTestId('histogram').locator('svg').first();
  const spatial = page.getByTestId('spatial-grid').locator('svg').first();
  await expect(histogram).toBeVisible();
  await expect(spatial).toBeVisible();
  await page.getByRole('combobox', { name: 'After', exact: true }).selectOption('preview-day-73');
  await expect(page).toHaveURL(/after=preview-day-73/);
  await expect(page.getByTestId('comparison-label')).toContainText(/Day 73.*Day 25/);
  await expect(page.getByTestId('time-chart').getByText('Day 73', { exact: true })).toBeVisible();
  await expect(page.getByTestId('spatial-grid')).toHaveAttribute('data-after-id', 'preview-day-73');
  await expect(page.getByTestId('change-histogram')).toHaveAttribute('aria-label', /after minus before/);
  await expect(page.getByTestId('paired-count')).toContainText(/\d+/);
  const missing = page.getByRole('combobox', { name: 'Before', exact: true }).getByRole('option', { name: /Day 37/ });
  await expect(missing).toHaveJSProperty('disabled', true);
  await expectNoOverflow(page);
  expect(errors).toEqual([]);
});

test('preserves URL state through refresh and history and resets accessibly', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'After', exact: true })).toHaveValue('preview-day-61');
  await page.getByRole('combobox', { name: 'After', exact: true }).selectOption('preview-day-73');
  await page.getByRole('button', { name: 'Before', exact: true }).click();
  await expect(page).toHaveURL(/view=before/);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'After', exact: true })).toHaveValue('preview-day-73');
  await expect(page.getByRole('button', { name: 'Before', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Change', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Reset view/i }).click();
  await expect(page.getByRole('combobox', { name: 'Before', exact: true })).toHaveValue('preview-day-25');
  await expect(page.getByRole('combobox', { name: 'After', exact: true })).toHaveValue('preview-day-61');
  await page.getByRole('combobox', { name: 'Before', exact: true }).focus();
  await expect(page.getByRole('combobox', { name: 'Before', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Before', exact: true })).not.toHaveValue('preview-day-25');
  await expect(page.getByText(syntheticLabel, { exact: true }).first()).toBeVisible();
  await expectNoOverflow(page);
});

test('rejects unsupported and malformed packages visibly', async ({ page }) => {
  await page.route('**/data/preview.json', (route) => route.fulfill({ json: { schemaVersion: 999 } }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText(/unsupported.*version/i);
  await expect(page.getByText(syntheticLabel, { exact: true }).first()).toBeVisible();

  await page.unroute('**/data/preview.json');
  await page.route('**/data/preview.json', (route) => route.fulfill({ json: { schemaVersion: 1 } }));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText(/invalid|malformed/i);
});

test('keeps loading and no-overlapping-data states distinct from zero change', async ({ page }) => {
  const response = await page.request.get('/data/preview.json');
  const dataset: StudyDataset = await response.json();
  const roiIndices = dataset.grid.roiMask.flatMap((inside, index) => inside ? [index] : []);
  for (const [id, index, value] of [['preview-day-25', roiIndices[0], -12], ['preview-day-61', roiIndices[1], -11]] as const) {
    const acquisition = dataset.acquisitions.find((item) => item.id === id)!;
    acquisition.valuesDb = Array.from({ length: dataset.grid.width * dataset.grid.height }, (_, cell) => cell === index ? value : null);
    acquisition.summary = { medianDb: value, q25Db: value, q75Db: value, validCount: 1 };
  }
  let release: () => void = () => {};
  const ready = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/data/preview.json', async (route) => {
    await ready;
    await route.fulfill({ json: dataset });
  });
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText(/Loading the synthetic data package/);
  release();
  await expect(page.getByRole('status')).toContainText(/No overlapping valid cells/);
  await expect(page.getByTestId('paired-count')).toContainText('0 paired valid pixels');
  await expect(page.getByTestId('histogram').locator('svg')).toHaveCount(0);
  await expect(page.getByText(syntheticLabel, { exact: true }).first()).toBeVisible();
});

test('renders available acquisitions with no valid pixels without treating them as missing', async ({ page }) => {
  const browserProblems: string[] = [];
  page.on('pageerror', (error) => browserProblems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') browserProblems.push(message.text());
  });
  const response = await page.request.get('/data/preview.json');
  const dataset: StudyDataset = await response.json();
  for (const acquisition of dataset.acquisitions) {
    if (acquisition.availability === 'available') {
      acquisition.valuesDb = Array.from({ length: dataset.grid.width * dataset.grid.height }, () => null);
      acquisition.summary = null;
    }
  }
  await page.route('**/data/preview.json', (route) => route.fulfill({ json: dataset }));
  await page.goto('/');

  await expect(page.getByTestId('time-series')).toContainText(/No valid backscatter observations/);
  await expect(page.getByTestId('histogram').getByRole('status')).toContainText(/No overlapping valid cells/);
  await expect(page.getByTestId('paired-count')).toContainText('0 paired valid pixels');
  await expect(page.getByRole('alert')).toHaveCount(0);

  const coverage = page.getByTestId('coverage-strip');
  const available = coverage.locator('g[data-availability="available"]');
  const missing = coverage.locator('g[data-availability="missing"]');
  await expect(available).toHaveCount(8);
  await expect(missing).toHaveCount(1);
  expect(await available.locator('title').allTextContents()).toEqual(
    dataset.acquisitions.filter((item) => item.availability === 'available').map((item) => `Day ${item.day}: 0.0% valid pixels`),
  );
  await expect(missing.locator('title')).toContainText('Day 37: missing acquisition');
  await expect(missing.locator('circle').last()).toHaveAttribute('fill', 'white');

  for (const view of ['Before', 'After', 'Change']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    const cells = page.getByTestId('spatial-grid').locator('rect[data-cell]');
    await expect(cells).toHaveCount(400);
    expect(await cells.evaluateAll((elements) => elements.every((element) => element.getAttribute('fill')?.startsWith('url(#')))).toBe(true);
    await expect(page.locator('body')).not.toContainText(/Infinity|NaN/);
  }
  await expect(page.getByText(syntheticLabel, { exact: true }).first()).toBeVisible();
  await expectNoOverflow(page);
  expect(browserProblems).toEqual([]);
});
