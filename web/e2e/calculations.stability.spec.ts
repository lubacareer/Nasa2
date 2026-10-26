import { expect, test } from '@playwright/test';
import { performance } from 'node:perf_hooks';
import { expectLinkedPair, expectNoOverflow, loadReference, selectPair } from './calculation-reference';

const requestedDuration = Number(process.env.STABILITY_DURATION_MS ?? 600_000);
if (!Number.isFinite(requestedDuration) || requestedDuration <= 0 || requestedDuration > 600_000) {
  throw new Error('STABILITY_DURATION_MS must be positive and no greater than 600000. Full acceptance runs require exactly 600000.');
}

test('sustained independent numerical comparisons remain linked through repeated interaction', async ({ page }, testInfo) => {
  const reference = loadReference();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // A fixed permutation makes every complete cycle cover all 28 pairs reproducibly.
  let seed = 0x4e495341;
  const order = [...reference.pairs];
  for (let index = order.length - 1; index > 0; index--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const target = seed % (index + 1);
    [order[index], order[target]] = [order[target], order[index]];
  }
  let comparisons = 0;
  let cycles = 0;
  let lastProgress = 0;
  const recent: { before: string; after: string; elapsedMs: number }[] = [];
  const start = performance.now();
  try {
    await page.goto('/');
    do {
      for (const pair of order) {
        await selectPair(page, pair.beforeId, pair.afterId);
        await expectLinkedPair(page, pair, reference);
        comparisons++;
        cycles = Math.floor(comparisons / order.length);
        recent.push({ before: pair.beforeId, after: pair.afterId, elapsedMs: Math.round(performance.now() - start) });
        if (recent.length > 56) recent.shift();
        expect(errors, 'unexpected browser errors during sustained calculations').toEqual([]);

        if (comparisons % 4 === 0) {
          await page.getByRole('button', { name: 'Before', exact: true }).click();
          await page.goBack();
          await expect(page.getByTestId('spatial-grid')).toHaveAttribute('data-view', 'change');
          await page.goForward();
          await expect(page.getByTestId('spatial-grid')).toHaveAttribute('data-view', 'before');
          await page.getByRole('button', { name: 'Change', exact: true }).click();
          await expectLinkedPair(page, pair, reference, { modes: false, tables: false });
        }
        if (comparisons % 7 === 0) {
          await page.reload();
          await expectLinkedPair(page, pair, reference, { modes: false, tables: false });
        }
        if (comparisons % 5 === 0) {
          await page.setViewportSize(comparisons % 10 === 0 ? { width: 1448, height: 1086 } : { width: 390, height: 844 });
          await expectNoOverflow(page);
          const methods = page.locator('#methods');
          await methods.locator(':scope > summary').click();
          await expect(methods).toHaveAttribute('open', '');
          await methods.locator(':scope > summary').click();
        }
        if (comparisons % 9 === 0) {
          await page.getByRole('button', { name: 'Reset view', exact: true }).click();
          const defaults = reference.pairs.find((item) => item.beforeDay === 25 && item.afterDay === 61)!;
          await expectLinkedPair(page, defaults, reference, { modes: false, tables: false });
        }
        if (performance.now() - start - lastProgress >= 60_000) {
          lastProgress = performance.now() - start;
          console.log(`${testInfo.project.name}: ${Math.floor(lastProgress / 1000)}s, ${comparisons} numerical comparisons, ${cycles} complete 28-pair cycles.`);
        }
        if (performance.now() - start >= requestedDuration && cycles >= 1) break;
      }
    } while (performance.now() - start < requestedDuration || cycles < 1);
    expect(cycles, 'at least one complete cycle is required').toBeGreaterThanOrEqual(1);
    expect(performance.now() - start, 'the requested real-time stability duration must elapse').toBeGreaterThanOrEqual(requestedDuration);
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach('stability-session.json', {
      body: JSON.stringify({ requestedDurationMs: requestedDuration, acceptanceDuration: requestedDuration === 600_000, elapsedMs: Math.round(performance.now() - start), comparisons, completedCycles: cycles, skippedScenarios: [], errors, recent }, null, 2),
      contentType: 'application/json',
    });
    console.log(`${testInfo.project.name}: completed ${comparisons} numerical comparisons and ${cycles} full cycles in ${Math.round((performance.now() - start) / 1000)}s; requested ${requestedDuration / 1000}s.`);
  }
});
