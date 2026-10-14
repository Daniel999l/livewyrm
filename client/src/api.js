// Thin client for the backend JSON API. Every call fails soft: if the server
// is not reachable, the UI keeps its last good values and the page still reads
// as a living thing instead of showing errors.

async function get(path) {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

export const api = {
  state: () => get('/api/state'),
  metrics: () => get('/api/metrics'),
  memento: (limit = 6) => get(`/api/memento?limit=${limit}`),
  events: (limit = 8) => get(`/api/events?limit=${limit}`),
  graveyard: () => get('/api/graveyard'),
  origin: () => get('/api/origin'),
  genome: () => get('/api/genome'),
};
