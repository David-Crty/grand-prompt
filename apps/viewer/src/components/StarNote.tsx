import { StarLink } from "@bench/ui/react";
import { AUTHOR_URL, REPO_URL } from "../lib/route.js";

/** Who made it, and a star for those who liked it: the foot of the race result, the help and the home pages. */
export function StarNote({ ask, className }: { ask?: string; className?: string }) {
  return (
    <p className={className ? `star-note ${className}` : "star-note"}>
      <span>
        Made with{" "}
        <span role="img" aria-label="love">
          ❤️
        </span>{" "}
        by{" "}
        <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">
          David-Crty
        </a>
      </span>
      <span className="star-note__ask">
        {ask}
        <StarLink href={REPO_URL} />
      </span>
    </p>
  );
}
