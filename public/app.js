const INNICHEN_CENTER = [46.7326, 12.2817];
const API_BASE_URL = resolveApiBaseUrl();
const MUNICIPALITY_GEOJSON_URL = './innichen_gemeindegebiet_exakt.geojson';
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
createMapPane('municipalityMaskPane', 350);
createMapPane('municipalityBoundaryPane', 360);

const municipalityMaskRenderer = leaflet.svg({
  padding: 1,
  pane: 'municipalityMaskPane'
});
const municipalityBoundaryRenderer = leaflet.svg({
  padding: 1,
  pane: 'municipalityBoundaryPane'
});
const standardTileLayer = leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
});
const terrainTileLayer = leaflet.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  maxNativeZoom: 17,
  attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)'
});

standardTileLayer.addTo(map);
leaflet.control.layers(
  {
    Standard: standardTileLayer,
    Gelände: terrainTileLayer
  },
  {},
  {
    position: 'topright',
    collapsed: true
  }
).addTo(map);

const markers = new Map();
const markerStates = new Map();
let municipalityMaskLayer = null;
let municipalityBoundaryLayer = null;
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
const benchListBtn = document.getElementById('benchListBtn');
const benchListPanel = document.getElementById('benchListPanel');
const closeBenchListBtn = document.getElementById('closeBenchListBtn');
const benchSortSelect = document.getElementById('benchSortSelect');
const benchList = document.getElementById('benchList');
const benchListCount = document.getElementById('benchListCount');
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
const removeImageBtn = document.getElementById('removeImageBtn');
const removeImageNote = document.getElementById('removeImageNote');
const editPanelActions = document.getElementById('editPanelActions');
const movePositionBtn = document.getElementById('movePositionBtn');
const deleteBenchBtn = document.getElementById('deleteBenchBtn');
const positionEditBar = document.getElementById('positionEditBar');
const positionEditTitle = document.getElementById('positionEditTitle');
const positionEditHint = document.getElementById('positionEditHint');
const savePositionBtn = document.getElementById('savePositionBtn');
const cancelPositionBtn = document.getElementById('cancelPositionBtn');
const locationAccuracyNote = document.getElementById('locationAccuracyNote');

const statusSortOrder = ['repair', 'ok', 'to_check', 'good', 'removed'];
const MAX_IMAGE_SIZE = 1600;
const IMAGE_QUALITY = 0.72;
const LOCATION_UNCLEAR_THRESHOLD_METERS = 30;
const LOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 20000,
  maximumAge: 0
};

let editMode = null;
let selectedBenchId = null;
let selectedPoint = null;
let tempMarker = null;
let userLocationMarker = null;
let userLocationAccuracyCircle = null;
let userLocation = null;
let userLocationWatchId = null;
let selectedImageFile = null;
let selectedImagePreviewUrl = null;
let currentImageUrl = null;
let shouldRemoveCurrentImage = false;
let currentEditBench = null;
let currentEditMarker = null;
let activePositionEdit = null;
let currentBenches = [];
let benchDisplayNumbers = new Map();
let hasShownLoadError = false;

reloadBtn.addEventListener('click', () => {
  window.location.reload();
});
benchListBtn?.addEventListener('click', () => {
  benchListPanel.hidden = !benchListPanel.hidden;
  if (!benchListPanel.hidden) {
    renderBenchList();
  }
});
closeBenchListBtn?.addEventListener('click', () => {
  benchListPanel.hidden = true;
});
benchSortSelect?.addEventListener('change', renderBenchList);
adminToggle.addEventListener('change', () => {
  updateAdminControls();
  if (!adminToggle.checked) {
    closePanel();
    resetAllMarkerEditStates();
  }
});

addCurrentLocationBtn?.addEventListener('click', async () => {
  if (!adminToggle.checked) {
    alert('Bitte zuerst den Admin-Modus aktivieren.');
    return;
  }

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

removeImageBtn?.addEventListener('click', () => {
  shouldRemoveCurrentImage = true;
  selectedImageFile = null;
  cleanupSelectedImagePreview();

  if (fieldImage) {
    fieldImage.value = '';
  }

  showImagePreview(imagePreview, null);
  removeImageBtn.hidden = true;
  removeImageNote.hidden = false;
});

movePositionBtn?.addEventListener('click', () => {
  if (!currentEditBench || !currentEditMarker) return;
  startPositionEdit(currentEditBench, currentEditMarker);
});

deleteBenchBtn?.addEventListener('click', async () => {
  if (!currentEditBench) return;
  await archiveBench(currentEditBench.id);
});

savePositionBtn?.addEventListener('click', saveActivePositionEdit);
cancelPositionBtn?.addEventListener('click', () => {
  cancelActivePositionEdit({ reopenPanel: true });
});

map.on('moveend resize baselayerchange', refreshMunicipalityLayers);

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
  } else if (shouldRemoveCurrentImage) {
    payload.image_url = null;
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
    response = await fetch(apiUrl('/api/benches?active=all'));
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
  currentBenches = benches.filter((bench) => bench.active && bench.status !== 'removed');
  benchDisplayNumbers = buildBenchDisplayNumbers(currentBenches);

  for (const marker of markers.values()) {
    map.removeLayer(marker);
  }
  markers.clear();
  markerStates.clear();

  for (const bench of currentBenches) {
    addBenchMarker(bench);
  }

  renderBenchList();
}

async function loadMunicipalityBoundary() {
  let response;
  try {
    response = await fetch(MUNICIPALITY_GEOJSON_URL);
  } catch (error) {
    console.error('Municipality boundary loading failed:', error);
    return;
  }

  if (!response.ok) {
    console.error(`Municipality boundary loading failed: HTTP ${response.status}`);
    return;
  }

  const geojson = await response.json();
  const feature = findInnichenMunicipalityFeature(geojson);

  if (!feature) {
    console.error('Innichen municipality feature not found in source GeoJSON.');
    return;
  }

  renderMunicipalityBoundary(feature);
}

function findInnichenMunicipalityFeature(geojson) {
  const features = geojson?.type === 'FeatureCollection'
    ? geojson.features
    : [geojson];

  return features.find(isInnichenMunicipalityFeature) ?? null;
}

function isInnichenMunicipalityFeature(feature) {
  const properties = feature?.properties ?? {};
  return properties.name_de === 'Innichen'
    && properties.name_it === 'S.Candido'
    && Number(properties.istat_code) === 21077;
}

function renderMunicipalityBoundary(feature) {
  if (municipalityMaskLayer) {
    map.removeLayer(municipalityMaskLayer);
  }

  if (municipalityBoundaryLayer) {
    map.removeLayer(municipalityBoundaryLayer);
  }

  municipalityMaskLayer = createMunicipalityMaskLayer(feature.geometry);
  municipalityMaskLayer?.addTo(map);

  municipalityBoundaryLayer = leaflet.geoJSON(feature, {
    pane: 'municipalityBoundaryPane',
    renderer: municipalityBoundaryRenderer,
    interactive: false,
    style: {
      color: '#047857',
      weight: 3,
      opacity: 0.95,
      fillColor: '#22c55e',
      fillOpacity: 0.08
    }
  }).addTo(map);

  refreshMunicipalityLayers();
}

function createMunicipalityMaskLayer(geometry) {
  const exteriorRings = getMunicipalityExteriorRings(geometry);
  if (!exteriorRings.length) return null;

  const webMercatorWorldRing = [
    [-85.0511, -180],
    [-85.0511, 180],
    [85.0511, 180],
    [85.0511, -180],
    [-85.0511, -180]
  ];

  return leaflet.polygon([webMercatorWorldRing, ...exteriorRings], {
    pane: 'municipalityMaskPane',
    renderer: municipalityMaskRenderer,
    interactive: false,
    stroke: false,
    fillColor: '#0f172a',
    fillOpacity: 0.18,
    fillRule: 'evenodd'
  });
}

function refreshMunicipalityLayers() {
  window.requestAnimationFrame(() => {
    municipalityMaskLayer?.bringToBack?.();
    municipalityBoundaryLayer?.bringToFront?.();
  });
}

function getMunicipalityExteriorRings(geometry) {
  if (!geometry) return [];

  if (geometry.type === 'Polygon') {
    return geometry.coordinates.slice(0, 1).map(geoRingToLatLngRing);
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .map((polygon) => polygon[0])
      .filter(Boolean)
      .map(geoRingToLatLngRing);
  }

  return [];
}

function geoRingToLatLngRing(ring) {
  return ring.map(([lng, lat]) => [lat, lng]);
}

function addBenchMarker(bench) {
  const marker = leaflet.marker([bench.lat, bench.lng], {
    icon: markerIcon(bench),
    draggable: false
  }).addTo(map);

  marker.bindPopup(popupHtml(bench), {
    closeOnClick: true,
    autoClose: true,
    autoPan: false
  });

  marker.on('click', () => {
    if (!adminToggle.checked) return;
    marker.closePopup();
    openEditPanel(bench, marker);
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

    renderPositionEditBar();
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
    marker.closePopup();
    return;
  }

  marker.setPopupContent(popupHtml(bench));
}

function openAddPanel() {
  cancelActivePositionEdit();
  editMode = 'add';
  selectedBenchId = null;
  currentEditBench = null;
  currentEditMarker = null;
  panelTitle.textContent = 'Bank hinzuf\u00FCgen';
  resetImageField();
  fieldName.value = '';
  fieldStatus.value = 'good';
  fieldInspection.value = todayDateString();
  fieldNotes.value = '';
  fieldActive.value = '1';
  editPanelActions.hidden = true;
  panel.hidden = false;
}

function openEditPanel(bench, marker) {
  cancelActivePositionEdit();
  editMode = 'edit';
  selectedBenchId = bench.id;
  selectedPoint = null;
  currentEditBench = bench;
  currentEditMarker = marker;
  panelTitle.textContent = 'Bank bearbeiten';
  resetImageField(bench.image_url || null);
  fieldName.value = bench.title || '';
  fieldStatus.value = bench.status || 'good';
  fieldInspection.value = bench.last_inspection || '';
  fieldNotes.value = bench.notes || '';
  fieldActive.value = bench.active ? '1' : '0';
  editPanelActions.hidden = false;
  panel.hidden = false;
}

function closePanel() {
  cancelActivePositionEdit();
  editMode = null;
  selectedBenchId = null;
  selectedPoint = null;
  currentEditBench = null;
  currentEditMarker = null;
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
  const markerLabel = escapeHtml(String(getBenchDisplayNumber(bench)));
  const overdueBadge = isBenchOverdue(bench)
    ? '<span class="bench-marker-badge" aria-hidden="true">!</span>'
    : '';

  return leaflet.divIcon({
    className: 'bench-marker-icon',
    html: `
      <span class="bench-marker-pin" style="background:${color}">
        <span class="bench-marker-number">${markerLabel}</span>
        ${overdueBadge}
      </span>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -16]
  });
}

function popupHtml(bench) {
  const displayNumber = getBenchDisplayNumber(bench);
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
        <small>#${displayNumber} &middot; technische ID: ${bench.id}</small>
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

  closePanel();
  await loadBenches();
  return true;
}

async function uploadSelectedImageIfNeeded(file) {
  if (!file) return null;

  if (!file.type || !file.type.startsWith('image/')) {
    alert('Bitte eine Bilddatei ausw\u00E4hlen.');
    return false;
  }

  const uploadFile = await compressImageFile(file);
  const formData = new FormData();
  formData.append('file', uploadFile);

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

async function compressImageFile(file) {
  if (!file.type || !file.type.startsWith('image/') || file.type === 'image/gif') {
    return file;
  }

  const imageUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(imageUrl);
    const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(image.naturalWidth, image.naturalHeight));

    if (scale >= 1 && file.size < 700_000) {
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');

    if (!context) {
      return file;
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', IMAGE_QUALITY);

    if (!blob || blob.size >= file.size) {
      return file;
    }

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'bankfoto';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
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
  if (!confirm('Bank wirklich l\u00F6schen? Sie bleibt im Backup und kann technisch wiederhergestellt werden.')) return;

  await deleteBench(benchId);
}

async function deleteBench(benchId) {
  let response;
  try {
    response = await fetch(apiUrl(`/api/benches/${benchId}`), {
      method: 'DELETE'
    });
  } catch (error) {
    alert(`Fehler beim L\u00F6schen der Bank. Netzwerkfehler: ${error.message}`);
    return;
  }

  if (!response.ok) {
    const detail = await readErrorMessage(response);
    alert(`Fehler beim L\u00F6schen der Bank. ${detail}`);
    return;
  }

  closePanel();
  await loadBenches();
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
        <button type="button" class="danger compact" data-action="remove-photo" ${bench.image_url ? '' : 'hidden'}>Foto l&ouml;schen</button>
        <small class="photo-remove-note" data-role="photo-remove-note" hidden>Foto wird beim Speichern gel&ouml;scht.</small>
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
  const removePhotoButton = form.querySelector('[data-action="remove-photo"]');
  const savePositionButton = form.querySelector('[data-action="save-position"]');
  const cancelPositionButton = form.querySelector('[data-action="cancel-position"]');
  const imageInput = form.querySelector('input[name="image"]');
  const imagePreviewElement = form.querySelector('[data-role="image-preview"]');
  const photoRemoveNote = form.querySelector('[data-role="photo-remove-note"]');
  const originalPosition = { lat: bench.lat, lng: bench.lng };
  const state = getMarkerState(bench.id);
  let popupImageFile = null;
  let popupImagePreviewUrl = null;
  let shouldRemovePhoto = false;
  const cleanupPopupImagePreview = () => {
    if (!popupImagePreviewUrl) return;
    URL.revokeObjectURL(popupImagePreviewUrl);
    popupImagePreviewUrl = null;
  };

  imageInput?.addEventListener('change', () => {
    popupImageFile = imageInput.files?.[0] ?? null;
    cleanupPopupImagePreview();

    if (popupImageFile) {
      shouldRemovePhoto = false;
      photoRemoveNote.hidden = true;
      removePhotoButton.hidden = false;
      popupImagePreviewUrl = URL.createObjectURL(popupImageFile);
      showImagePreview(imagePreviewElement, popupImagePreviewUrl);
      return;
    }

    shouldRemovePhoto = false;
    photoRemoveNote.hidden = true;
    removePhotoButton.hidden = !bench.image_url;
    showImagePreview(imagePreviewElement, bench.image_url || null);
  });

  removePhotoButton?.addEventListener('click', () => {
    popupImageFile = null;
    shouldRemovePhoto = true;
    cleanupPopupImagePreview();

    if (imageInput) {
      imageInput.value = '';
    }

    showImagePreview(imagePreviewElement, null);
    removePhotoButton.hidden = true;
    photoRemoveNote.hidden = false;
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
    } else if (shouldRemovePhoto) {
      payload.image_url = null;
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

  startUserLocationWatch();
  return requestUserLocationOnce();
}

function renderUserLocation(point) {
  const latLng = [point.lat, point.lng];

  if (!userLocationMarker) {
    userLocationMarker = leaflet.circleMarker(latLng, {
      radius: 8,
      color: '#1d4ed8',
      fillColor: '#60a5fa',
      fillOpacity: 0.9,
      weight: 2
    })
      .addTo(map)
      .bindPopup('Dein Standort');
  } else {
    userLocationMarker.setLatLng(latLng);
  }

  renderUserLocationAccuracy(point);
  updateLocationAccuracyNote(point);
  userLocationMarker.bringToFront();
}

function setSelectedImage(file) {
  selectedImageFile = file;
  cleanupSelectedImagePreview();

  if (file) {
    shouldRemoveCurrentImage = false;
    removeImageNote.hidden = true;
    removeImageBtn.hidden = false;
    selectedImagePreviewUrl = URL.createObjectURL(file);
    showImagePreview(imagePreview, selectedImagePreviewUrl);
    return;
  }

  shouldRemoveCurrentImage = false;
  removeImageNote.hidden = true;
  removeImageBtn.hidden = !currentImageUrl;
  showImagePreview(imagePreview, currentImageUrl);
}

function resetImageField(imageUrl = null) {
  cleanupSelectedImagePreview();

  selectedImageFile = null;
  shouldRemoveCurrentImage = false;
  currentImageUrl = imageUrl;

  if (fieldImage) {
    fieldImage.value = '';
  }

  removeImageBtn.hidden = !imageUrl;
  removeImageNote.hidden = true;
  showImagePreview(imagePreview, imageUrl);
}

function cleanupSelectedImagePreview() {
  if (!selectedImagePreviewUrl) return;
  URL.revokeObjectURL(selectedImagePreviewUrl);
  selectedImagePreviewUrl = null;
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
  startUserLocationWatch();
}

function startUserLocationWatch() {
  if (!navigator.geolocation) {
    updateLocationAccuracyNote(null);
    return;
  }

  if (userLocationWatchId !== null) return;

  userLocationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const point = parseUserLocation(position);
      userLocation = point;
      renderUserLocation(point);
    },
    () => {
      updateLocationAccuracyNote(null);
    },
    LOCATION_OPTIONS
  );
}

function requestUserLocationOnce() {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = parseUserLocation(position);
        userLocation = point;
        renderUserLocation(point);
        resolve(point);
      },
      () => {
        updateLocationAccuracyNote(null);
        resolve(null);
      },
      LOCATION_OPTIONS
    );
  });
}

function parseUserLocation(position) {
  const accuracy = Number.isFinite(position.coords.accuracy)
    ? Math.round(position.coords.accuracy)
    : null;

  return {
    lat: Number(position.coords.latitude.toFixed(6)),
    lng: Number(position.coords.longitude.toFixed(6)),
    accuracy
  };
}

function renderUserLocationAccuracy(point) {
  if (!point || !point.accuracy) {
    if (userLocationAccuracyCircle) {
      map.removeLayer(userLocationAccuracyCircle);
      userLocationAccuracyCircle = null;
    }
    return;
  }

  const latLng = [point.lat, point.lng];

  if (!userLocationAccuracyCircle) {
    userLocationAccuracyCircle = leaflet.circle(latLng, {
      radius: point.accuracy,
      stroke: true,
      color: '#2563eb',
      weight: 1,
      opacity: 0.32,
      fillColor: '#93c5fd',
      fillOpacity: 0.16,
      interactive: false
    }).addTo(map);
    return;
  }

  userLocationAccuracyCircle.setLatLng(latLng);
  userLocationAccuracyCircle.setRadius(point.accuracy);
}

function updateLocationAccuracyNote(point) {
  if (!locationAccuracyNote) return;

  if (!point) {
    locationAccuracyNote.hidden = true;
    return;
  }

  const isUnclear = !point.accuracy || point.accuracy > LOCATION_UNCLEAR_THRESHOLD_METERS;
  locationAccuracyNote.hidden = !isUnclear;

  if (!isUnclear) return;

  locationAccuracyNote.textContent = point.accuracy
    ? `Standort ungenau +/- ${point.accuracy} m`
    : 'Standort ungenau';
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

function renderBenchList() {
  if (!benchList || !benchSortSelect) return;

  const benches = sortedBenches(currentBenches, benchSortSelect.value);
  updateBenchListCount(benches.length);

  if (!benches.length) {
    benchList.innerHTML = '<p class="bench-list-empty">Keine B&auml;nke gefunden.</p>';
    return;
  }

  benchList.innerHTML = benches.map((bench) => {
    const status = bench.status || 'removed';
    const statusLabel = statusLabels[status] ?? status;
    const hasPhoto = Boolean(bench.image_url);
    const displayNumber = getBenchDisplayNumber(bench);
    const overdueClass = isBenchOverdue(bench) ? ' is-overdue' : '';

    return `
    <button class="bench-list-item${overdueClass}" type="button" data-bench-id="${bench.id}">
      <span class="bench-list-main">
        <span class="bench-list-topline">
          <span class="bench-list-number">#${displayNumber}</span>
          <strong>${escapeHtml(bench.title || `Bank ${bench.id}`)}</strong>
        </span>
        <span class="bench-list-details">
          <span class="bench-list-status">
            <span class="dot ${escapeHtml(status)}"></span>
            ${escapeHtml(statusLabel)}
          </span>
          <span class="bench-list-date">Kontrolle: ${escapeHtml(formatInspectionDate(bench.last_inspection))}</span>
          ${hasPhoto ? '<span class="bench-list-photo">Foto</span>' : '<span class="bench-list-photo is-missing">Ohne Foto</span>'}
        </span>
      </span>
    </button>
  `;
  }).join('');

  benchList.querySelectorAll('.bench-list-item').forEach((item) => {
    item.addEventListener('click', () => {
      const benchId = Number(item.dataset.benchId);
      const bench = currentBenches.find((candidate) => candidate.id === benchId);
      const marker = markers.get(benchId);

      if (!bench) return;
      benchListPanel.hidden = true;

      if (marker) {
        map.panTo([bench.lat, bench.lng], { animate: true });
        if (adminToggle.checked) {
          openEditPanel(bench, marker);
          return;
        }

        marker.openPopup();
        return;
      }

      if (adminToggle.checked) {
        alert('Diese Bank ist inaktiv und wird nicht auf der Karte angezeigt.');
      }
    });
  });
}

function buildBenchDisplayNumbers(benches) {
  return new Map(
    [...benches]
      .sort((a, b) => {
        const createdDiff = dateSortValue(a.created_at) - dateSortValue(b.created_at);
        if (createdDiff !== 0) return createdDiff;
        return Number(a.id) - Number(b.id);
      })
      .map((bench, index) => [bench.id, index + 1])
  );
}

function getBenchDisplayNumber(bench) {
  return benchDisplayNumbers.get(bench.id) ?? bench.id;
}

function dateSortValue(value) {
  if (!value) return 0;
  const normalized = String(value).includes('T')
    ? String(value)
    : `${value.replace(' ', 'T')}Z`;
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? time : 0;
}

function updateBenchListCount(count) {
  if (!benchListCount) return;
  benchListCount.textContent = `${count} ${count === 1 ? 'Bank' : 'B\u00E4nke'}`;
}

function sortedBenches(benches, sortMode) {
  const next = [...benches];

  if (sortMode === 'inspection-asc') {
    return next.sort((a, b) => inspectionSortValue(a) - inspectionSortValue(b));
  }

  if (sortMode === 'status') {
    return next.sort((a, b) => {
      const statusDiff = statusSortValue(a) - statusSortValue(b);
      if (statusDiff !== 0) return statusDiff;
      return String(a.title || '').localeCompare(String(b.title || ''), 'de');
    });
  }

  return next.sort((a, b) => inspectionSortValue(b) - inspectionSortValue(a));
}

function inspectionSortValue(bench) {
  if (!bench.last_inspection) return 0;
  const time = new Date(`${bench.last_inspection}T00:00:00`).getTime();
  return Number.isFinite(time) ? time : 0;
}

function statusSortValue(bench) {
  const index = statusSortOrder.indexOf(bench.status);
  return index === -1 ? statusSortOrder.length : index;
}

function formatInspectionDate(value) {
  if (!value) return 'Keine Angabe';

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
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

function startPositionEdit(bench, marker) {
  const state = getMarkerState(bench.id);
  const currentLatLng = marker.getLatLng();
  const currentPosition = {
    lat: Number(currentLatLng.lat.toFixed(6)),
    lng: Number(currentLatLng.lng.toFixed(6))
  };

  activePositionEdit = {
    bench,
    marker,
    originalPosition: state.originalPosition || currentPosition
  };

  state.isMoving = true;
  state.originalPosition = { ...activePositionEdit.originalPosition };
  state.pendingPosition = state.pendingPosition ?? { ...currentPosition };
  selectedPoint = null;
  clearTempMarker();
  panel.hidden = true;
  marker.setLatLng([state.pendingPosition.lat, state.pendingPosition.lng]);
  marker.dragging.enable();
  marker.getElement()?.classList.add('is-moving');
  map.panTo([state.pendingPosition.lat, state.pendingPosition.lng], { animate: true });
  renderPositionEditBar();
}

async function saveActivePositionEdit() {
  if (!activePositionEdit) return;

  const { bench, marker } = activePositionEdit;
  const state = getMarkerState(bench.id);
  const latLng = marker.getLatLng();
  const nextPosition = state.pendingPosition ?? {
    lat: Number(latLng.lat.toFixed(6)),
    lng: Number(latLng.lng.toFixed(6))
  };

  clearActivePositionEdit(false);
  await upsertBench(`/api/benches/${bench.id}`, 'PUT', nextPosition);
}

function cancelActivePositionEdit({ reopenPanel = false } = {}) {
  if (!activePositionEdit) return;
  const { bench, marker } = activePositionEdit;
  clearActivePositionEdit(true);

  if (reopenPanel) {
    openEditPanel(bench, marker);
  }
}

function clearActivePositionEdit(restorePosition) {
  if (!activePositionEdit) return;

  const { bench, marker, originalPosition } = activePositionEdit;
  if (restorePosition) {
    marker.setLatLng([originalPosition.lat, originalPosition.lng]);
  }

  const state = getMarkerState(bench.id);
  state.isMoving = false;
  state.pendingPosition = null;
  state.originalPosition = null;
  disableMarkerDragging(marker);
  marker.getElement()?.classList.remove('is-moving');
  positionEditBar.hidden = true;
  activePositionEdit = null;
}

function renderPositionEditBar() {
  if (!activePositionEdit) return;

  const { bench, marker } = activePositionEdit;
  const latLng = marker.getLatLng();
  const position = {
    lat: Number(latLng.lat.toFixed(6)),
    lng: Number(latLng.lng.toFixed(6))
  };

  positionEditTitle.textContent = `Position \u00E4ndern: ${bench.title || `Bank ${bench.id}`}`;
  positionEditHint.textContent = `Marker verschieben. Aktuell: ${position.lat}, ${position.lng}`;
  positionEditBar.hidden = false;
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

function createMapPane(name, zIndex) {
  const pane = map.createPane(name);
  pane.style.zIndex = String(zIndex);
  pane.style.pointerEvents = 'none';
  return pane;
}

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function updateAdminControls() {
  if (addCurrentLocationBtn) {
    addCurrentLocationBtn.hidden = !adminToggle.checked;
  }
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

loadMunicipalityBoundary();
loadBenches();
showUserLocation();
updateAdminControls();
