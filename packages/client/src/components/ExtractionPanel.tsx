import { createSignal, Show } from 'solid-js';
import type { ConceptModel, FlowModel } from '@archwire/core';
import type { Accessor } from 'solid-js';
import * as api from '../api/client';

interface ExtractionPanelProps {
  repoId: string;
  concepts: Accessor<ConceptModel | null>;
  flows: Accessor<FlowModel | null>;
  onDataReload: (repoId: string) => Promise<void>;
}

export function ExtractionPanel(props: ExtractionPanelProps) {
  const [extracting, setExtracting] = createSignal(false);
  const [phase, setPhase] = createSignal<string | null>(null);
  const [message, setMessage] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal<{ current: number; total: number } | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const hasConcepts = () => {
    const c = props.concepts();
    return c !== null && c.concepts.length > 0;
  };

  const hasFlows = () => {
    const f = props.flows();
    return f !== null && f.flows.length > 0;
  };

  const showConceptBtn = () => !hasConcepts() && !extracting();
  const showFlowBtn = () => hasConcepts() && !hasFlows() && !extracting();

  async function handleExtractConcepts() {
    setExtracting(true);
    setError(null);
    setPhase(null);
    setMessage(null);
    setProgress(null);
    try {
      await api.extractConcepts(props.repoId, (evt) => {
        setPhase(evt.phase);
        setMessage(evt.message);
        if (evt.phase === 'error') {
          setError(evt.message);
        }
        if (evt.phase === 'done') {
          props.onDataReload(props.repoId);
        }
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExtracting(false);
    }
  }

  async function handleExtractFlows() {
    setExtracting(true);
    setError(null);
    setPhase(null);
    setMessage(null);
    setProgress(null);
    try {
      await api.extractFlows(props.repoId, (evt) => {
        setPhase(evt.phase);
        setMessage(evt.message);
        if (evt.current != null && evt.total != null) {
          setProgress({ current: evt.current, total: evt.total });
        }
        if (evt.phase === 'error') {
          setError(evt.message);
        }
        if (evt.phase === 'done') {
          props.onDataReload(props.repoId);
        }
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExtracting(false);
    }
  }

  return (
    <div class="extraction-panel">
      <Show when={showConceptBtn()}>
        <button class="ctrl-btn extraction-btn" onClick={handleExtractConcepts} disabled={extracting()}>
          ◈ Generate Concepts
        </button>
      </Show>

      <Show when={showFlowBtn()}>
        <button class="ctrl-btn extraction-btn" onClick={handleExtractFlows} disabled={extracting()}>
          ⇢ Generate Flows
        </button>
      </Show>

      <Show when={extracting()}>
        <div class="extraction-progress">
          <div class="extraction-spinner" />
          <div class="extraction-status">
            <Show when={phase()}>
              <span class="extraction-phase">{phase()}</span>
            </Show>
            <Show when={message()}>
              <span class="extraction-message">{message()}</span>
            </Show>
            <Show when={progress()}>
              {(p) => (
                <div class="extraction-bar-wrap">
                  <div class="extraction-bar" style={{ width: `${Math.round((p().current / p().total) * 100)}%` }} />
                  <span class="extraction-bar-label">{p().current}/{p().total}</span>
                </div>
              )}
            </Show>
          </div>
        </div>
      </Show>

      <Show when={error()}>
        <div class="extraction-error">{error()}</div>
      </Show>
    </div>
  );
}
