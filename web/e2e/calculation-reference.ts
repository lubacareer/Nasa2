import { expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StudyDataset } from '../../contracts/dataset';

export interface ReferencePair {
  beforeId: string;
  afterId: string;
  beforeDay: number;
  afterDay: number;
  valuesDb: (number | null)[];
  validCount: number;
  binCounts: number[];
}

interface ReferenceSummary {
  medianDb: number;
  q25Db: number;
  q75Db: number;
  validCount: number;
  coverageFraction: number;
}

export interface CalculationReference {
  schemaVersion: number;
  fixtureSha256: string;
  acquisitions: Record<string, ReferenceSummary | null>;
  spatialDomainDb: [number, number];
  histogramEdgesDb: number[];
  pairs: ReferencePair[];
}

const fixtureBytes = readFileSync(resolve(import.meta.dirname, '../public/data/preview.json'));
export const previewDataset: StudyDataset = JSON.parse(fixtureBytes.toString('utf8'));
export const syntheticLabel = 'Synthetic preview — no satellite measurements';
export const available = previewDataset.acquisitions.filter((item) => item.availability === 'available');
// This enumerates selectors only. All expected arithmetic comes from the independent Python oracle.
export const chronologicalPairs = available.flatMap((before, index) => available.slice(index + 1).map((after) => ({ before, after })));

export function loadReference(): CalculationReference {
  const path = process.env.CALCULATION_ORACLE_PATH;
  if (!path) throw new Error('CALCULATION_ORACLE_PATH is required. Run the root test:e2e/test:stability command to prepare the independent oracle.');
  const reference: CalculationReference = JSON.parse(readFileSync(path, 'utf8'));
  expect(reference.schemaVersion, 'oracle version').toBe(1);
  expect(reference.fixtureSha256, 'oracle must describe the exact committed preview bytes').toBe(createHash('sha256').update(fixtureBytes).digest('hex'));
  expect(reference.pairs, 'all chronological date pairs must have numerical expectations').toHaveLength(28);
  return reference;
}

export async function expectNoOverflow(page: Page) {
  // ResizeObserver updates ECharts SVG dimensions after the viewport reflows.
  // Keep the same one-pixel tolerance and fail if overflow persists after settling.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
    message: 'page must fit the viewport after chart resize settles',
    timeout: 5_000,
    intervals: [50, 100, 250],
  }).toBeLessThanOrEqual(1);
}

export async function selectPair(page: Page, beforeId: string, afterId: string, dataset = previewDataset) {
  const before = page.getByRole('combobox', { name: 'Before', exact: true });
  const after = page.getByRole('combobox', { name: 'After', exact: true });
  await expect(before).toBeVisible();
  const last = dataset.acquisitions.filter((item) => item.availability === 'available').at(-1)!;
  const selectedBefore = await before.inputValue();
  const selectedAfter = await after.inputValue();
  const currentAfterDay = dataset.acquisitions.find((item) => item.id === selectedAfter)!.day;
  const requestedBeforeDay = dataset.acquisitions.find((item) => item.id === beforeId)!.day;
  // Extend the upper date only when necessary; all intermediate pairs remain chronological.
  if (requestedBeforeDay >= currentAfterDay) await after.selectOption(last.id);
  if (selectedBefore !== beforeId) await before.selectOption(beforeId);
  if (afterId !== (requestedBeforeDay >= currentAfterDay ? last.id : selectedAfter)) await after.selectOption(afterId);
  await expect(before).toHaveValue(beforeId);
  await expect(after).toHaveValue(afterId);
}

export async function expectOptionAvailability(page: Page, pair: ReferencePair, dataset = previewDataset) {
  for (const kind of ['Before', 'After'] as const) {
    const select = page.getByRole('combobox', { name: kind, exact: true });
    await expect(select).toBeVisible();
    const actual = await select.locator('option').evaluateAll((options) => options.map((option) => ({ value: (option as HTMLOptionElement).value, disabled: (option as HTMLOptionElement).disabled })));
    expect(actual).toEqual(dataset.acquisitions.map((item) => ({
      value: item.id,
      disabled: item.availability === 'missing' || (kind === 'Before' ? item.day >= pair.afterDay : item.day <= pair.beforeDay),
    })));
  }
}

function displayed(value: number | null) {
  return value === null ? 'No data' : value.toFixed(2);
}

export async function expectTables(page: Page, pair: ReferencePair, reference: CalculationReference, dataset = previewDataset) {
  const details = page.locator('#data-table');
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) await details.locator(':scope > summary').click();
  const summaryTable = page.getByRole('region', { name: 'Acquisition summary table', exact: true });
  const rows = await summaryTable.locator('tbody tr').evaluateAll((elements) => elements.map((element) => Array.from(element.children, (cell) => cell.textContent?.trim())));
  expect(rows).toEqual(dataset.acquisitions.map((item) => {
    const summary = reference.acquisitions[item.id];
    return [`Day ${item.day}`, item.availability, displayed(summary?.medianDb ?? null), displayed(summary?.q25Db ?? null), displayed(summary?.q75Db ?? null), item.availability === 'missing' ? 'No data' : String(summary?.validCount ?? 0)];
  }));
  expect(await summaryTable.locator('tr.selected-row th').allTextContents()).toEqual([`Day ${pair.beforeDay}`, `Day ${pair.afterDay}`]);
  const histogramTable = page.getByRole('region', { name: 'Histogram bin counts table', exact: true });
  await expect(histogramTable).toBeVisible();
  const histogramRows = await histogramTable.locator('tbody tr').evaluateAll((elements) => elements.map((element) => Array.from(element.children, (cell) => cell.textContent?.trim())));
  expect(histogramRows).toEqual(pair.binCounts.map((count, index) => [
    String(reference.histogramEdgesDb[index]),
    String(reference.histogramEdgesDb[index + 1]),
    index === pair.binCounts.length - 1 ? 'included' : 'excluded',
    String(count),
  ]));
  expect(histogramRows.reduce((sum, row) => sum + Number(row[3]), 0), 'actual histogram bin counts must sum to the independent paired-pixel count').toBe(pair.validCount);
  const cells = page.locator('.cell-table');
  if (!(await cells.evaluate((element) => (element as HTMLDetailsElement).open))) await cells.locator(':scope > summary').click();
  const before = dataset.acquisitions.find((item) => item.id === pair.beforeId)!;
  const after = dataset.acquisitions.find((item) => item.id === pair.afterId)!;
  const actual = await page.getByRole('region', { name: 'Paired cell values table', exact: true }).locator('tbody tr').evaluateAll((elements) => elements.map((element) => Array.from(element.children, (cell) => cell.textContent?.trim())));
  expect(actual).toEqual(pair.valuesDb.map((value, index) => [String(Math.floor(index / dataset.grid.width) + 1), String(index % dataset.grid.width + 1), displayed(before.valuesDb![index]), displayed(after.valuesDb![index]), displayed(value)]));
}

export async function expectSpatial(page: Page, pair: ReferencePair, reference: CalculationReference, view: 'before' | 'after' | 'change', dataset = previewDataset) {
  const grid = page.getByTestId('spatial-grid');
  await expect(grid).toHaveAttribute('data-view', view);
  const values = view === 'change' ? pair.valuesDb : dataset.acquisitions.find((item) => item.id === (view === 'before' ? pair.beforeId : pair.afterId))!.valuesDb!;
  const actual = await grid.evaluate((element) => ({
    beforeId: element.getAttribute('data-before-id'),
    afterId: element.getAttribute('data-after-id'),
    pairedCount: element.getAttribute('data-paired-count'),
    scale: element.querySelector('.color-key')?.getAttribute('aria-label'),
    cells: Array.from(element.querySelectorAll('rect[data-cell]'), (cell) => ({ index: Number(cell.getAttribute('data-cell')), value: cell.getAttribute('data-value'), fill: cell.getAttribute('fill') })),
  }));
  expect({ beforeId: actual.beforeId, afterId: actual.afterId, pairedCount: actual.pairedCount }).toEqual({ beforeId: pair.beforeId, afterId: pair.afterId, pairedCount: String(pair.validCount) });
  const expectedValues = values.map((value, index) => dataset.grid.roiMask[index] ? value : null);
  expect(actual.cells.map((cell) => cell.index)).toEqual(expectedValues.map((_, index) => index));
  // Compare entire numeric arrays in one assertion; do not emit thousands of trace steps.
  expect(actual.cells.map((cell) => cell.value === 'missing' ? null : Number(Number(cell.value).toFixed(10))))
    .toEqual(expectedValues.map((value) => value === null ? null : Number(value.toFixed(10))));
  expect(actual.cells.map((cell, index) => expectedValues[index] === null
    ? cell.fill?.startsWith('url(#')
    : view === 'change' && expectedValues[index] === 0 ? cell.fill === 'rgb(247,249,251)' : cell.fill?.startsWith('rgb(')))
    .toEqual(expectedValues.map(() => true));
  const bound = Math.max(Math.abs(reference.histogramEdgesDb[0]), Math.abs(reference.histogramEdgesDb.at(-1)!));
  expect(actual.scale).toBe(view === 'change'
    ? `Change scale from ${-bound} to ${bound} decibels`
    : `Backscatter scale from ${reference.spatialDomainDb[0]} to ${reference.spatialDomainDb[1]} decibels`);
}

export async function expectLinkedPair(page: Page, pair: ReferencePair, reference: CalculationReference, options: { tables?: boolean; modes?: boolean } = {}, dataset = previewDataset) {
  await expect(page.getByText(syntheticLabel, { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('paired-count')).toHaveText(`${pair.validCount} paired valid pixels`);
  await expect(page.getByTestId('time-chart')).toContainText(new RegExp(`Day ${pair.beforeDay}.*Day ${pair.afterDay}`));
  const linked = await page.evaluate(() => ({
    comparison: document.querySelector('[data-testid="comparison-label"]')?.textContent,
    histogramLabel: document.querySelector('[data-testid="change-histogram"]')?.getAttribute('aria-label'),
    histogramText: document.querySelector('[data-testid="histogram"]')?.textContent,
    coverage: Array.from(document.querySelectorAll('[data-testid="coverage-strip"] g[data-availability]'), (group) => ({
      title: group.querySelector('title')?.textContent,
      y: Number(group.querySelector('circle:last-of-type')?.getAttribute('cy')),
      selected: group.querySelectorAll('line').length,
    })),
  }));
  expect(linked.comparison).toBe(`Day ${pair.afterDay} minus Day ${pair.beforeDay}`);
  expect(linked.coverage).toEqual(dataset.acquisitions.map((item) => {
    const fraction = reference.acquisitions[item.id]?.coverageFraction ?? 0;
    return {
      title: `Day ${item.day}: ${item.availability === 'missing' ? 'missing acquisition' : `${(fraction * 100).toFixed(1)}% valid pixels`}`,
      y: 78 - fraction * 48,
      selected: item.id === pair.beforeId || item.id === pair.afterId ? 1 : 0,
    };
  }));
  if (pair.validCount > 0) {
    expect(linked.histogramLabel).toMatch(new RegExp(`${pair.validCount} valid paired pixels.*after minus before.*exact zeros`));
    expect(linked.histogramText).toContain('Backscatter increase or zero');
  } else expect(linked.histogramText).toMatch(/No overlapping valid cells/);
  if (options.modes !== false) {
    for (const view of ['before', 'after', 'change'] as const) {
      await page.getByRole('button', { name: view[0].toUpperCase() + view.slice(1), exact: true }).click();
      await expectSpatial(page, pair, reference, view, dataset);
    }
  }
  if (options.tables !== false) await expectTables(page, pair, reference, dataset);
}
