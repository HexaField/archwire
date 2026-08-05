import { createMemo, createSignal, For, Show } from 'solid-js';
import type { IrModel } from '../lib/ir';

// A file's top-level module: the first two path segments (or the file itself
// when it sits at the root). Keeps the default matrix small and labelled.
function moduleOf(fileId: string): string {
  const p = fileId.split('/');
  if (p.length <= 1) return fileId;
  if (p.length === 2) return p[0];
  return `${p[0]}/${p[1]}`;
}
const baseName = (id: string) => id.split('/').pop() ?? id;

interface Cell {
  count: number;
  cyclic: boolean; // part of a real (file-level) dependency cycle
  mutual: boolean; // both directions exist at this aggregation level
}

// A square dependency matrix: row depends on column.
function Matrix(props: {
  labels: string[];
  cell: (r: number, c: number) => Cell;
  onRowClick?: (r: number) => void;
}) {
  return (
    <div class="matrix-scroll">
      <table class="dsm-table">
        <thead>
          <tr>
            <th class="corner" />
            <For each={props.labels}>{(l) => <th class="colh"><span>{l}</span></th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={props.labels}>
            {(l, r) => (
              <tr>
                <th
                  class="rowh"
                  classList={{ clickable: !!props.onRowClick }}
                  onClick={() => props.onRowClick?.(r())}
                >
                  {l}
                </th>
                <For each={props.labels}>
                  {(_c, c) => {
                    const cell = props.cell(r(), c());
                    const diag = r() === c();
                    return (
                      <td
                        classList={{
                          diag,
                          cyclic: cell.cyclic && !diag,
                          mutual: cell.mutual && !cell.cyclic && !diag,
                          dep: cell.count > 0 && !cell.mutual && !cell.cyclic && !diag,
                        }}
                        title={
                          cell.count > 0 && !diag
                            ? `${props.labels[r()]} → ${props.labels[c()]}  (${cell.count})`
                            : ''
                        }
                      >
                        {!diag && cell.count > 0 ? cell.count : ''}
                      </td>
                    );
                  }}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

export function DsmView(props: { model: IrModel }) {
  const [drill, setDrill] = createSignal<string | null>(null);

  const files = createMemo(() =>
    props.model.nodes.filter((n) => n.kind === 'file').map((n) => n.id),
  );

  const moduleLevel = createMemo(() => {
    const mods = [...new Set(files().map(moduleOf))].sort();
    const idx = new Map(mods.map((m, i) => [m, i]));
    const count = mods.map(() => mods.map(() => 0));
    const cyclic = mods.map(() => mods.map(() => false));
    const mutual = mods.map(() => mods.map(() => false));
    for (const e of props.model.edges) {
      const a = idx.get(moduleOf(e.source));
      const b = idx.get(moduleOf(e.target));
      if (a === undefined || b === undefined) continue;
      count[a][b] += 1;
      if (e.cyclic) cyclic[a][b] = true;
    }
    // mutual = both directions carry at least one dependency (a coupling smell,
    // distinct from a proven file-level cycle).
    for (let a = 0; a < mods.length; a++) {
      for (let b = 0; b < mods.length; b++) {
        if (a !== b && count[a][b] > 0 && count[b][a] > 0) mutual[a][b] = true;
      }
    }
    return { mods, count, cyclic, mutual };
  });

  const fileLevel = createMemo(() => {
    const m = drill();
    if (!m) return null;
    const fs = files()
      .filter((f) => moduleOf(f) === m)
      .sort();
    const idx = new Map(fs.map((f, i) => [f, i]));
    const count = fs.map(() => fs.map(() => 0));
    const cyclic = fs.map(() => fs.map(() => false));
    for (const e of props.model.edges) {
      const a = idx.get(e.source);
      const b = idx.get(e.target);
      if (a === undefined || b === undefined) continue;
      count[a][b] += 1;
      if (e.cyclic) cyclic[a][b] = true;
    }
    return { fs, count, cyclic };
  });

  return (
    <div class="dsm">
      <Show
        when={fileLevel()}
        fallback={
          <>
            <p class="dsm-title">
              module dependencies — row depends on column · click a module name to open it
            </p>
            <Matrix
              labels={moduleLevel().mods.map(baseName)}
              cell={(r, c) => ({
                count: moduleLevel().count[r][c],
                cyclic: moduleLevel().cyclic[r][c],
                mutual: moduleLevel().mutual[r][c],
              })}
              onRowClick={(r) => setDrill(moduleLevel().mods[r])}
            />
          </>
        }
      >
        {(fl) => (
          <>
            <div class="dsm-bar">
              <button onClick={() => setDrill(null)}>← modules</button>
              <span class="dsm-title-inline">
                {baseName(drill() ?? '')} — internal file dependencies
              </span>
            </div>
            <Matrix
              labels={fl().fs.map(baseName)}
              cell={(r, c) => ({
                count: fl().count[r][c],
                cyclic: fl().cyclic[r][c],
                mutual: false,
              })}
            />
          </>
        )}
      </Show>
      <p class="dsm-legend">
        number = dependency count · <span style={{ color: '#3fb950' }}>green</span> one-way ·{' '}
        <span style={{ color: '#d9a441' }}>amber</span> mutual ·{' '}
        <span style={{ color: '#e5484d' }}>red</span> cyclic · grey diagonal = self
      </p>
    </div>
  );
}
