const INNICHEN_CENTER = [46.7326, 12.2817];

const map = L.map('map').setView(INNICHEN_CENTER, 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const markers = new Map();
const statusColors = {
  ok: '#16a34a',
  to_check: '#eab308',
  repair: '#dc2626',
  removed: '#9ca3af'
};

const statusLabels = {
  ok: 'In Ordnung',
  to_check: 'Zu kontrollieren',
  repair: 'Reparatur nötig',
  removed: 'Entfernt'
};

const adminToggle = document.getElementById('adminMode');
const reloadBtn = document.getElementById('reloadBtn');
const panel = document.getElementById('editorPanel');
const panelTitle = document.getElementById('panelTitle');
const benchForm = document.getElementById('benchForm');
const cancelBtn = document.getElementById('cancelBtn');
const fieldName = document.getElementById('fieldName');
const fieldStatus = document.getElementById('fieldStatus');
const fieldInspection = document.getElementById('fieldInspection');
const fieldNotes = document.getElementById('fieldNotes');
const fieldActive = document.getElementById('fieldActive');

let editMode = null;
let selectedBenchId = null;
let selectedPoint = null;
let tempMarker = null;

reloadBtn.addEventListener('click', loadBenches);
adminToggle.addEventListener('change', () => {
  if (!adminToggle.checked) {
    closePanel();
  }
});

cancelBtn.addEventListener('click', closePanel);

benchForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    title: fieldName.value.trim(),
    status: fieldStatus.value,
    last_inspection: fieldInspection.value || null,
    notes: fieldNotes.value.trim(),
    active: fieldActive.value === '1'
  };

  if (!payload.title) {
    alert('Bitte einen Namen eingeben.');
    return;
  }

  if (editMode === 'add') {
    await upsertBench('/api/benches', 'POST', {
      ...payload,
      lat: selectedPoint.lat,
      lng: selectedPoint.lng
    });
    return;
  }

  if (editMode === 'edit' && selectedBenchId !== null) {
    await upsertBench(`/api/benches/${selectedBenchId}`, 'PUT', payload);
  }
});

map.on('click', (event) => {
  if (!adminToggle.checked) return;

  selectedPoint = {
    lat: Number(event.latlng.lat.toFixed(6)),
    lng: Number(event.latlng.lng.toFixed(6))
  };

  setTempMarker(selectedPoint);
  openAddPanel();
});

async function loadBenches() {
  const response = await fetch('/api/benches');
  if (!response.ok) {
    alert('Bänke konnten nicht geladen werden.');
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

function addBenchMarker(bench) {
  const marker = L.marker([bench.lat, bench.lng], { icon: markerIcon(bench.status) }).addTo(map);
  marker.bindPopup(popupHtml(bench));

  marker.on('click', () => {
    if (!adminToggle.checked) return;

    selectedBenchId = bench.id;
    selectedPoint = { lat: bench.lat, lng: bench.lng };
    clearTempMarker();
    openEditPanel(bench);
  });

  markers.set(bench.id, marker);
}

function openAddPanel() {
  editMode = 'add';
  selectedBenchId = null;
  panelTitle.textContent = 'Bank hinzufügen';
  fieldName.value = '';
  fieldStatus.value = 'ok';
  fieldInspection.value = new Date().toISOString().slice(0, 10);
  fieldNotes.value = '';
  fieldActive.value = '1';
  panel.hidden = false;
  fieldName.focus();
}

function openEditPanel(bench) {
  editMode = 'edit';
  panelTitle.textContent = 'Bank bearbeiten';
  fieldName.value = bench.title || '';
  fieldStatus.value = bench.status || 'ok';
  fieldInspection.value = bench.last_inspection || '';
  fieldNotes.value = bench.notes || '';
  fieldActive.value = bench.active ? '1' : '0';
  panel.hidden = false;
  fieldName.focus();
}

function closePanel() {
  editMode = null;
  selectedBenchId = null;
  selectedPoint = null;
  panel.hidden = true;
  benchForm.reset();
  clearTempMarker();
}

function setTempMarker(point) {
  clearTempMarker();

  tempMarker = L.circleMarker([point.lat, point.lng], {
    radius: 10,
    color: '#2563eb',
    fillColor: '#60a5fa',
    fillOpacity: 0.8,
    weight: 2
  }).addTo(map);
}

function clearTempMarker() {
  if (!tempMarker) return;
  map.removeLayer(tempMarker);
  tempMarker = null;
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
    Status: <b>${statusLabels[bench.status] ?? escapeHtml(bench.status)}</b><br>
    Letzte Kontrolle: ${bench.last_inspection ? escapeHtml(bench.last_inspection) : 'Keine Angabe'}<br>
    Aktiv: ${bench.active ? 'Ja' : 'Nein'}<br>
    Notiz: ${bench.notes ? escapeHtml(bench.notes) : '—'}
  `;
}

async function upsertBench(path, method, payload) {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text();
    alert(`Speichern fehlgeschlagen. ${detail}`);
    return;
  }

  await loadBenches();
  closePanel();
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
