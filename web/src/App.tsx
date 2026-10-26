import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { Acquisition, StudyDataset } from '../../contracts/dataset';
import { analyzePair } from './analysis';
import { loadDataset } from './dataset';
import {
  defaultViewState,
  parseViewState,
  serializeViewState,
  type ViewState,
} from './viewState';
import { DataTable } from './components/DataTable';

const TimeSeries = lazy(() =>
  import('./components/Charts').then((m) => ({ default: m.TimeSeries })),
);
const Coverage = lazy(() =>
  import('./components/Charts').then((m) => ({ default: m.Coverage })),
);
const Histogram = lazy(() =>
  import('./components/Charts').then((m) => ({ default: m.Histogram })),
);
const SpatialGrid = lazy(() =>
  import('./components/Charts').then((m) => ({ default: m.SpatialGrid })),
);

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; dataset: StudyDataset }
  | { status: 'error'; message: string };

/** Explain the synthetic provenance and scientific limits alongside the plots. */
function Methods() {
  return (
    <div className="methods-copy">
      <p>
        <strong>Radar change is not a flood classification.</strong> Radar
        backscatter can respond to surface water, soil moisture, vegetation
        structure, and roughness. These plots do not measure flooded area.
      </p>
      <p>
        This preview is a deterministic synthetic fixture on a schematic 20 × 20
        grid. It has no geographic coordinates, satellite measurements, or NISAR
        product IDs. Louisiana wetlands is the target for the next real-data
        milestone.
      </p>
      <p>
        Python converts valid positive power using 10 log₁₀(power) and prepares
        each acquisition’s spatial median and quartiles. The shaded 25th–75th
        percentile band is the <strong>spatial interquartile range</strong>, not
        a confidence interval. Missing acquisitions are left as gaps.
      </p>
      <p>
        The browser subtracts before from after for cells valid in both
        acquisitions, then counts those differences in fixed histogram bins.
        Coverage is valid pixels divided by the fixed study-mask area; it is not
        accuracy.
      </p>
      <p>
        For the next milestone, see the{' '}
        <a
          href="https://nisar-docs.asf.alaska.edu/gcov/"
          target="_blank"
          rel="noreferrer"
        >
          ASF GCOV guide
        </a>{' '}
        and{' '}
        <a
          href="https://nisar-docs.asf.alaska.edu/access-overview/"
          target="_blank"
          rel="noreferrer"
        >
          data access guide
        </a>
        .
      </p>
    </div>
  );
}

/** Keep provenance visible through loading, validation errors, and the ready workbench. */
export function App() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [methodsOpen, setMethodsOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    loadDataset(controller.signal).then(
      (dataset) => {
        if (!controller.signal.aborted) setLoad({ status: 'ready', dataset });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoad({
            status: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'The data package could not be loaded.',
          });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  return (
    <>
      <a className="skip-link" href="#analysis">
        Skip to analysis
      </a>
      <header className="app-header">
        <h1>NISAR Surface Change</h1>
        <nav aria-label="Workbench">
          <a href="#methods" onClick={() => setMethodsOpen(true)}>
            Methods
          </a>
          {load.status === 'ready' ? (
            <a href="#data-table" onClick={() => setTableOpen(true)}>
              Data table
            </a>
          ) : null}
        </nav>
      </header>
      <section className="preview-banner" aria-label="Data provenance">
        <strong>Synthetic preview — no satellite measurements</strong>
        <p>
          Louisiana wetlands is the target study area. This preview uses a
          schematic grid.
        </p>
      </section>
      {load.status === 'ready' ? (
        <Workbench
          dataset={load.dataset}
          tableOpen={tableOpen}
          setTableOpen={setTableOpen}
        />
      ) : (
        <main id="analysis" className="load-state">
          {load.status === 'loading' ? (
            <p role="status">Loading the synthetic data package…</p>
          ) : (
            <div role="alert">
              <h2>Data package unavailable</h2>
              <p>{load.message}</p>
              <button
                onClick={() => {
                  setLoad({ status: 'loading' });
                  setAttempt((n) => n + 1);
                }}
              >
                Retry loading
              </button>
            </div>
          )}
        </main>
      )}
      <footer className="app-footer">
        <details
          id="methods"
          open={methodsOpen}
          onToggle={(e) => setMethodsOpen(e.currentTarget.open)}
        >
          <summary>Methods and provenance</summary>
          <Methods />
        </details>
        <p>
          Preview source: deterministic synthetic fixture · No NISAR product IDs
        </p>
      </footer>
    </>
  );
}

/** Coordinate one selected acquisition pair across charts, tables, and browser history. */
function Workbench({
  dataset,
  tableOpen,
  setTableOpen,
}: {
  dataset: StudyDataset;
  tableOpen: boolean;
  setTableOpen: (open: boolean) => void;
}) {
  const [state, setState] = useState(() =>
    parseViewState(window.location.search, dataset),
  );
  const [settingsOpen, setSettingsOpen] = useState(
    () => window.matchMedia('(min-width: 801px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width: 801px)');
    const onChange = () => setSettingsOpen(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    const onPop = () =>
      setState(parseViewState(window.location.search, dataset));
    const initial = parseViewState(window.location.search, dataset);
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${serializeViewState(initial, window.location.search)}${window.location.hash}`,
    );
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [dataset]);
  function update(next: ViewState) {
    window.history.pushState(
      null,
      '',
      `${window.location.pathname}${serializeViewState(next, window.location.search)}${window.location.hash}`,
    );
    setState(next);
  }
  const before = dataset.acquisitions.find((a) => a.id === state.beforeId)!;
  const after = dataset.acquisitions.find((a) => a.id === state.afterId)!;
  const pair = useMemo(
    () => analyzePair(dataset, before, after),
    [dataset, before, after],
  );

  const select = (kind: 'before' | 'after', selected: Acquisition) => (
    <label className="date-control" htmlFor={kind}>
      <span>{kind === 'before' ? 'Before' : 'After'}</span>
      <select
        id={kind}
        value={selected.id}
        onChange={(e) =>
          update({
            ...state,
            [kind === 'before' ? 'beforeId' : 'afterId']: e.target.value,
          })
        }
      >
        {dataset.acquisitions.map((a) => (
          <option
            key={a.id}
            value={a.id}
            disabled={
              a.availability === 'missing' ||
              (kind === 'before' ? a.day >= after.day : a.day <= before.day)
            }
          >
            Day {a.day}
            {a.availability === 'missing' ? ' · missing' : ''}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <main id="analysis" className="workspace">
      <aside className="controls" aria-label="Study controls">
        <details
          className="study-settings"
          open={settingsOpen}
          onToggle={(e) => setSettingsOpen(e.currentTarget.open)}
        >
          <summary>Study settings</summary>
          <div className="study-settings-body">
            <p className="field-label">Study area</p>
            <p className="readonly-field">Louisiana wetlands</p>
            <p className="field-label">
              Preview polarization <span>(read-only)</span>
            </p>
            <p className="readonly-field">{dataset.polarization}</p>
          </div>
        </details>
        <div className="date-controls">
          {select('before', before)}
          {select('after', after)}
        </div>
        <button
          className="reset-button"
          onClick={() => update(defaultViewState(dataset))}
        >
          Reset view
        </button>
        <div className="science-note">
          <strong>Radar change is not a flood classification.</strong>
          <p>
            Changes in radar backscatter can arise from multiple factors,
            including surface water, soil moisture, vegetation structure, and
            roughness.
          </p>
        </div>
      </aside>
      <div className="evidence">
        <Suspense
          fallback={
            <p className="plots-loading" role="status">
              Preparing the linked plots…
            </p>
          }
        >
          <section
            className="time-panel"
            aria-labelledby="time-heading"
            data-testid="time-series"
          >
            <h2 id="time-heading">Backscatter through time</h2>
            <TimeSeries
              dataset={dataset}
              beforeId={before.id}
              afterId={after.id}
            />
          </section>
          <section
            className="coverage-panel"
            aria-labelledby="coverage-heading"
          >
            <h2 id="coverage-heading">Acquisition coverage</h2>
            <Coverage
              dataset={dataset}
              beforeId={before.id}
              afterId={after.id}
            />
          </section>
          <section className="spatial-panel" aria-labelledby="spatial-heading">
            <h2 id="spatial-heading">Spatial comparison</h2>
            <div
              className="view-controls"
              role="group"
              aria-label="Spatial comparison view"
            >
              {(['before', 'after', 'change'] as const).map((view) => (
                <button
                  key={view}
                  aria-pressed={state.view === view}
                  onClick={() => update({ ...state, view })}
                >
                  {view[0].toUpperCase() + view.slice(1)}
                </button>
              ))}
            </div>
            <SpatialGrid
              dataset={dataset}
              before={before}
              after={after}
              pair={pair}
              view={state.view}
            />
          </section>
          <section
            className="histogram-panel"
            aria-labelledby="hist-heading"
            data-testid="histogram"
          >
            <div className="panel-heading">
              <h2 id="hist-heading">Backscatter change distribution</h2>
              <div className="comparison-info" aria-live="polite">
                <p data-testid="comparison-label">
                  Day {after.day} minus Day {before.day}
                </p>
                <span data-testid="paired-count">
                  {pair.validCount} paired valid pixels
                </span>
              </div>
            </div>
            {pair.validCount === 0 ? (
              <p className="empty-state" role="status">
                No overlapping valid cells for this pair. Select another
                comparison.
              </p>
            ) : (
              <Histogram pair={pair} edges={dataset.histogramEdgesDb} />
            )}
          </section>
        </Suspense>
        <details
          id="data-table"
          className="data-table"
          open={tableOpen}
          onToggle={(e) => setTableOpen(e.currentTarget.open)}
        >
          <summary>Data table</summary>
          <DataTable
            dataset={dataset}
            before={before}
            after={after}
            pair={pair}
          />
        </details>
      </div>
    </main>
  );
}
