import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StudyDataset } from '../../contracts/dataset';
import { chronologicalPairs, expectLinkedPair, expectNoOverflow, expectOptionAvailability, loadReference, selectPair, type CalculationReference, type ReferencePair } from './calculation-reference';

for (const { before, after } of chronologicalPairs) {
  test(`independent numerical reference: Day ${after.day} minus Day ${before.day}, all three spatial modes`, async ({ page }) => {
    const reference = loadReference();
    const pair = reference.pairs.find((item) => item.beforeId === before.id && item.afterId === after.id)!;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await selectPair(page, before.id, after.id);
    await expectOptionAvailability(page, pair);
    await expectLinkedPair(page, pair, reference);
    await expectNoOverflow(page);
    expect(errors).toEqual([]);
  });
}

test('hand-verified boundary cells preserve sign, exact zero, ROI masking, and inclusive final histogram edge', async ({ page }) => {
  const golden: { dataset: StudyDataset; expected: { differencesDb: (number | null)[]; pairedValidCount: number; histogramCounts: number[]; beforeCoverageFraction: number; afterCoverageFraction: number; spatialDomainDb: [number, number] } } = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../contracts/testing/calculation-golden.json'), 'utf8'));
  const { dataset, expected } = golden;
  await page.route('**/data/preview.json', (route) => route.fulfill({ json: dataset }));
  await page.goto('/');
  const pair: ReferencePair = { beforeId: 'reference-before', afterId: 'reference-after', beforeDay: 25, afterDay: 61, valuesDb: expected.differencesDb, validCount: expected.pairedValidCount, binCounts: expected.histogramCounts };
  const reference: CalculationReference = {
    schemaVersion: 1,
    fixtureSha256: 'hand-verified',
    acquisitions: {
      'reference-before': { ...dataset.acquisitions[0].summary!, coverageFraction: expected.beforeCoverageFraction },
      'reference-missing': null,
      'reference-after': { ...dataset.acquisitions[2].summary!, coverageFraction: expected.afterCoverageFraction },
    },
    spatialDomainDb: expected.spatialDomainDb,
    histogramEdgesDb: dataset.histogramEdgesDb,
    pairs: [pair],
  };
  await expectOptionAvailability(page, pair, dataset);
  await expectLinkedPair(page, pair, reference, {}, dataset);
  await expectNoOverflow(page);
});
