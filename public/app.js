const INNICHEN_CENTER = [46.7326, 12.2817];
const API_BASE_URL = resolveApiBaseUrl();
const OVERDUE_MONTHS = 10;
const mapElement = document.getElementById('map');
const leaflet = window.L;

if (!mapElement) {
  throw new Error('Map container #map not found.');
}

if (!leaflet) {
  mapElement.textContent = 'Leaflet konnte nicht geladen werden.';
  throw new Error('Leaflet failed to load.');
}

const map = leaflet.map(mapElement).setView(INNICHEN_CENTER, 14);
leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const markers = new Map();
const markerStates = new Map();
const statusColors = {
  good: '#16a34a',
  ok: '#f97316',
  to_check: '#f97316',
  repair: '#dc2626',
  removed: '#9ca3af'
};

const statusLabels = {
  good: 'Guter Zustand',
  ok: 'In Ordnung',
  to_check: 'Zu kontrollieren',
  repair: 'Reparatur n\u00F6tig',
  removed: 'Entfernt'
};

const adminToggle = document.getElementById('adminMode');
const reloadBtn = document.getElementById('reloadBtn');
const addCurrentLocationBtn = document.getElementById('addCurrentLocationBtn');
const panel = document.getElementById('editorPanel');
const panelTitle = document.getElementById('panelTitle');
const benchForm = document.getElementById('benchForm');
const cancelBtn = document.getElementById('cancelBtn');
const fieldName = document.getElementById('fieldName');
const fieldStatus = document.getElementById('fieldStatus');
const fieldInspection = document.getElementById('fieldInspection');
const todayInspectionBtn = document.getElementById('todayInspectionBtn');
const fieldNotes = document.getElementById('fieldNotes');
const fieldActive = document.getElementById('fieldActive');
const fieldImage = document.getElementById('fieldImage');
const imagePreview = document.getElementById('imagePreview');

let editMode = null;
let selectedBenchId = null;
let selectedPoint = null;
let tempMarker = null;
let userLocationMarker = null;
let userLocation = null;
let selectedImageFile = null;
let selectedImagePreviewUrl = null;
let currentImageUrl = null;
let hasShownLoadError = false;

reloadBtn.addEventListener('click', loadBenches);
adminToggle.addEventListener('change', () => {
  if (!adminToggle.checked) {
    closePanel();
    resetAllMarkerEditStates();
  }
});

addCurrentLocationBtn?.addEventListener('click', async () => {
  const currentPosition = await ensureUserLocation();
  if (!currentPosition) {
    alert('Standort ist nicht verf\u00FCgbar. Bitte Standortfreigabe erlauben oder die Bank per Klick auf die Karte hinzuf\u00FCgen.');
    return;
  }

  selectedPoint = currentPosition;
  setTempMarker(currentPosition);
  openAddPanel();
});

cancelBtn.addEventListener('click', closePanel);
todayInspectionBtn?.addEventListener('click', () => {
  fieldInspection.value = todayDateString();
});

fieldImage?.addEventListener('change', () => {
  const file = fieldImage.files?.[0] ?? null;
  setSelectedImage(file);
});

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

  if (editMode === 'add' && !selectedPoint) {
    alert('Bitte zuerst einen Standort f\u00FCr die neue Bank ausw\u00E4hlen.');
    return;
  }

  const imageUrl = await uploadSelectedImageIfNeeded(selectedImageFile);
  if (imageUrl === false) {
    return;
  }

  if (imageUrl) {
    payload.image_url = imageUrl;
  } else if (currentImageUrl) {
    payload.image_url = currentImageUrl;
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
  let response;
  try {
    response = await fetch(apiUrl('/api/benches'));
  } catch (error) {
    handleBenchLoadError(`Netzwerkfehler: ${error.message}`);
    return;
  }

  if (!response.ok) {
    const detail = await readErrorMessage(response);
    handleBenchLoadError(detail);
    return;
  }

  hasShownLoadError = false;
  const benches = await response.json();

  for (const marker of markers.values()) {
    map.removeLayer(marker);
  }
  markers.clear();
  markerStates.clear();

  for (const bench of benches) {
    addBenchMarker(bench);
  }
}

function addBenchMarker(bench) {
  const marker = leaflet.marker([bench.lat, bench.lng], {
    icon: markerIcon(bench),
    draggable: false
  }).addTo(map);

  marker.bindPopup(popupHtml(bench), {
    closeOnClick: false,
    autoClose: false
  });

  marker.on('popupopen', () => {
    renderMarkerPopup(marker, bench);
  });

  marker.on('dragend', () => {
    const state = getMarkerState(bench.id);
    if (!state.isMoving) {
      marker.setLatLng([bench.lat, bench.lng]);
      return;
    }

    const latLng = marker.getLatLng();
    state.pendingPosition = {
      lat: Number(latLng.lat.toFixed(6)),
      lng: Number(latLng.lng.toFixed(6))
    };

    disableMarkerDragging(marker);
    renderMarkerPopup(marker, bench);
    marker.openPopup();
  });

  marker.on('popupclose', () => {
    const state = getMarkerState(bench.id);
    if (state.isMoving) {
      return;
    }

    disableMarkerDragging(marker);
    if (!state.pendingPosition) {
      marker.setLatLng([bench.lat, bench.lng]);
    }
  });

  markers.set(bench.id, marker);
}

function renderMarkerPopup(marker, bench) {
  const state = getMarkerState(bench.id);
  if (adminToggle.checked) {
    marker.setPopupContent(popupEditorHtml(bench, state));
    bindPopupEditorEvents(marker, bench);
    return;
  }

  marker.setPopupContent(popupHtml(bench));
}

function openAddPanel() {
  editMode = 'add';
  selectedBenchId = null;
  panelTitle.textContent = 'Bank hinzuf\u00FCgen';
  resetImageField();
  fieldName.value = '';
  fieldStatus.value = 'good';
  fieldInspection.value = todayDateString();
  fieldNotes.value = '';
  fieldActive.value = '1';
  panel.hidden = false;
}

function closePanel() {
  editMode = null;
  selectedBenchId = null;
  selectedPoint = null;
  panel.hidden = true;
  benchForm.reset();
  resetImageField();
  clearTempMarker();
}

function setTempMarker(point) {
  clearTempMarker();

  tempMarker = leaflet.circleMarker([point.lat, point.lng], {
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

function markerIcon(bench) {
  const color = statusColors[bench.status] ?? '#6b7280';
  const overdueBadge = isBenchOverdue(bench)
    ? '<span class="bench-marker-badge" aria-hidden="true">!</span>'
    : '';

  return leaflet.divIcon({
    className: 'bench-marker-icon',
    html: `
      <span class="bench-marker-pin" style="background:${color}">
        ${overdueBadge}
      </span>
    `,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12]
  });
}

function popupHtml(bench) {
  const overdueHint = isBenchOverdue(bench)
    ? '<div class="popup-overdue">! Kontrolle seit mindestens 10 Monaten f\u00E4llig</div>'
    : '';
  const imageHtml = bench.image_url
    ? `<img class="popup-photo" src="${escapeHtml(bench.image_url)}" alt="Foto von ${escapeHtml(bench.title)}" />`
    : '';

  return `
    <div class="popup-card">
      ${imageHtml}
      <div class="popup-header">
        <strong>${escapeHtml(bench.title)}</strong>
        <small>ID: ${bench.id}</small>
      </div>
      <div class="popup-meta">
        <span><b>Status:</b> ${statusLabels[bench.status] ?? escapeHtml(bench.status)}</span>
        <span><b>Letzte Kontrolle:</b> ${bench.last_inspection ? escapeHtml(bench.last_inspection) : 'Keine Angabe'}</span>
        <span><b>Aktiv:</b> ${bench.active ? 'Ja' : 'Nein'}</span>
      </div>
      <div class="popup-notes">
        <b>Notiz:</b> ${bench.notes ? escapeHtml(bench.notes) : '-'}
      </div>
      ${overdueHint}
    </div>
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

async function uploadSelectedImageIfNeeded(file) {
  if (!file) return null;

  if (!file.type || !file.type.startsWith('image/')) {
    alert('Bitte eine Bilddatei ausw\u00E4hlen.');
    return false;
  }

  const formData = new FormData();
  formData.append('file', file);

  let response;
  try {
    response = await fetch(apiUrl('/api/upload'), {
      method: 'POST',
      body: formData
    });
  } catch (error) {
    alert(`Foto konnte nicht hochgeladen werden. Netzwerkfehler: ${error.message}`);
    return false;
  }

  if (!response.ok) {
    const detail = await readErrorMessage(response);
    alert(`Foto konnte nicht hochgeladen werden. ${detail}`);
    return false;
  }

  let body;
  try {
    body = await response.json();
  } catch {
    alert('Foto konnte nicht hochgeladen werden. Ung\u00FCltige Serverantwort.');
    return false;
  }

  if (!body?.url || typeof body.url !== 'string') {
    alert('Foto konnte nicht hochgeladen werden. Die Serverantwort enth\u00E4lt keine Bild-URL.');
    return false;
  }

  return body.url;
}

async function readErrorMessage(response) {
  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await response.json();
      if (body?.error && body?.detail) return `${body.error}: ${body.detail}`;
      if (body?.error) return body.error;
      if (body?.detail) return body.detail;
      return `HTTP ${response.status}`;
    }

    const text = (await response.text()).trim();
    if (text) return text;
  } catch {
    // Ignore parsing errors and fall back to HTTP status.
  }

  return `HTTP ${response.status}`;
}

async function archiveBench(benchId) {
  if (!confirm('Bank wirklich l\u00F6schen? (wird als entfernt/inaktiv markiert)')) return;

  await upsertBench(`/api/benches/${benchId}`, 'PUT', {
    status: 'removed',
    active: false
  });
}

function popupEditorHtml(bench, state) {
  const pendingPositionText = state.pendingPosition
    ? `Neue Position: ${state.pendingPosition.lat}, ${state.pendingPosition.lng}`
    : 'Noch keine neue Position ausgew\u00E4hlt.';
  const overdueHint = isBenchOverdue(bench)
    ? '<div class="popup-overdue">! Kontrolle seit mindestens 10 Monaten f\u00E4llig</div>'
    : '';
  const previewHidden = bench.image_url ? '' : 'hidden';
  const previewSrc = bench.image_url ? `src="${escapeHtml(bench.image_url)}"` : '';

  return `
    <form class="popup-editor" data-bench-id="${bench.id}">
      <div class="photo-field">
        <img class="photo-preview" data-role="image-preview" ${previewSrc} alt="Ausgew&auml;hltes Bankfoto" ${previewHidden} />
        <label>
          Foto
          <input name="image" type="file" accept="image/*" />
        </label>
      </div>

      <label>
        Titel
        <input name="title" type="text" maxlength="200" value="${escapeHtml(bench.title || '')}" required />
      </label>

      <label>
        Status
        <select name="status">
          <option value="good" ${bench.status === 'good' ? 'selected' : ''}>Guter Zustand</option>
          <option value="ok" ${bench.status === 'ok' ? 'selected' : ''}>In Ordnung</option>
          <option value="repair" ${bench.status === 'repair' ? 'selected' : ''}>Reparatur n\u00F6tig</option>
          <option value="removed" ${bench.status === 'removed' ? 'selected' : ''}>Entfernt</option>
        </select>
      </label>

      <label>
        Letzte Kontrolle
        <span class="inspection-row">
          <input name="last_inspection" type="date" value="${escapeHtml(bench.last_inspection || '')}" />
          <button type="button" class="success compact" data-action="today-inspection">Heute</button>
        </span>
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

      ${overdueHint}

      <div class="popup-actions">
        <button type="button" data-action="move">Position \u00E4ndern</button>
        <button type="button" data-action="delete">L\u00F6schen</button>
      </div>

      <div class="popup-actions">
        <button type="submit" class="primary">Speichern</button>
        <button type="button" data-action="cancel">Schlie&szlig;en</button>
      </div>

      <div class="popup-move" ${state.isMoving ? '' : 'hidden'}>
        <small>Marker per Drag and Drop verschieben.</small>
        <small class="popup-position-preview">${escapeHtml(pendingPositionText)}</small>
        <div class="popup-actions">
          <button type="button" class="primary" data-action="save-position">Position speichern</button>
          <button type="button" data-action="cancel-position">Abbrechen</button>
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

  const moveButton = form.querySelector('[data-action="move"]');
  const todayInspectionButton = form.querySelector('[data-action="today-inspection"]');
  const cancelButton = form.querySelector('[data-action="cancel"]');
  const deleteButton = form.querySelector('[data-action="delete"]');
  const savePositionButton = form.querySelector('[data-action="save-position"]');
  const cancelPositionButton = form.querySelector('[data-action="cancel-position"]');
  const imageInput = form.querySelector('input[name="image"]');
  const imagePreviewElement = form.querySelector('[data-role="image-preview"]');
  const originalPosition = { lat: bench.lat, lng: bench.lng };
  const state = getMarkerState(bench.id);
  let popupImageFile = null;
  let popupImagePreviewUrl = null;
  const cleanupPopupImagePreview = () => {
    if (!popupImagePreviewUrl) return;
    URL.revokeObjectURL(popupImagePreviewUrl);
    popupImagePreviewUrl = null;
  };

  imageInput?.addEventListener('change', () => {
    popupImageFile = imageInput.files?.[0] ?? null;
    cleanupPopupImagePreview();

    if (popupImageFile) {
      popupImagePreviewUrl = URL.createObjectURL(popupImageFile);
      showImagePreview(imagePreviewElement, popupImagePreviewUrl);
      return;
    }

    showImagePreview(imagePreviewElement, bench.image_url || null);
  });

  todayInspectionButton?.addEventListener('click', () => {
    const inspectionInput = form.querySelector('input[name="last_inspection"]');
    if (inspectionInput) {
      inspectionInput.value = todayDateString();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const payload = {
      title: String(formData.get('title') || '').trim(),
      status: String(formData.get('status') || 'good'),
      last_inspection: String(formData.get('last_inspection') || '') || null,
      notes: String(formData.get('notes') || '').trim(),
      active: String(formData.get('active')) === '1'
    };

    if (!payload.title) {
      alert('Bitte einen Namen eingeben.');
      return;
    }

    const imageUrl = await uploadSelectedImageIfNeeded(popupImageFile);
    if (imageUrl === false) {
      return;
    }

    if (imageUrl) {
      payload.image_url = imageUrl;
    } else if (bench.image_url) {
      payload.image_url = bench.image_url;
    }

    const saved = await upsertBench(`/api/benches/${bench.id}`, 'PUT', payload);
    if (saved) {
      cleanupPopupImagePreview();
    }
  });

  moveButton?.addEventListener('click', () => {
    state.isMoving = true;
    state.originalPosition = { ...originalPosition };
    state.pendingPosition = state.pendingPosition ?? { ...originalPosition };
    marker.setLatLng([state.pendingPosition.lat, state.pendingPosition.lng]);
    marker.dragging.enable();
    renderMarkerPopup(marker, bench);
    marker.openPopup();
  });

  savePositionButton?.addEventListener('click', async () => {
    const nextPosition = state.pendingPosition ?? {
      lat: Number(marker.getLatLng().lat.toFixed(6)),
      lng: Number(marker.getLatLng().lng.toFixed(6))
    };

    await upsertBench(`/api/benches/${bench.id}`, 'PUT', nextPosition);
  });

  cancelPositionButton?.addEventListener('click', () => {
    resetMarkerEditState(marker, bench.id, originalPosition);
    renderMarkerPopup(marker, bench);
    marker.openPopup();
  });

  deleteButton?.addEventListener('click', async () => {
    await archiveBench(bench.id);
  });

  cancelButton?.addEventListener('click', () => {
    cleanupPopupImagePreview();
    resetMarkerEditState(marker, bench.id, originalPosition);
    marker.closePopup();
  });
}

async function ensureUserLocation() {
  if (userLocation) {
    return userLocation;
  }

  if (!navigator.geolocation) {
    return null;
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = {
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6))
        };

        userLocation = point;
        renderUserLocation(point);
        resolve(point);
      },
      () => {
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

function renderUserLocation(point) {
  if (userLocationMarker) {
    map.removeLayer(userLocationMarker);
  }

  userLocationMarker = leaflet.circleMarker([point.lat, point.lng], {
    radius: 8,
    color: '#1d4ed8',
    fillColor: '#60a5fa',
    fillOpacity: 0.9,
    weight: 2
  })
    .addTo(map)
    .bindPopup('Dein Standort');
}

function setSelectedImage(file) {
  selectedImageFile = file;

  if (selectedImagePreviewUrl) {
    URL.revokeObjectURL(selectedImagePreviewUrl);
    selectedImagePreviewUrl = null;
  }

  if (file) {
    selectedImagePreviewUrl = URL.createObjectURL(file);
    showImagePreview(imagePreview, selectedImagePreviewUrl);
    return;
  }

  showImagePreview(imagePreview, currentImageUrl);
}

function resetImageField(imageUrl = null) {
  if (selectedImagePreviewUrl) {
    URL.revokeObjectURL(selectedImagePreviewUrl);
    selectedImagePreviewUrl = null;
  }

  selectedImageFile = null;
  currentImageUrl = imageUrl;

  if (fieldImage) {
    fieldImage.value = '';
  }

  showImagePreview(imagePreview, imageUrl);
}

function showImagePreview(element, url) {
  if (!element) return;

  if (url) {
    element.src = url;
    element.hidden = false;
    return;
  }

  element.removeAttribute('src');
  element.hidden = true;
}

function showUserLocation() {
  ensureUserLocation().catch(() => {
    // App continues normally if location is unavailable.
  });
}

function getMarkerState(benchId) {
  if (!markerStates.has(benchId)) {
    markerStates.set(benchId, {
      isMoving: false,
      pendingPosition: null,
      originalPosition: null
    });
  }

  return markerStates.get(benchId);
}

function resetMarkerEditState(marker, benchId, originalPosition) {
  const state = getMarkerState(benchId);
  state.isMoving = false;
  state.pendingPosition = null;
  state.originalPosition = null;
  disableMarkerDragging(marker);
  marker.setLatLng([originalPosition.lat, originalPosition.lng]);
}

function resetAllMarkerEditStates() {
  for (const [benchId, marker] of markers.entries()) {
    const state = getMarkerState(benchId);
    if (!state.pendingPosition || !state.originalPosition) continue;

    resetMarkerEditState(marker, benchId, state.originalPosition);
  }
}

function disableMarkerDragging(marker) {
  if (marker.dragging?.enabled()) {
    marker.dragging.disable();
  }
}

function isBenchOverdue(bench) {
  if (!bench.last_inspection) return false;

  const inspectionDate = new Date(`${bench.last_inspection}T00:00:00`);
  if (Number.isNaN(inspectionDate.getTime())) return false;

  const threshold = new Date();
  threshold.setMonth(threshold.getMonth() - OVERDUE_MONTHS);
  threshold.setHours(0, 0, 0, 0);

  return inspectionDate <= threshold;
}

function todayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function handleBenchLoadError(detail) {
  console.error('Bench loading failed:', detail);
  if (hasShownLoadError) return;
  hasShownLoadError = true;
  alert(`B\u00E4nke konnten nicht geladen werden. ${detail}`);
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
  const configured = window.__BENCH_API_BASE_URL;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim().replace(/\/$/, '');
  }

  const localHosts = ['localhost', '127.0.0.1', '::1'];
  if (localHosts.includes(window.location.hostname)) {
    return 'http://127.0.0.1:8787';
  }

  return 'https://baenke-innichen.stefan-e58.workers.dev';
}

loadBenches();
showUserLocation();
