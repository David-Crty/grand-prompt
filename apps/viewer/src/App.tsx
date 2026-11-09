import type { Replay } from "@bench/sim";
import { useCallback, useEffect, useMemo, useState } from "react";
import { decodeReplay, fetchReplay } from "./lib/load.js";
import { buildModel } from "./lib/model.js";
import { parseParams } from "./lib/params.js";
import { Viewer } from "./Viewer.js";

const DEV_DEFAULT = "/results/demo/replay.json.gz";

export function App() {
  const params = useMemo(() => parseParams(window.location.search), []);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [gen, setGen] = useState(0);

  const loadUrl = useCallback((url: string) => {
    setLoading(url);
    setError(null);
    fetchReplay(url)
      .then((r) => {
        setReplay(r);
        setGen((g) => g + 1);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(null));
  }, []);

  useEffect(() => {
    const url = params.replay ?? (import.meta.env.DEV ? DEV_DEFAULT : null);
    if (url) loadUrl(url);
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
          params={gen > 1 ? { ...params, t: null, cam: null, car: null } : params}
        />
      ) : null}
      {!model || drag || error || loading ? (
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
          </div>
        </div>
      ) : null}
    </>
  );
}
