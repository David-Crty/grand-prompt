import { useEffect, useState } from "react";

/** Below 600 px wide the viewer switches to the phone layout. */
export const PHONE_QUERY = "(max-width: 599px)";

export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia?.(PHONE_QUERY).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_QUERY);
    if (!mq) return;
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}
