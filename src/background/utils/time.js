export function parseISO(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}


