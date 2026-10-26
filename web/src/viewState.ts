import type { Acquisition, StudyDataset } from '../../contracts/dataset';

export type SpatialView = 'before' | 'after' | 'change';

export interface ViewState {
  beforeId: string;
  afterId: string;
  view: SpatialView;
}

export function availableAcquisitions(dataset: StudyDataset): Acquisition[] {
  return dataset.acquisitions.filter((acquisition) => acquisition.availability === 'available' && acquisition.valuesDb !== null);
}

export function defaultViewState(dataset: StudyDataset): ViewState {
  const available = availableAcquisitions(dataset);
  if (available.length < 2) throw new Error('At least two available acquisitions are required.');
  const before = available.find((acquisition) => acquisition.day === 25) ?? available[0];
  const after = available.find((acquisition) => acquisition.day === 61 && acquisition.day > before.day)
    ?? available.find((acquisition) => acquisition.day > before.day);
  return {
    beforeId: after ? before.id : available[0].id,
    afterId: after?.id ?? available[available.length - 1].id,
    view: 'change',
  };
}

export function parseViewState(search: string, dataset: StudyDataset): ViewState {
  const defaults = defaultViewState(dataset);
  const parameters = new URLSearchParams(search);
  const available = availableAcquisitions(dataset);
  const before = available.find((acquisition) => acquisition.id === parameters.get('before'));
  const after = available.find((acquisition) => acquisition.id === parameters.get('after'));
  const requestedView = parameters.get('view');
  const view = requestedView === 'before' || requestedView === 'after' || requestedView === 'change'
    ? requestedView : 'change';
  return before && after && before.day < after.day
    ? { beforeId: before.id, afterId: after.id, view }
    : { ...defaults, view };
}

/** Returns a query string, preserving unrelated query parameters. */
export function serializeViewState(state: ViewState, currentSearch = ''): string {
  const parameters = new URLSearchParams(currentSearch);
  parameters.set('before', state.beforeId);
  parameters.set('after', state.afterId);
  parameters.set('view', state.view);
  return `?${parameters.toString()}`;
}
