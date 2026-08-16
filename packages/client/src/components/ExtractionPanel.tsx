import { createSignal, Show } from 'solid-js';
import type { ConceptModel, FlowModel } from '@archwire/core';
import type { Accessor } from 'solid-js';
import type { SSEEvent } from '../api/client';
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
  const [streamText, setStreamText] = createSignal('');

  let streamRef: HTMLPreElement | undefined;

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

  function handleEvent(evt: SSEEvent) {
    if (evt.phase === 'token' && evt.token) {
      setStreamText(prev => prev + evt.token);
      // auto-scroll the stream view
      if (streamRef) streamRef.scrollTop = streamRef.scrollHeight;
    } else if (evt.phase === 'error') {
      setError(evt.message ?? 'unknown error');
    } else if (evt.phase === 'done') {
      props.onDataReload(props.repoId);
    } else {
      setPhase(evt.phase ?? null);
      setMessage(evt.message ?? null);
      if (evt.current != null && evt.total != null) {
        setProgress({ current: evt.current, total: evt.total });
      }
      // reset stream text on phase change (new LLM call starting)
      if (evt.phase && evt.phase !== 'token') {
        setStreamText('');
      }
    }
  }

  async function handleExtractConcepts() {
    setExtracting(true);
    setError(null);
    setPhase(null);
    setMessage(null);
    setProgress(null);
    setStreamText('');
    try {
      await api.extractConcepts(props.repoId, handleEvent);
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
    setStreamText('');
    try {
      await api.extractFlows(props.repoId, handleEvent);
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
          <div class="extraction-status">
            <div class="extraction-status-row">
              <div class="extraction-spinner" />
              <Show when={phase()}>
                <span class="extraction-phase">{phase()}</span>
              </Show>
              <Show when={message()}>
                <span class="extraction-message">{message()}</span>
              </Show>
            </div>
            <Show when={progress()}>
              {(p) => (
                <div class="extraction-bar-wrap">
                  <div class="extraction-bar" style={{ width: `${Math.round((p().current / p().total) * 100)}%` }} />
                  <span class="extraction-bar-label">{p().current}/{p().total}</span>
                </div>
              )}
            </Show>
          </div>
          <Show when={streamText().length > 0}>
            <pre class="extraction-stream" ref={streamRef}>{streamText()}</pre>
          </Show>
        </div>
      </Show>

      <Show when={error()}>
        <div class="extraction-error">{error()}</div>
      </Show>
    </div>
  );
}
