import { createSignal, For, onMount, Show } from 'solid-js';
import * as api from '../api/client';

export function SettingsPanel(props: { onClose: () => void }) {
  const [host, setHost] = createSignal('http://localhost:11434');
  const [model, setModel] = createSignal('');
  const [models, setModels] = createSignal<string[]>([]);
  const [modelsLoading, setModelsLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [testResult, setTestResult] = createSignal<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting] = createSignal(false);
  const [saveMsg, setSaveMsg] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const config = await api.getLlmConfig();
      setHost(config.host);
      setModel(config.model);
    } catch { /* use defaults */ }
    fetchModels();
  });

  async function fetchModels() {
    setModelsLoading(true);
    const prev = model();
    try {
      const res = await api.getLlmModels();
      setModels(res.models);
      // After <For> re-renders the <option> elements, the browser resets the
      // <select> to the first option. SolidJS won't re-apply the value binding
      // because model() hasn't changed. Force a re-sync via microtask.
      queueMicrotask(() => {
        const target = prev && res.models.includes(prev) ? prev : (res.models[0] ?? '');
        setModel('');
        setModel(target);
      });
    } catch {
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testLlm();
      setTestResult(res);
      if (res.models) setModels(res.models);
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function saveHost() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await api.setLlmConfig({ host: host(), model: model() });
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(null), 2000);
      await fetchModels();
    } catch (e) {
      setSaveMsg(`Error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    await saveHost();
  }

  return (
    <div class="settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class="settings-panel">
        <div class="settings-header">
          <h2>LLM Settings</h2>
          <button class="settings-close" onClick={props.onClose}>×</button>
        </div>

        <div class="settings-body">
          <label class="settings-label">Ollama Host</label>
          <input
            type="text"
            class="settings-input"
            value={host()}
            onInput={(e) => setHost(e.currentTarget.value)}
            placeholder="http://localhost:11434"
          />

          <label class="settings-label">Model</label>
          <div class="settings-model-row">
            <select
              class="settings-select"
              value={model()}
              onChange={(e) => setModel(e.currentTarget.value)}
              disabled={modelsLoading()}
            >
              <Show when={!modelsLoading()} fallback={<option>loading…</option>}>
                <Show when={models().length === 0}>
                  <option value="">no models found</option>
                </Show>
                <For each={models()}>
                  {(m) => <option value={m}>{m}</option>}
                </For>
              </Show>
            </select>
            <button class="ctrl-btn" onClick={saveHost} disabled={modelsLoading() || saving()} title="save host & refresh models">↻</button>
          </div>

          <div class="settings-actions">
            <button class="ctrl-btn" onClick={handleTest} disabled={testing()}>
              {testing() ? 'testing…' : 'Test connection'}
            </button>
            <button class="ctrl-btn settings-save-btn" onClick={handleSave} disabled={saving()}>
              {saving() ? 'saving…' : 'Save'}
            </button>
          </div>

          <Show when={testResult()}>
            {(r) => (
              <div class="settings-result" classList={{ 'result-ok': r().ok, 'result-err': !r().ok }}>
                {r().ok ? 'Connection successful' : `Connection failed: ${r().error ?? 'unknown error'}`}
              </div>
            )}
          </Show>

          <Show when={saveMsg()}>
            <div class="settings-result result-ok">{saveMsg()}</div>
          </Show>
        </div>
      </div>
    </div>
  );
}
