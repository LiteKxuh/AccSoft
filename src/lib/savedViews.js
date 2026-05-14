/* HotelOps · saved views
 * =================================================================
 * Persistent per-pane filter presets ("Last 30 days · Operations vendors",
 * "Open AP · Hotel A", etc). Stored in localStorage under
 * `hotelops:savedViews:<pane>` so views survive app restarts and are
 * portable across components.
 */

const PREFIX = "hotelops:savedViews:";

function readAll(pane) {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PREFIX + pane);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeAll(pane, views) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(PREFIX + pane, JSON.stringify(views)); } catch {}
}

export function listViews(pane) {
  return readAll(pane).sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0));
}

export function saveView(pane, name, filters) {
  if (!pane || !name) return null;
  const all = readAll(pane);
  const id = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const view = {
    id,
    name: name.trim(),
    filters,
    createdAt: Date.now(),
    usedAt: Date.now(),
  };
  // Replace if same name exists
  const existing = all.findIndex(v => v.name.toLowerCase() === view.name.toLowerCase());
  if (existing >= 0) {
    view.id = all[existing].id;
    view.createdAt = all[existing].createdAt;
    all[existing] = view;
  } else {
    all.push(view);
  }
  writeAll(pane, all);
  return view;
}

export function touchView(pane, id) {
  const all = readAll(pane);
  const v = all.find(x => x.id === id);
  if (!v) return;
  v.usedAt = Date.now();
  writeAll(pane, all);
}

export function deleteView(pane, id) {
  const all = readAll(pane).filter(v => v.id !== id);
  writeAll(pane, all);
}

export function getView(pane, id) {
  return readAll(pane).find(v => v.id === id) || null;
}
