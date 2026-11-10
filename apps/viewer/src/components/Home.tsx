import { Button, Wordmark } from "@bench/ui/react";
import { type MouseEvent, useEffect, useState } from "react";
import { type RaceIndex, readReveal, writeReveal } from "../lib/races.js";
import { parseRoute, routeHref } from "../lib/route.js";
import { DriverList } from "./DriverList.js";
import { RaceList } from "./RaceList.js";

const INDEX_URL = "/results/index.json";

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** The home pages, races and drivers, under one top bar; both read `/results/index.json`. */
type HomePage = "races" | "drivers";

const pageOf = (pathname: string): HomePage =>
  parseRoute(pathname).page === "drivers" ? "drivers" : "races";

export function Home() {
  const [page, setPage] = useState<HomePage>(() => pageOf(window.location.pathname));
  const [shown, setShown] = useState(() => readReveal(storage()));
  const [index, setIndex] = useState<RaceIndex | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    fetch(INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${INDEX_URL}`);
        return res.json() as Promise<RaceIndex>;
      })
      .then(setIndex)
      .catch((e: Error) => setFailed(e.message));
  }, []);

  useEffect(() => {
    const onPop = () => setPage(pageOf(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = (to: HomePage) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (to !== page) window.history.pushState(null, "", routeHref({ page: to }));
    setPage(to);
  };
  const toggle = () => {
    writeReveal(storage(), !shown);
    setShown(!shown);
  };
  const link = (to: HomePage, label: string) => (
    <a
      className="home-nav__link"
      href={routeHref({ page: to })}
      aria-current={page === to ? "page" : undefined}
      onClick={go(to)}
    >
      {label}
    </a>
  );

  return (
    <div className="home">
      <header className="home-bar">
        <Wordmark />
        <nav className="home-nav" aria-label="Pages">
          {link("races", "Races")}
          {link("drivers", "Drivers")}
        </nav>
        <Button className="home-reveal" aria-pressed={shown} onClick={toggle}>
          {shown ? "Hide results" : "Show results"}
        </Button>
      </header>
      <main className="home-page">
        {failed ? <p className="home-note error">Could not list races: {failed}</p> : null}
        {!index && !failed ? <p className="home-note">Looking for races…</p> : null}
        {index ? (
          page === "drivers" ? (
            <DriverList drivers={index.drivers ?? []} shown={shown} />
          ) : (
            <RaceList races={index.races} shown={shown} />
          )
        ) : null}
      </main>
    </div>
  );
}
