const INNICHEN_CENTER = [46.7326, 12.2817];
const API_BASE_URL = resolveApiBaseUrl();

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
let userLocationMarker = null;

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
  const response = await fetch(apiUrl('/api/benches'));
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
  const marker = L.marker([bench.lat, bench.lng], { icon: markerIcon(bench.status), draggable: false }).addTo(map);
  marker.bindPopup(popupHtml(bench));

  marker.on('click', () => {
    if (!adminToggle.checked) return;
    marker.setPopupContent(popupEditorHtml(bench));
  });

  marker.on('popupopen', () => {
    if (!adminToggle.checked) return;
    bindPopupEditorEvents(marker, bench);
  });

  marker.on('popupclose', () => {
    marker.dragging.disable();
    marker.setLatLng([bench.lat, bench.lng]);
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
  let response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    alert(`Fehler beim Speichern der Bank. Netzwerkfehler: ${error.message}`);
    return;
  }

  if (!response.ok) {
    const detail = await readErrorMessage(response);
    alert(`Fehler beim Speichern der Bank. ${detail}`);
    return;
  }

  await loadBenches();
  closePanel();
  return true;
}

async function readErrorMessage(response) {
  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await response.json();
      if (body?.error) return body.error;
      return `HTTP ${response.status}`;
    }

    const text = (await response.text()).trim();
    if (text) return text;
  } catch {
    // ignore parsing errors and fall back to HTTP status
  }

  return `HTTP ${response.status}`;
}

async function archiveBench(benchId) {
  if (!confirm('Bank wirklich löschen? (wird als entfernt/inaktiv markiert)')) return;

  await upsertBench(`/api/benches/${benchId}`, 'PUT', {
    status: 'removed',
    active: false
  });
}

function popupEditorHtml(bench) {
  return `
    <form class="popup-editor" data-bench-id="${bench.id}">
      <label>
        Titel
        <input name="title" type="text" maxlength="200" value="${escapeHtml(bench.title || '')}" required />
      </label>

      <label>
        Status
        <select name="status">
          <option value="ok" ${bench.status === 'ok' ? 'selected' : ''}>In Ordnung</option>
          <option value="to_check" ${bench.status === 'to_check' ? 'selected' : ''}>Zu kontrollieren</option>
          <option value="repair" ${bench.status === 'repair' ? 'selected' : ''}>Reparatur nötig</option>
          <option value="removed" ${bench.status === 'removed' ? 'selected' : ''}>Entfernt</option>
        </select>
      </label>

      <label>
        Letzte Kontrolle
        <input name="last_inspection" type="date" value="${escapeHtml(bench.last_inspection || '')}" />
      </label>

      <label>
        Aktiv
        <select name="active">
          <option value="1" ${bench.active ? 'selected' : ''}>Ja</option>
          <option value="0" ${bench.active ? '' : 'selected'}>Nein</option>
        </select>
      </label>

      <label>
        Notiz
        <textarea name="notes" rows="3">${escapeHtml(bench.notes || '')}</textarea>
      </label>

      <div class="popup-actions">
        <button type="button" data-action="move">Position ändern</button>
        <button type="button" data-action="delete">Löschen</button>
      </div>

      <div class="popup-actions">
        <button type="submit" class="primary">Speichern</button>
        <button type="button" data-action="cancel">Abbrechen</button>
      </div>

      <div class="popup-move" hidden>
        <small>Marker per Drag & Drop verschieben.</small>
        <div class="popup-actions">
          <button type="button" class="primary" data-action="save-position">Position speichern</button>
          <button type="button" data-action="cancel-position">Position abbrechen</button>
        </div>
      </div>
    </form>
  `;
}

function bindPopupEditorEvents(marker, bench) {
  const popupElement = marker.getPopup()?.getElement();
  if (!popupElement) return;

  const form = popupElement.querySelector('.popup-editor');
  if (!form) return;

  const movePanel = form.querySelector('.popup-move');
  const moveButton = form.querySelector('[data-action="move"]');
  const cancelButton = form.querySelector('[data-action="cancel"]');
  const deleteButton = form.querySelector('[data-action="delete"]');
  const savePositionButton = form.querySelector('[data-action="save-position"]');
  const cancelPositionButton = form.querySelector('[data-action="cancel-position"]');
  const originalPosition = { lat: bench.lat, lng: bench.lng };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const payload = {
      title: String(formData.get('title') || '').trim(),
      status: String(formData.get('status') || 'ok'),
      last_inspection: String(formData.get('last_inspection') || '') || null,
      notes: String(formData.get('notes') || '').trim(),
      active: String(formData.get('active')) === '1'
    };

    if (!payload.title) {
      alert('Bitte einen Namen eingeben.');
      return;
    }

    await upsertBench(`/api/benches/${bench.id}`, 'PUT', payload);
  });

  moveButton?.addEventListener('click', () => {
    marker.dragging.enable();
    movePanel.hidden = false;
  });

  savePositionButton?.addEventListener('click', async () => {
    const latLng = marker.getLatLng();
    await upsertBench(`/api/benches/${bench.id}`, 'PUT', {
      lat: Number(latLng.lat.toFixed(6)),
      lng: Number(latLng.lng.toFixed(6))
    });
  });

  cancelPositionButton?.addEventListener('click', () => {
    marker.dragging.disable();
    marker.setLatLng([originalPosition.lat, originalPosition.lng]);
    movePanel.hidden = true;
  });

  deleteButton?.addEventListener('click', async () => {
    await archiveBench(bench.id);
  });

  cancelButton?.addEventListener('click', () => {
    marker.dragging.disable();
    marker.setLatLng([originalPosition.lat, originalPosition.lng]);
    marker.closePopup();
  });
}

function showUserLocation() {
  if (!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = Number(position.coords.latitude.toFixed(6));
      const lng = Number(position.coords.longitude.toFixed(6));

      if (userLocationMarker) {
        map.removeLayer(userLocationMarker);
      }

      userLocationMarker = L.circleMarker([lat, lng], {
        radius: 8,
        color: '#1d4ed8',
        fillColor: '#60a5fa',
        fillOpacity: 0.9,
        weight: 2
      })
        .addTo(map)
        .bindPopup('Dein Standort');
    },
    () => {
      // Standortfreigabe verweigert oder nicht verfügbar – App läuft normal weiter.
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
  );
}

async function readErrorMessage(response) {
  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await response.json();
      if (body?.error) return body.error;
      return `HTTP ${response.status}`;
    }

    const text = (await response.text()).trim();
    if (text) return text;
  } catch {
    // ignore parsing errors and fall back to HTTP status
  }

  return `HTTP ${response.status}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function resolveApiBaseUrl() {
  // Optional override for custom setups:
  // window.__BENCH_API_BASE_URL = 'https://<worker-url>';
  const configured = window.__BENCH_API_BASE_URL;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim().replace(/\/$/, '');
  }

  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (isLocalHost) {
    return 'http://127.0.0.1:8787';
  }

  // Production default: same-origin via /api/* route/proxy.
  return '';
}

loadBenches();
showUserLocation();
