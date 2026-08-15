import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import * as monaco from 'monaco-editor';

window.MonacoEnvironment = {
  getWorker: () => new Worker(new URL('./editor.worker.js', import.meta.url), { type: 'module' }),
};

export interface DiffFile {
  path: string;
  original: string;
  modified: string;
}

function detectLang(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  const m: Record<string, string> = {
    rs: 'rust', ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', toml: 'toml', yaml: 'yaml', yml: 'yaml', md: 'markdown',
    css: 'css', html: 'html', py: 'python', sh: 'shell', bash: 'shell',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', go: 'go', rb: 'ruby',
    xml: 'xml', sql: 'sql', graphql: 'graphql', proto: 'protobuf',
  };
  return m[ext] ?? 'plaintext';
}

function shortName(p: string): string {
  const parts = p.split('/');
  return parts.length > 2 ? parts.slice(-2).join('/') : p;
}

export default function DiffModal(props: {
  files: DiffFile[];
  codeRefPath: string;
  branch: string;
  onClose: () => void;
}) {
  let container: HTMLDivElement | undefined;
  let diffEditor: monaco.editor.IStandaloneDiffEditor | undefined;
  const models: { original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel }[] = [];
  const [activeIdx, setActiveIdx] = createSignal(0);

  onMount(() => {
    if (!container || !props.files.length) return;

    for (const file of props.files) {
      const lang = detectLang(file.path);
      models.push({
        original: monaco.editor.createModel(file.original, lang),
        modified: monaco.editor.createModel(file.modified, lang),
      });
    }

    diffEditor = monaco.editor.createDiffEditor(container, {
      theme: 'vs-dark',
      readOnly: true,
      renderSideBySide: true,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      fontSize: 12,
      lineHeight: 18,
      padding: { top: 8 },
      stickyScroll: { enabled: false },
    });

    diffEditor.setModel(models[0]);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  createEffect(on(activeIdx, (idx) => {
    if (diffEditor && models[idx]) diffEditor.setModel(models[idx]);
  }, { defer: true }));

  onCleanup(() => {
    diffEditor?.dispose();
    for (const m of models) {
      m.original.dispose();
      m.modified.dispose();
    }
  });

  return (
    <div class="diff-overlay" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class="diff-modal">
        <div class="diff-header">
          <div class="diff-header-info">
            <span class="diff-branch">{props.branch}</span>
            <span class="diff-path">{props.files[activeIdx()]?.path ?? props.codeRefPath}</span>
          </div>
          <button class="diff-close" onClick={props.onClose}>✕</button>
        </div>
        <Show when={props.files.length > 1}>
          <div class="diff-tabs">
            <For each={props.files}>
              {(file, i) => (
                <button
                  class="diff-tab"
                  classList={{ active: activeIdx() === i() }}
                  onClick={() => setActiveIdx(i())}
                >
                  {shortName(file.path)}
                </button>
              )}
            </For>
          </div>
        </Show>
        <div class="diff-body" ref={container} />
      </div>
    </div>
  );
}
