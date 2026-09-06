export function nowIso() {
  return toLocalIso(new Date());
}

export function toLocalIso(date: Date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = pad(Math.floor(absOffset / 60));
  const offsetMins = pad(absOffset % 60);

  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds()),
    ".",
    String(date.getMilliseconds()).padStart(3, "0"),
    sign,
    offsetHours,
    ":",
    offsetMins,
  ].join("");
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
