import Ajv2020 from 'ajv/dist/2020';
import schema from '../../contracts/study-dataset.schema.json';
import type { StudyDataset } from '../../contracts/dataset';

const validate = new Ajv2020({ allErrors: true }).compile<StudyDataset>(schema);

/** Independently check producer summaries using the contract's type 7 quantile. */
function validationQuantile(
  sorted: readonly number[],
  probability: number,
): number {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  const span = sorted[upper] - sorted[lower];
  // Opposite finite extremes can overflow their difference even when the quantile is finite.
  return Number.isFinite(span)
    ? sorted[lower] + span * fraction
    : sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

/** Reject malformed or inconsistent handoffs without replacing Python's prepared values. */
export function validateDataset(value: unknown): StudyDataset {
  if (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion !== 1
  ) {
    throw new Error(
      `Unsupported data package version: ${String(value.schemaVersion)}. This app supports version 1.`,
    );
  }
  if (!validate(value)) {
    throw new Error(
      `Invalid data package: ${validate.errors?.[0]?.instancePath || '/'} ${validate.errors?.[0]?.message || 'schema validation failed'}.`,
    );
  }
  const size = value.grid.width * value.grid.height;
  if (value.grid.roiMask.length !== size)
    throw new Error(
      'Invalid data package: grid mask size does not match its dimensions.',
    );
  if (!value.grid.roiMask.some(Boolean))
    throw new Error(
      'Invalid data package: the study mask must contain at least one cell.',
    );
  const ids = new Set<string>();
  let previousDay = -Infinity;
  for (const acquisition of value.acquisitions) {
    if (ids.has(acquisition.id) || acquisition.day <= previousDay) {
      throw new Error(
        'Invalid data package: acquisition IDs must be unique and days strictly ordered.',
      );
    }
    ids.add(acquisition.id);
    previousDay = acquisition.day;
    if (acquisition.availability === 'missing') continue;
    const { valuesDb, summary } = acquisition;
    if (!valuesDb || valuesDb.length !== size)
      throw new Error(
        'Invalid data package: acquisition grid size is inconsistent.',
      );
    let validCount = 0;
    const validValues: number[] = [];
    for (let i = 0; i < size; i++) {
      if (valuesDb[i] !== null) {
        if (!value.grid.roiMask[i])
          throw new Error(
            'Invalid data package: a cell outside the study mask contains data.',
          );
        validCount++;
        validValues.push(valuesDb[i] as number);
      }
    }
    if (validCount === 0) {
      if (summary !== null)
        throw new Error(
          'Invalid data package: an empty acquisition must have a null summary.',
        );
      continue;
    }
    validValues.sort((a, b) => a - b);
    if (
      !summary ||
      summary.validCount !== validCount ||
      summary.q25Db > summary.medianDb ||
      summary.medianDb > summary.q75Db ||
      Math.abs(summary.medianDb - validationQuantile(validValues, 0.5)) >
        1e-9 ||
      Math.abs(summary.q25Db - validationQuantile(validValues, 0.25)) > 1e-9 ||
      Math.abs(summary.q75Db - validationQuantile(validValues, 0.75)) > 1e-9
    ) {
      throw new Error(
        'Invalid data package: inconsistent acquisition summary.',
      );
    }
  }
  if (
    value.acquisitions.filter((a) => a.availability === 'available').length < 2
  ) {
    throw new Error(
      'Invalid data package: at least two available acquisitions are required.',
    );
  }
  const edges = value.histogramEdgesDb;
  if (
    edges[0] >= 0 ||
    edges.some(
      (edge, index) =>
        (index > 0 && edge <= edges[index - 1]) ||
        Math.abs(edge + edges[edges.length - 1 - index]) > 1e-9,
    )
  ) {
    throw new Error(
      'Invalid data package: histogram edges must increase and have a symmetric range.',
    );
  }
  // Every possible selected pair must fit the shared histogram range.
  for (let i = 0; i < size; i++) {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const acquisition of value.acquisitions) {
      const cell = acquisition.valuesDb?.[i];
      if (cell == null) continue;
      minimum = Math.min(minimum, cell);
      maximum = Math.max(maximum, cell);
    }
    if (
      minimum !== Infinity &&
      maximum - minimum > edges.at(-1)!
    ) {
      throw new Error(
        'Invalid data package: histogram edges do not cover all paired changes.',
      );
    }
  }
  return value;
}

/** Load the local preview with cancellation; JSON and contract failures stay user-visible. */
export async function loadDataset(signal: AbortSignal): Promise<StudyDataset> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/preview.json`, {
    signal,
  });
  if (!response.ok)
    throw new Error(
      `Data package could not be loaded (HTTP ${response.status}).`,
    );
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error('Malformed data package: the response is not valid JSON.');
  }
  return validateDataset(value);
}
