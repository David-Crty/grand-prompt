import { Button, Dropdown, StarLink, Wordmark } from "@bench/ui/react";
import { type MouseEvent, useEffect, useMemo, useState } from "react";
import { pickEvent, type RaceIndex, readReveal, writeReveal } from "../lib/races.js";
import { parseRoute, REPO_URL, routeHref } from "../lib/route.js";
import { DriverList } from "./DriverList.js";
import { RaceList } from "./RaceList.js";
import { StarNote } from "./StarNote.js";

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

/** The event asked for in the address, if any. */
const askedEvent = (): string | undefined => {
  const r = parseRoute(window.location.pathname, window.location.search);
  return r.page === "race" ? undefined : r.event;
};

export function Home() {
  const [page, setPage] = useState<HomePage>(() => pageOf(window.location.pathname));
  const [asked, setAsked] = useState(askedEvent);
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
    const onPop = () => {
      setPage(pageOf(window.location.pathname));
      setAsked(askedEvent());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const event = index ? pickEvent(asked, index.events ?? [], index.defaultEvent ?? null) : null;
  const races = useMemo(() => index?.races.filter((r) => r.event === event) ?? [], [index, event]);
  const drivers = useMemo(() => index?.drivers?.filter((d) => d.event === event) ?? [], [index, event]);
  /** The address keeps the event only when it is not the default, so the plain URLs stay plain. */
  const href = (to: HomePage, ev: string | null | undefined = asked) =>
    routeHref({ page: to, ...(ev && ev !== index?.defaultEvent ? { event: ev } : {}) });

  const go = (to: HomePage) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (to !== page) window.history.pushState(null, "", href(to));
    setPage(to);
  };
  const choose = (ev: string) => {
    window.history.pushState(null, "", href(page, ev));
    setAsked(ev);
  };
  const picker =
    index && event && index.events.length > 1 ? (
      <Dropdown
        options={index.events.map((e) => ({ value: e, label: e }))}
        value={event}
        onChange={choose}
        label="Event"
      />
    ) : null;
  const toggle = () => {
    writeReveal(storage(), !shown);
    setShown(!shown);
  };
  const link = (to: HomePage, label: string) => (
    <a
      className="home-nav__link"
      href={href(to)}
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
        <StarLink className="home-star" href={REPO_URL} />
        <Button className="home-reveal" aria-pressed={shown} onClick={toggle}>
          {shown ? "Hide results" : "Show results"}
        </Button>
      </header>
      <main className="home-page">
        {failed ? <p className="home-note error">Could not list races: {failed}</p> : null}
        {!index && !failed ? <p className="home-note">Looking for races…</p> : null}
        {index ? (
          page === "drivers" ? (
            <DriverList drivers={drivers} shown={shown} picker={picker} />
          ) : (
            <RaceList races={races} shown={shown} picker={picker} />
          )
        ) : null}
      </main>
      <footer className="home-foot">
        <StarNote />
      </footer>
    </div>
  );
}
