import { useEffect, useState } from "react";

export function localDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function useLocalDate() {
  const [date, setDate] = useState(localDate);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function refresh() {
      clearTimeout(timer);
      setDate(localDate());
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      timer = setTimeout(refresh, Math.max(1, midnight.getTime() - Date.now()));
    }
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return date;
}

export function formatWearDate(date: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`));
}
