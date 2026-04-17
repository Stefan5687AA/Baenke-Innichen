const INNICHEN_CENTER = [46.7326, 12.2817];
const map = L.map('map').setView(INNICHEN_CENTER, 14);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const markers = new Map();
const adminToggle = document.getElementById('adminMode');
const reloadBtn = document.getElementById('reloadBtn');

const statusColors = {
  ok: '#16a34a',
  to_check: '#eab308',
  repair: '#dc2626',
  removed: '#9ca3af'
};

reloadBtn.addEventListener('click', loadBenches);

map.on('click', async (event) => {
  if (!adminToggle.checked) return;

  const payload = {
    title: prompt('Bench title?', 'New bench') || 'Untitled bench',
    lat: Number(event.latlng.lat.toFixed(6)),
    lng: Number(event.latlng.lng.toFixed(6)),
    status: prompt('Status? (ok, to_check, repair, removed)', 'ok') || 'ok',
    last_inspection: prompt('Last inspection date? (YYYY-MM-DD)', new Date().toISOString().slice(0, 10)) || null,
    notes: prompt('Notes?', '') || '',
    active: (prompt('Active? (yes/no)', 'yes') || 'yes').toLowerCase().startsWith('y')
  };

  await upsertBench('/api/benches', 'POST', payload);
});

async function loadBenches() {
  const response = await fetch('/api/benches');
  if (!response.ok) {
    alert('Could not load benches.');
    return;
  }

  const benches = await response.json();

  for (const marker of markers.values()) {
    map.removeLayer(marker);
  }
  markers.clear();

  for (const bench of benches) {
    addBenchMarker(bench);
  }
}

function markerIcon(status) {
  const color = statusColors[status] ?? '#6b7280';
  return L.divIcon({
    className: 'bench-marker',
    html: `<span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.2)"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
}

function popupHtml(bench) {
  return `
    <strong>${escapeHtml(bench.title)}</strong><br>
    <small>ID: ${bench.id}</small><br>
    Status: <b>${escapeHtml(bench.status)}</b><br>
    Last inspection: ${bench.last_inspection ? escapeHtml(bench.last_inspection) : 'n/a'}<br>
    Active: ${bench.active ? 'yes' : 'no'}<br>
    Notes: ${bench.notes ? escapeHtml(bench.notes) : '—'}
  `;
}

function addBenchMarker(bench) {
  const marker = L.marker([bench.lat, bench.lng], { icon: markerIcon(bench.status) }).addTo(map);
  marker.bindPopup(popupHtml(bench));

  marker.on('click', async () => {
    if (!adminToggle.checked) return;

    if (!confirm(`Edit bench #${bench.id}?`)) return;

    const payload = {
      title: prompt('Bench title?', bench.title) ?? bench.title,
      status: prompt('Status? (ok, to_check, repair, removed)', bench.status) ?? bench.status,
      last_inspection: prompt('Last inspection date? (YYYY-MM-DD)', bench.last_inspection || '') || null,
      notes: prompt('Notes?', bench.notes || '') || '',
      active: (prompt('Active? (yes/no)', bench.active ? 'yes' : 'no') || 'yes').toLowerCase().startsWith('y')
    };

    await upsertBench(`/api/benches/${bench.id}`, 'PUT', payload);
  });

  markers.set(bench.id, marker);
}

async function upsertBench(path, method, payload) {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text();
    alert(`Failed to save bench. ${detail}`);
    return;
  }

  await loadBenches();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

loadBenches();
