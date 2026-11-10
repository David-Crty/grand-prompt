import { Button, Dropdown, StarLink, Wordmark } from "@bench/ui/react";
import { type MouseEvent, useEffect, useMemo, useState } from "react";
import { pickEvent, type RaceIndex, readReveal, writeReveal } from "../lib/races.js";
import { INDEX_URL, parseRoute, REPO_URL, type Route, routeHref } from "../lib/route.js";
import { DriverList } from "./DriverList.js";
import { RaceList } from "./RaceList.js";
import { ResultPage } from "./ResultPage.js";
import { StarNote } from "./StarNote.js";

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** The pages under one top bar, all reading `/results/index.json`: races, drivers, and one race's results. */
type ListPage = "races" | "drivers";

const readRoute = (): Route => parseRoute(window.location.pathname, window.location.search);

export function Home() {
  const [route, setRoute] = useState<Route>(readRoute);
  const page: ListPage = route.page === "drivers" ? "drivers" : "races";
  /** The event asked for in the address, if any; a results page's own event carries over to the lists. */
  const asked = route.page === "race" ? undefined : route.event;
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
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const event = index ? pickEvent(asked, index.events ?? [], index.defaultEvent ?? null) : null;
  const races = useMemo(() => index?.races.filter((r) => r.event === event) ?? [], [index, event]);
  const drivers = useMemo(() => index?.drivers?.filter((d) => d.event === event) ?? [], [index, event]);
  /** The address keeps the event only when it is not the default, so the plain URLs stay plain. */
  const href = (to: ListPage, ev: string | null | undefined = asked) =>
    routeHref({ page: to, ...(ev && ev !== index?.defaultEvent ? { event: ev } : {}) });

  const visit = (path: string) => {
    if (path !== window.location.pathname + window.location.search) window.history.pushState(null, "", path);
    setRoute(readRoute());
  };
  const go = (to: ListPage) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    visit(href(to));
  };
  const choose = (ev: string) => visit(href(page, ev));
  const picker =
    index && event && index.events.length > 1 ? (
      <Dropdown
        options={index.events.map((e) => ({ value: e, label: e }))}
        value={event}
        onChange={choose}
        label="Event"
        icon="flag"
      />
    ) : null;
  const toggle = () => {
    writeReveal(storage(), !shown);
    setShown(!shown);
  };
  const link = (to: ListPage, label: string) => (
    <a
      className="home-nav__link"
      href={href(to)}
      aria-current={page === to ? (route.page === "result" ? "true" : "page") : undefined}
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
          route.page === "result" ? (
            <ResultPage
              index={index}
              track={route.track}
              event={route.event}
              shown={shown}
              onShow={toggle}
              onOpen={(track, event) => visit(routeHref({ page: "result", track, event }))}
            />
          ) : page === "drivers" ? (
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
