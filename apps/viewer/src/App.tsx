import type { Replay } from "@bench/sim";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RaceList } from "./components/RaceList.js";
import { decodeReplay, fetchEventResults, fetchReplay } from "./lib/load.js";
import { buildModel } from "./lib/model.js";
import { eventOf, paramsForReplay, parseParams } from "./lib/params.js";
import type { EventResults } from "./lib/results.js";
import { Viewer } from "./Viewer.js";

export function App() {
  const params = useMemo(() => parseParams(window.location.search), []);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [gen, setGen] = useState(0);
  const [fromUrl, setFromUrl] = useState(false);
  const [results, setResults] = useState<EventResults | null>(null);
  // StrictMode runs effects twice in development; fetch the URL's replay once (issue 8).
  const requested = useRef<string | null>(null);

  const loadUrl = useCallback((url: string) => {
    if (requested.current === url) return;
    requested.current = url;
    setLoading(url);
    setError(null);
    fetchEventResults(url).then(setResults);
    fetchReplay(url)
      .then((r) => {
        setReplay(r);
        setFromUrl(true);
        setGen((g) => g + 1);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(null));
  }, []);

  useEffect(() => {
    if (params.replay) loadUrl(params.replay);
  }, [params, loadUrl]);

  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDrag(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDrag(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDrag(false);
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      setLoading(file.name);
      setError(null);
      file
        .arrayBuffer()
        .then(decodeReplay)
        .then((r) => {
          setReplay(r);
          setResults(null);
          setFromUrl(false);
          setGen((g) => g + 1);
        })
        .catch((err: Error) => setError(`${file.name}: ${err.message}`))
        .finally(() => setLoading(null));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const model = useMemo(() => (replay ? buildModel(replay) : null), [replay]);

  return (
    <>
      {model ? (
        <Viewer
          key={gen}
          model={model}
          backHref={window.location.pathname}
          backLabel={(fromUrl && eventOf(params.replay)) || "All races"}
          params={paramsForReplay(params, fromUrl)}
          results={fromUrl ? results : null}
        />
      ) : null}
      {!model && !params.replay && !drag ? <RaceList error={error} loading={loading} /> : null}
      {(!model && (params.replay || drag)) || (model && (drag || error || loading)) ? (
        <div className={`dropzone${drag ? " drag" : ""}${model ? " over" : ""}`}>
          <div className="drop-card panel">
            <div className="brand">GRAND PROMPT</div>
            <h1>Replay viewer</h1>
            {loading ? (
              <p>Loading {loading}…</p>
            ) : (
              <p>Drop a replay.json or replay.json.gz here, or open with ?replay=&lt;url&gt;.</p>
            )}
            {error ? <p className="error">{error}</p> : null}
            {params.replay ? (
              <p>
                <a href={window.location.pathname}>← All races</a>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
