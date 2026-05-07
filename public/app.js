const INNICHEN_CENTER = [46.7326, 12.2817];
const API_BASE_URL = resolveApiBaseUrl();
const MUNICIPALITY_GEOJSON_URL = './innichen_gemeindegebiet_exakt.geojson';
const OVERDUE_MONTHS = 10;
const TRAIL_ICON_BASE_WIDTH = 118;
const TRAIL_ICON_BASE_HEIGHT = 39;
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
const trailMarkers = new Map();
const trailMarkerStates = new Map();
let municipalityMaskLayer = null;
let municipalityBoundaryLayer = null;
const statusColors = {
  good: '#16a34a',
  ok: '#f97316',
  to_check: '#f97316',
  repair: '#dc2626',
  removed: '#9ca3af',
  inactive: '#6b7280'
};

const statusLabels = {
  good: 'Guter Zustand',
  ok: 'In Ordnung',
  to_check: 'Zu kontrollieren',
  repair: 'Reparatur n\u00F6tig',
  removed: 'Entfernt',
  inactive: 'Inaktiv'
};

const adminToggle = document.getElementById('adminMode');
const appTitle = document.getElementById('appTitle');
const benchViewBtn = document.getElementById('benchViewBtn');
const trailViewBtn = document.getElementById('trailViewBtn');
const reloadBtn = document.getElementById('reloadBtn');
const benchListBtn = document.getElementById('benchListBtn');
const benchListPanel = document.getElementById('benchListPanel');
const closeBenchListBtn = document.getElementById('closeBenchListBtn');
const trailListPanel = document.getElementById('trailListPanel');
const closeTrailListBtn = document.getElementById('closeTrailListBtn');
const trailSortSelect = document.getElementById('trailSortSelect');
const trailList = document.getElementById('trailList');
const trailListCount = document.getElementById('trailListCount');
const globalHistoryBtn = document.getElementById('globalHistoryBtn');
const globalHistoryPanel = document.getElementById('globalHistoryPanel');
const closeGlobalHistoryBtn = document.getElementById('closeGlobalHistoryBtn');
const globalHistoryList = document.getElementById('globalHistoryList');
const globalHistoryCount = document.getElementById('globalHistoryCount');
const benchSortSelect = document.getElementById('benchSortSelect');
const benchList = document.getElementById('benchList');
const benchListCount = document.getElementById('benchListCount');
const addCurrentLocationBtn = document.getElementById('addCurrentLocationBtn');
const panel = document.getElementById('editorPanel');
const panelTitle = document.getElementById('panelTitle');
const benchForm = document.getElementById('benchForm');
const cancelBtn = document.getElementById('cancelBtn');
const fieldNamePreset = document.getElementById('fieldNamePreset');
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
const historySection = document.getElementById('historySection');
const historyCount = document.getElementById('historyCount');
const historyList = document.getElementById('historyList');
const positionEditBar = document.getElementById('positionEditBar');
const positionEditTitle = document.getElementById('positionEditTitle');
const positionEditHint = document.getElementById('positionEditHint');
const savePositionBtn = document.getElementById('savePositionBtn');
const cancelPositionBtn = document.getElementById('cancelPositionBtn');
const locationAccuracyNote = document.getElementById('locationAccuracyNote');
const trailPanel = document.getElementById('trailEditorPanel');
const trailPanelTitle = document.getElementById('trailPanelTitle');
const trailPoleForm = document.getElementById('trailPoleForm');
const cancelTrailBtn = document.getElementById('cancelTrailBtn');
const fieldTrailSiteNumber = document.getElementById('fieldTrailSiteNumber');
const fieldTrailActive = document.getElementById('fieldTrailActive');
const fieldTrailNotes = document.getElementById('fieldTrailNotes');
const trailFormError = document.getElementById('trailFormError');
const trailSignboards = document.getElementById('trailSignboards');
const addTrailSignboardBtn = document.getElementById('addTrailSignboardBtn');
const trailEditPanelActions = document.getElementById('trailEditPanelActions');
const moveTrailPositionBtn = document.getElementById('moveTrailPositionBtn');
const deleteTrailPoleBtn = document.getElementById('deleteTrailPoleBtn');

const statusSortOrder = ['repair', 'inactive', 'ok', 'to_check', 'good', 'removed'];
const MAX_IMAGE_SIZE = 1600;
const IMAGE_QUALITY = 0.72;
const LOCATION_UNCLEAR_THRESHOLD_METERS = 30;
const USER_LOCATION_MIN_MOVE_METERS = 2;
const USER_LOCATION_STALE_MS = 12000;
const LOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 20000,
  maximumAge: 3000
};

let editMode = null;
let currentView = 'benches';
let selectedBenchId = null;
let selectedTrailPoleId = null;
let selectedPoint = null;
let tempMarker = null;
let userLocationMarker = null;
let userLocationAccuracyCircle = null;
let userLocation = null;
let userLocationWatchId = null;
let userLocationPromise = null;
let userLocationDenied = false;
let selectedImageFile = null;
let selectedImagePreviewUrl = null;
let currentImageUrl = null;
let shouldRemoveCurrentImage = false;
let currentEditBench = null;
let currentEditMarker = null;
let currentEditTrailPole = null;
let currentEditTrailMarker = null;
let activePositionEdit = null;
let currentBenches = [];
let currentTrailPoles = [];
let hasShownLoadError = false;

reloadBtn.addEventListener('click', () => {
  window.location.reload();
});
benchViewBtn?.addEventListener('click', () => {
  setActiveView('benches');
});
trailViewBtn?.addEventListener('click', () => {
  setActiveView('trails');
});
benchListBtn?.addEventListener('click', () => {
  if (currentView === 'trails') {
    trailListPanel.hidden = !trailListPanel.hidden;
    if (!trailListPanel.hidden) {
      closeGlobalHistoryPanel();
      if (benchListPanel) benchListPanel.hidden = true;
      renderTrailList();
    }
    return;
  }

  benchListPanel.hidden = !benchListPanel.hidden;
  if (!benchListPanel.hidden) {
    closeGlobalHistoryPanel();
    if (trailListPanel) trailListPanel.hidden = true;
    renderBenchList();
  }
});
closeBenchListBtn?.addEventListener('click', () => {
  benchListPanel.hidden = true;
});
closeTrailListBtn?.addEventListener('click', () => {
  trailListPanel.hidden = true;
});
globalHistoryBtn?.addEventListener('click', () => {
  if (!globalHistoryPanel) return;
  if (currentView !== 'benches') return;

  globalHistoryPanel.hidden = !globalHistoryPanel.hidden;
  if (!globalHistoryPanel.hidden) {
    benchListPanel.hidden = true;
    loadGlobalHistory();
  }
});
closeGlobalHistoryBtn?.addEventListener('click', closeGlobalHistoryPanel);
benchSortSelect?.addEventListener('change', renderBenchList);
trailSortSelect?.addEventListener('change', renderTrailList);
fieldNamePreset?.addEventListener('change', syncCustomNameVisibility);
adminToggle.addEventListener('change', () => {
  updateAdminControls();
  if (!adminToggle.checked) {
    closePanel();
    closeTrailPanel();
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
    const itemLabel = currentView === 'trails' ? 'den Pfeiler' : 'die Bank';
    alert(`Standort ist nicht verf\u00FCgbar. Bitte Standortfreigabe erlauben oder ${itemLabel} per Klick auf die Karte hinzuf\u00FCgen.`);
    return;
  }

  selectedPoint = currentPosition;
  setTempMarker(currentPosition);
  if (currentView === 'trails') {
    openTrailAddPanel();
    return;
  }

  openAddPanel();
});

cancelBtn.addEventListener('click', closePanel);
cancelTrailBtn?.addEventListener('click', closeTrailPanel);
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
  startPositionEdit('bench', currentEditBench, currentEditMarker);
});

deleteBenchBtn?.addEventListener('click', async () => {
  if (!currentEditBench) return;
  await archiveBench(currentEditBench.id);
});

addTrailSignboardBtn?.addEventListener('click', () => {
  addTrailSignboardEditor();
});
trailSignboards?.addEventListener('click', handleTrailSignboardAction);

moveTrailPositionBtn?.addEventListener('click', () => {
  if (!currentEditTrailPole || !currentEditTrailMarker) return;
  startPositionEdit('trail', currentEditTrailPole, currentEditTrailMarker);
});

deleteTrailPoleBtn?.addEventListener('click', async () => {
  if (!currentEditTrailPole) return;
  await archiveTrailPole(currentEditTrailPole.id);
});

savePositionBtn?.addEventListener('click', saveActivePositionEdit);
cancelPositionBtn?.addEventListener('click', () => {
  cancelActivePositionEdit({ reopenPanel: true });
});

map.on('moveend resize baselayerchange', refreshMunicipalityLayers);
map.on('zoom zoomend', updateTrailMarkerScales);

benchForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    title: getSelectedBenchTitle(),
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

trailPoleForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = readTrailPoleFormPayload();
  if (!payload) return;

  if (editMode === 'trail-add' && !selectedPoint) {
    alert('Bitte zuerst einen Standort f\u00FCr den neuen Pfeiler ausw\u00E4hlen.');
    return;
  }

  if (editMode === 'trail-add') {
    await upsertTrailPole('/api/trail-poles', 'POST', {
      ...payload,
      lat: selectedPoint.lat,
      lng: selectedPoint.lng
    });
    return;
  }

  if (editMode === 'trail-edit' && selectedTrailPoleId !== null) {
    await upsertTrailPole(`/api/trail-poles/${selectedTrailPoleId}`, 'PUT', payload);
  }
});

map.on('click', (event) => {
  if (!adminToggle.checked) return;

  selectedPoint = {
    lat: Number(event.latlng.lat.toFixed(6)),
    lng: Number(event.latlng.lng.toFixed(6))
  };

  setTempMarker(selectedPoint);
  if (currentView === 'trails') {
    openTrailAddPanel();
    return;
  }

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
  currentBenches = benches.filter(isVisibleBench);

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

async function loadTrailPoles() {
  let response;
  try {
    response = await fetch(apiUrl('/api/trail-poles?active=all'));
  } catch (error) {
    handleTrailPoleLoadError(`Netzwerkfehler: ${error.message}`);
    return;
  }

  if (!response.ok) {
    const detail = await readErrorMessage(response);
    handleTrailPoleLoadError(detail);
    return;
  }

  const poles = await response.json();
  currentTrailPoles = poles;

  clearTrailMarkers();

  for (const pole of currentTrailPoles) {
    addTrailMarker(pole);
  }

  renderTrailList();
}

async function setActiveView(view) {
  if (currentView === view) return;

  cancelActivePositionEdit();
  closePanel();
  closeTrailPanel();
  closeGlobalHistoryPanel();
  if (benchListPanel) benchListPanel.hidden = true;
  if (trailListPanel) trailListPanel.hidden = true;

  currentView = view;
  updateViewControls();

  if (currentView === 'trails') {
    clearBenchMarkers();
    await loadTrailPoles();
    return;
  }

  clearTrailMarkers();
  await loadBenches();
}

function updateViewControls() {
  const isTrailView = currentView === 'trails';

  if (appTitle) {
    appTitle.textContent = isTrailView ? 'Wandertafeln Innichen' : 'Bankkarte Innichen';
  }

  benchViewBtn?.classList.toggle('is-active', !isTrailView);
  trailViewBtn?.classList.toggle('is-active', isTrailView);
  benchListBtn.hidden = false;
  benchListBtn.title = isTrailView ? 'Pfeilerliste' : 'B\u00E4nkeliste';
  benchListBtn.setAttribute('aria-label', isTrailView ? 'Pfeilerliste' : 'B\u00E4nkeliste');
  globalHistoryBtn.hidden = isTrailView;

  const legend = document.querySelector('.legend');
  if (legend) {
    legend.hidden = isTrailView;
  }

  const legendTitle = document.querySelector('.legend h2');
  if (legendTitle) {
    legendTitle.textContent = 'Statusfarben';
  }

  const legendList = document.querySelector('.legend ul');
  if (legendList) {
    legendList.innerHTML = `
        <li><span class="dot good"></span> Guter Zustand</li>
        <li><span class="dot ok"></span> In Ordnung</li>
        <li><span class="dot repair"></span> Reparatur n&ouml;tig</li>
        <li><span class="dot inactive"></span> Inaktiv</li>
      `;
  }

  updateAdminControls();
}

function clearBenchMarkers() {
  for (const marker of markers.values()) {
    map.removeLayer(marker);
  }
  markers.clear();
  markerStates.clear();
}

function clearTrailMarkers() {
  for (const marker of trailMarkers.values()) {
    map.removeLayer(marker);
  }
  trailMarkers.clear();
  trailMarkerStates.clear();
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

function addTrailMarker(pole) {
  const marker = leaflet.marker([pole.lat, pole.lng], {
    icon: trailMarkerIcon(pole),
    draggable: false
  }).addTo(map);

  marker.bindPopup(trailPopupHtml(pole), {
    closeOnClick: true,
    autoClose: true,
    autoPan: false
  });

  marker.on('click', () => {
    if (!adminToggle.checked) return;
    marker.closePopup();
    openTrailEditPanel(pole, marker);
  });

  marker.on('popupopen', () => {
    if (adminToggle.checked) {
      marker.closePopup();
      return;
    }

    marker.setPopupContent(trailPopupHtml(pole));
  });

  marker.on('dragend', () => {
    const state = getTrailMarkerState(pole.id);
    if (!state.isMoving) {
      marker.setLatLng([pole.lat, pole.lng]);
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
    const state = getTrailMarkerState(pole.id);
    if (state.isMoving) return;

    disableMarkerDragging(marker);
    if (!state.pendingPosition) {
      marker.setLatLng([pole.lat, pole.lng]);
    }
  });

  trailMarkers.set(pole.id, marker);
  applyTrailMarkerScale(marker);
}

function renderMarkerPopup(marker, bench) {
  const state = getMarkerState(bench.id);
  if (adminToggle.checked) {
    marker.closePopup();
    return;
  }

  marker.setPopupContent(popupHtml(bench));
}

function trailMarkerIcon(pole) {
  const rawLabel = String(pole.site_number || pole.id);
  const label = escapeHtml(rawLabel);
  const dimensions = trailMarkerPresentation(rawLabel);
  const state = trailMarkerStates.get(pole.id);

  return leaflet.divIcon({
    className: `trail-marker-icon${pole.active ? '' : ' is-inactive'}${state?.isMoving ? ' is-moving' : ''}`,
    html: `
      <span class="trail-marker-pin" style="--trail-marker-scale:${trailMarkerScale()}; --trail-marker-font-size:${dimensions.fontSize}px">
        <span class="trail-marker-number">${label}</span>
      </span>
    `,
    iconSize: [dimensions.width, dimensions.height],
    iconAnchor: [Math.round(dimensions.width * 0.5), Math.round(dimensions.height * 0.5)],
    popupAnchor: [0, -Math.round(dimensions.height * 0.5)]
  });
}

function trailMarkerPresentation(label) {
  const labelWidth = String(label).length * 10 + 74;
  const baseWidth = Math.max(TRAIL_ICON_BASE_WIDTH, labelWidth);
  const textScale = Math.min(1, 7 / Math.max(1, String(label).length));

  return {
    width: baseWidth,
    height: TRAIL_ICON_BASE_HEIGHT,
    fontSize: Math.max(6, Math.round(11 * textScale * 10) / 10)
  };
}

function trailMarkerScale() {
  return Math.round(clamp(0.46 + ((map.getZoom() - 14) * 0.135), 0.46, 1) * 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function updateTrailMarkerScales() {
  if (currentView !== 'trails') return;

  for (const marker of trailMarkers.values()) {
    applyTrailMarkerScale(marker);
  }
}

function applyTrailMarkerScale(marker) {
  marker.getElement()
    ?.querySelector('.trail-marker-pin')
    ?.style.setProperty('--trail-marker-scale', trailMarkerScale());
}

function openAddPanel() {
  cancelActivePositionEdit();
  closeTrailPanel({ keepTempMarker: true });
  editMode = 'add';
  selectedBenchId = null;
  currentEditBench = null;
  currentEditMarker = null;
  panelTitle.textContent = 'Bank hinzuf\u00FCgen';
  resetImageField();
  setBenchTitleControls('Sitzbank');
  fieldStatus.value = 'good';
  fieldInspection.value = todayDateString();
  fieldNotes.value = '';
  fieldActive.value = '1';
  editPanelActions.hidden = true;
  clearBenchHistory();
  panel.hidden = false;
}

function openEditPanel(bench, marker) {
  cancelActivePositionEdit();
  closeTrailPanel();
  editMode = 'edit';
  selectedBenchId = bench.id;
  selectedPoint = null;
  currentEditBench = bench;
  currentEditMarker = marker;
  panelTitle.textContent = 'Bank bearbeiten';
  resetImageField(bench.image_url || null);
  setBenchTitleControls(bench.title || 'Sitzbank');
  fieldStatus.value = bench.status || 'good';
  fieldInspection.value = bench.last_inspection || '';
  fieldNotes.value = bench.notes || '';
  fieldActive.value = bench.active ? '1' : '0';
  editPanelActions.hidden = false;
  loadBenchHistory(bench.id);
  panel.hidden = false;
}

function closePanel({ keepTempMarker = false } = {}) {
  cancelActivePositionEdit();
  editMode = null;
  selectedBenchId = null;
  if (!keepTempMarker) selectedPoint = null;
  currentEditBench = null;
  currentEditMarker = null;
  panel.hidden = true;
  benchForm.reset();
  resetImageField();
  clearBenchHistory();
  if (!keepTempMarker) clearTempMarker();
}

function openTrailAddPanel() {
  cancelActivePositionEdit();
  closePanel({ keepTempMarker: true });
  editMode = 'trail-add';
  selectedTrailPoleId = null;
  currentEditTrailPole = null;
  currentEditTrailMarker = null;
  trailPanelTitle.textContent = 'Wandertafel-Pfeiler hinzuf\u00FCgen';
  fieldTrailSiteNumber.value = '';
  if (fieldTrailActive) fieldTrailActive.value = '1';
  fieldTrailNotes.value = '';
  showTrailFormError(null);
  renderTrailSignboards([
    {
      direction: '',
      trail_number: '',
      sort_order: 0,
      entries: [{ label: '', duration: '', sort_order: 0 }]
    }
  ]);
  trailEditPanelActions.hidden = true;
  trailPanel.hidden = false;
}

function openTrailEditPanel(pole, marker) {
  cancelActivePositionEdit();
  closePanel();
  editMode = 'trail-edit';
  selectedTrailPoleId = pole.id;
  selectedPoint = null;
  currentEditTrailPole = pole;
  currentEditTrailMarker = marker;
  trailPanelTitle.textContent = 'Wandertafel-Pfeiler bearbeiten';
  fieldTrailSiteNumber.value = pole.site_number || '';
  if (fieldTrailActive) fieldTrailActive.value = pole.active ? '1' : '0';
  fieldTrailNotes.value = pole.notes || '';
  showTrailFormError(null);
  renderTrailSignboards(pole.signboards?.length ? pole.signboards : []);
  trailEditPanelActions.hidden = false;
  trailPanel.hidden = false;
}

function closeTrailPanel({ keepTempMarker = false } = {}) {
  cancelActivePositionEdit();
  editMode = null;
  selectedTrailPoleId = null;
  currentEditTrailPole = null;
  currentEditTrailMarker = null;
  trailPanel.hidden = true;
  trailPoleForm?.reset();
  showTrailFormError(null);
  if (trailSignboards) trailSignboards.innerHTML = '';
  if (!keepTempMarker) clearTempMarker();
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
  const visualStatus = benchVisualStatus(bench);
  const color = statusColors[visualStatus] ?? '#6b7280';
  const markerLabel = escapeHtml(String(bench.id));
  const overdueBadge = isBenchOverdue(bench)
    ? '<span class="bench-marker-badge" aria-hidden="true">!</span>'
    : '';
  const noPhotoBadge = bench.image_url
    ? ''
    : '<span class="bench-marker-photo-missing" aria-hidden="true"></span>';

  return leaflet.divIcon({
    className: `bench-marker-icon${bench.image_url ? '' : ' is-missing-photo'}${bench.active ? '' : ' is-inactive'}`,
    html: `
      <span class="bench-marker-pin" style="background:${color}">
        <span class="bench-marker-number">${markerLabel}</span>
        ${overdueBadge}
        ${noPhotoBadge}
      </span>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -16]
  });
}

function popupHtml(bench) {
  const visualStatus = benchVisualStatus(bench);
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
        <small>#${bench.id}</small>
      </div>
      <div class="popup-meta">
        <span><b>Status:</b> ${statusLabels[visualStatus] ?? escapeHtml(visualStatus)}</span>
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

function trailPopupHtml(pole) {
  const signboardsHtml = pole.signboards?.length
    ? pole.signboards.map((signboard) => {
      const entries = signboard.entries?.length
        ? signboard.entries.map((entry) => `
          <li>
            ${escapeHtml(entry.label)}
            ${formatTrailDuration(entry.duration) ? ` · ${escapeHtml(formatTrailDuration(entry.duration))}` : ''}
          </li>
        `).join('')
        : '<li>Keine Anschriften</li>';

      return `
        <div class="popup-signboard">
          <div class="popup-signboard-title">
            <strong>${escapeHtml(signboard.direction)}</strong>
            <small>Weg ${escapeHtml(signboard.trail_number)}</small>
          </div>
          <ul>${entries}</ul>
        </div>
      `;
    }).join('')
    : '<div class="popup-signboard"><div class="popup-signboard-title"><strong>Keine Tafeln gepflegt</strong></div></div>';

  return `
    <div class="popup-card">
      <div class="popup-header">
        <strong>Standort ${escapeHtml(pole.site_number)}</strong>
        <small>#${pole.id}</small>
      </div>
      <div class="popup-meta">
        <span><b>Tafeln:</b> ${pole.signboards?.length || 0}</span>
      </div>
      <div class="popup-notes">
        <b>Notiz:</b> ${pole.notes ? escapeHtml(pole.notes) : '-'}
      </div>
      <div class="popup-signboards">
        ${signboardsHtml}
      </div>
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

async function upsertTrailPole(path, method, payload) {
  let response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    showTrailFormError(`Fehler beim Speichern des Pfeilers. Netzwerkfehler: ${error.message}`);
    return;
  }

  if (!response.ok) {
    const detail = await readErrorMessage(response);
    showTrailFormError(`Fehler beim Speichern des Pfeilers. ${detail}`);
    return;
  }

  closeTrailPanel();
  await loadTrailPoles();
  return true;
}

async function loadBenchHistory(benchId) {
  if (!historySection || !historyList) return;

  historySection.hidden = false;
  historyList.innerHTML = '<p class="history-empty">Verlauf wird geladen...</p>';
  if (historyCount) historyCount.textContent = '';

  let response;
  try {
    response = await fetch(apiUrl(`/api/benches/${benchId}/history`));
  } catch (error) {
    historyList.innerHTML = `<p class="history-empty">Verlauf konnte nicht geladen werden: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!response.ok) {
    const detail = await readErrorMessage(response);
    historyList.innerHTML = `<p class="history-empty">Verlauf konnte nicht geladen werden: ${escapeHtml(detail)}</p>`;
    return;
  }

  const entries = await response.json();
  renderBenchHistory(entries);
}

async function loadGlobalHistory() {
  if (!globalHistoryPanel || !globalHistoryList) return;

  globalHistoryPanel.hidden = false;
  globalHistoryList.innerHTML = '<p class="history-empty">Gesamtverlauf wird geladen...</p>';
  if (globalHistoryCount) globalHistoryCount.textContent = '';

  let response;
  try {
    response = await fetch(apiUrl('/api/history?limit=160'));
  } catch (error) {
    globalHistoryList.innerHTML = `<p class="history-empty">Gesamtverlauf konnte nicht geladen werden: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!response.ok) {
    const detail = await readErrorMessage(response);
    globalHistoryList.innerHTML = `<p class="history-empty">Gesamtverlauf konnte nicht geladen werden: ${escapeHtml(detail)}</p>`;
    return;
  }

  const entries = await response.json();
  renderGlobalHistory(entries);
}

function renderGlobalHistory(entries) {
  if (!globalHistoryList) return;

  if (globalHistoryCount) {
    globalHistoryCount.textContent = `${entries.length} Eintr\u00E4ge`;
  }

  if (!entries.length) {
    globalHistoryList.innerHTML = '<p class="history-empty">Noch keine Änderungen gespeichert.</p>';
    return;
  }

  globalHistoryList.innerHTML = entries.map((entry) => {
    const title = entry.bench_title || `Bank #${entry.bench_id}`;
    const status = entry.bench_status || 'removed';

    return `
      <article class="global-history-item" data-bench-id="${entry.bench_id}">
        <div class="global-history-top">
          <span class="bench-list-number">#${entry.bench_id}</span>
          <strong>${escapeHtml(title)}</strong>
          <span class="dot ${escapeHtml(status)}"></span>
        </div>
        <div class="history-item-top">
          <span>${escapeHtml(historyActionLabel(entry.action))}</span>
          <span>${escapeHtml(formatHistoryDate(entry.created_at))}</span>
        </div>
        <small>${escapeHtml(entry.actor || 'Admin')}</small>
        ${historyChangeSummary(entry)}
      </article>
    `;
  }).join('');

  globalHistoryList.querySelectorAll('.global-history-item').forEach((item) => {
    item.addEventListener('click', () => {
      const benchId = Number(item.dataset.benchId);
      const bench = currentBenches.find((candidate) => candidate.id === benchId);
      const marker = markers.get(benchId);

      if (!bench || !marker) return;

      closeGlobalHistoryPanel();
      map.panTo([bench.lat, bench.lng], { animate: true });

      if (adminToggle.checked) {
        openEditPanel(bench, marker);
        return;
      }

      marker.openPopup();
    });
  });
}

function renderBenchHistory(entries) {
  if (!historySection || !historyList) return;

  historySection.hidden = false;
  if (historyCount) {
    historyCount.textContent = `${entries.length}`;
  }

  if (!entries.length) {
    historyList.innerHTML = '<p class="history-empty">Noch keine Änderungen gespeichert.</p>';
    return;
  }

  historyList.innerHTML = entries.map((entry) => `
    <article class="history-item">
      <div class="history-item-top">
        <strong>${escapeHtml(historyActionLabel(entry.action))}</strong>
        <span>${escapeHtml(formatHistoryDate(entry.created_at))}</span>
      </div>
      <small>${escapeHtml(entry.actor || 'Admin')}</small>
      ${historyChangeSummary(entry)}
    </article>
  `).join('');
}

function historyChangeSummary(entry) {
  const changes = Array.isArray(entry.details?.changes)
    ? entry.details.changes
    : [];

  if (!changes.length) return '';

  return `
    <ul class="history-changes">
      ${changes.slice(0, 5).map((change) => `
        <li>
          <span>${escapeHtml(change.label || change.field)}</span>
          <b>${escapeHtml(formatHistoryValue(change.to, change.field))}</b>
        </li>
      `).join('')}
    </ul>
  `;
}

function clearBenchHistory() {
  if (historySection) historySection.hidden = true;
  if (historyList) historyList.innerHTML = '';
  if (historyCount) historyCount.textContent = '0';
}

function closeGlobalHistoryPanel() {
  if (globalHistoryPanel) globalHistoryPanel.hidden = true;
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

async function archiveTrailPole(poleId) {
  if (!confirm('Wandertafel-Pfeiler wirklich l\u00F6schen? Alle Tafeln und Anschriften werden mitgel\u00F6scht.')) return;

  await deleteTrailPole(poleId);
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

async function deleteTrailPole(poleId) {
  let response;
  try {
    response = await fetch(apiUrl(`/api/trail-poles/${poleId}`), {
      method: 'DELETE'
    });
  } catch (error) {
    alert(`Fehler beim L\u00F6schen des Pfeilers. Netzwerkfehler: ${error.message}`);
    return;
  }

  if (!response.ok) {
    const detail = await readErrorMessage(response);
    alert(`Fehler beim L\u00F6schen des Pfeilers. ${detail}`);
    return;
  }

  closeTrailPanel();
  await loadTrailPoles();
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

  if (!navigator.geolocation || userLocationDenied) {
    return null;
  }

  return startUserLocationWatch();
}

function renderUserLocation(point) {
  const latLng = [point.lat, point.lng];

  if (!userLocationMarker) {
    userLocationMarker = leaflet.marker(latLng, {
      icon: leaflet.divIcon({
        className: 'user-location-marker',
        html: '<span class="user-location-dot"></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000
    })
      .addTo(map);
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

async function initializeUserLocation() {
  if (!navigator.geolocation) return;

  if (!navigator.permissions?.query) {
    return;
  }

  try {
    const permission = await navigator.permissions.query({ name: 'geolocation' });
    if (permission.state === 'granted') {
      startUserLocationWatch();
    } else if (permission.state === 'denied') {
      userLocationDenied = true;
    }

    permission.onchange = () => {
      userLocationDenied = permission.state === 'denied';
      if (permission.state === 'granted') {
        startUserLocationWatch();
      }
    };
  } catch {
    // Some browsers expose geolocation but not its permission status.
  }
}

function startUserLocationWatch() {
  if (!navigator.geolocation || userLocationDenied) {
    updateLocationAccuracyNote(null);
    return Promise.resolve(null);
  }

  if (userLocation) {
    return Promise.resolve(userLocation);
  }

  if (userLocationPromise) {
    return userLocationPromise;
  }

  userLocationPromise = new Promise((resolve) => {
    userLocationWatchId = navigator.geolocation.watchPosition(
      (position) => {
        const point = parseUserLocation(position);
        if (shouldAcceptUserLocation(point)) {
          userLocation = point;
          renderUserLocation(point);
        }

        resolve(userLocation);
      },
      (error) => {
        if (error?.code === error?.PERMISSION_DENIED) {
          userLocationDenied = true;
        }
        updateLocationAccuracyNote(null);
        userLocationPromise = null;
        resolve(null);
      },
      LOCATION_OPTIONS
    );
  });

  return userLocationPromise;
}

function parseUserLocation(position) {
  const accuracy = Number.isFinite(position.coords.accuracy)
    ? Math.round(position.coords.accuracy)
    : null;

  return {
    lat: Number(position.coords.latitude.toFixed(6)),
    lng: Number(position.coords.longitude.toFixed(6)),
    accuracy,
    timestamp: position.timestamp || Date.now()
  };
}

function shouldAcceptUserLocation(nextPoint) {
  if (!userLocation) return true;

  const distance = distanceMeters(userLocation, nextPoint);
  const currentAccuracy = userLocation.accuracy ?? Number.POSITIVE_INFINITY;
  const nextAccuracy = nextPoint.accuracy ?? Number.POSITIVE_INFINITY;
  const isMoreAccurate = nextAccuracy + 1 < currentAccuracy;
  const isRealMovement = distance >= Math.max(USER_LOCATION_MIN_MOVE_METERS, nextAccuracy * 0.35);
  const isStale = (nextPoint.timestamp || Date.now()) - (userLocation.timestamp || 0) > USER_LOCATION_STALE_MS;

  return isMoreAccurate || isRealMovement || isStale;
}

function distanceMeters(from, to) {
  const fromLat = degreesToRadians(from.lat);
  const toLat = degreesToRadians(to.lat);
  const deltaLat = degreesToRadians(to.lat - from.lat);
  const deltaLng = degreesToRadians(to.lng - from.lng);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
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

function getTrailMarkerState(poleId) {
  if (!trailMarkerStates.has(poleId)) {
    trailMarkerStates.set(poleId, {
      isMoving: false,
      pendingPosition: null,
      originalPosition: null
    });
  }

  return trailMarkerStates.get(poleId);
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

  for (const [poleId, marker] of trailMarkers.entries()) {
    const state = getTrailMarkerState(poleId);
    if (!state.pendingPosition || !state.originalPosition) continue;

    resetTrailMarkerEditState(marker, poleId, state.originalPosition);
  }
}

function resetTrailMarkerEditState(marker, poleId, originalPosition) {
  const state = getTrailMarkerState(poleId);
  state.isMoving = false;
  state.pendingPosition = null;
  state.originalPosition = null;
  disableMarkerDragging(marker);
  marker.setLatLng([originalPosition.lat, originalPosition.lng]);
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
    const visualStatus = benchVisualStatus(bench);
    const statusLabel = statusLabels[visualStatus] ?? visualStatus;
    const hasPhoto = Boolean(bench.image_url);
    const overdueClass = isBenchOverdue(bench) ? ' is-overdue' : '';

    return `
    <button class="bench-list-item${overdueClass}" type="button" data-bench-id="${bench.id}">
      <span class="bench-list-main">
        <span class="bench-list-topline">
          <span class="bench-list-number">#${bench.id}</span>
          <strong>${escapeHtml(bench.title || `Bank ${bench.id}`)}</strong>
        </span>
        <span class="bench-list-details">
          <span class="bench-list-status">
            <span class="dot ${escapeHtml(visualStatus)}"></span>
            ${escapeHtml(statusLabel)}
          </span>
          ${hasPhoto ? '<span class="bench-list-photo">Foto</span>' : '<span class="bench-list-photo is-missing">Ohne Foto</span>'}
          <span class="bench-list-date">Kontrolle: ${escapeHtml(formatInspectionDate(bench.last_inspection))}</span>
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

function renderTrailList() {
  if (!trailList || !trailSortSelect) return;

  const poles = sortedTrailPoles(currentTrailPoles, trailSortSelect.value);
  updateTrailListCount(poles.length);

  if (!poles.length) {
    trailList.innerHTML = '<p class="bench-list-empty">Keine Wandertafel-Pfeiler gefunden.</p>';
    return;
  }

  trailList.innerHTML = poles.map((pole) => {
    const signboardCount = pole.signboards?.length || 0;
    const entryCount = countTrailEntries(pole);
    const firstEntry = firstTrailEntrySummary(pole);
    return `
      <button class="bench-list-item" type="button" data-trail-pole-id="${pole.id}">
        <span class="bench-list-main">
          <span class="bench-list-topline">
            <span class="bench-list-number">#${escapeHtml(pole.site_number || pole.id)}</span>
            <strong>Standort ${escapeHtml(pole.site_number || pole.id)}</strong>
          </span>
          <span class="bench-list-details">
            <span class="trail-list-summary">${signboardCount} ${signboardCount === 1 ? 'Tafel' : 'Tafeln'}</span>
            <span class="trail-list-summary">${entryCount} ${entryCount === 1 ? 'Anschrift' : 'Anschriften'}</span>
            <span class="trail-list-entry">${escapeHtml(firstEntry)}</span>
          </span>
        </span>
      </button>
    `;
  }).join('');

  trailList.querySelectorAll('[data-trail-pole-id]').forEach((item) => {
    item.addEventListener('click', () => {
      const poleId = Number(item.dataset.trailPoleId);
      const pole = currentTrailPoles.find((candidate) => candidate.id === poleId);
      const marker = trailMarkers.get(poleId);
      if (!pole) return;

      trailListPanel.hidden = true;
      map.panTo([pole.lat, pole.lng], { animate: true });

      if (adminToggle.checked && marker) {
        openTrailEditPanel(pole, marker);
        return;
      }

      marker?.openPopup();
    });
  });
}

function updateBenchListCount(count) {
  if (!benchListCount) return;
  benchListCount.textContent = `${count} ${count === 1 ? 'Bank' : 'B\u00E4nke'}`;
}

function updateTrailListCount(count) {
  if (!trailListCount) return;
  trailListCount.textContent = `${count} ${count === 1 ? 'Pfeiler' : 'Pfeiler'}`;
}

function getSelectedBenchTitle() {
  if (fieldNamePreset?.value === 'custom') {
    return fieldName.value.trim();
  }

  return fieldNamePreset?.value || fieldName.value.trim();
}

function setBenchTitleControls(title) {
  const normalizedTitle = title || 'Sitzbank';
  const presetValues = ['Sitzbank', 'Sitzbank + Tisch', 'Sitzbank ohne Lehne'];

  if (fieldNamePreset && presetValues.includes(normalizedTitle)) {
    fieldNamePreset.value = normalizedTitle;
    fieldName.value = '';
  } else {
    if (fieldNamePreset) fieldNamePreset.value = 'custom';
    fieldName.value = normalizedTitle;
  }

  syncCustomNameVisibility();
}

function syncCustomNameVisibility() {
  if (!fieldName || !fieldNamePreset) return;

  const isCustom = fieldNamePreset.value === 'custom';
  fieldName.hidden = !isCustom;
  fieldName.required = isCustom;
}

function renderTrailSignboards(signboards) {
  if (!trailSignboards) return;

  trailSignboards.innerHTML = '';
  for (const signboard of signboards) {
    addTrailSignboardEditor(signboard);
  }

  renumberTrailEditors();
}

function addTrailSignboardEditor(signboard = null) {
  if (!trailSignboards) return;

  const index = trailSignboards.querySelectorAll('.trail-signboard-editor').length;
  trailSignboards.insertAdjacentHTML('beforeend', trailSignboardEditorHtml(signboard, index));
  renumberTrailEditors();
}

function trailSignboardEditorHtml(signboard, index) {
  const entries = signboard?.entries?.length
    ? signboard.entries
    : [{ label: '', duration: '', sort_order: 0 }];
  const entriesHtml = entries.map((entry, entryIndex) => trailEntryEditorHtml(entry, entryIndex)).join('');
  const direction = String(signboard?.direction || '').toLowerCase();

  return `
    <article class="trail-signboard-editor" data-role="trail-signboard">
      <div class="trail-signboard-editor-header">
        <strong>Tafel ${index + 1}</strong>
        <button class="danger compact" type="button" data-action="remove-signboard">Tafel l&ouml;schen</button>
      </div>
      <div class="trail-signboard-grid">
        <label>
          Richtung
          <select name="direction" required>
            <option value="">Bitte ausw&auml;hlen</option>
            <option value="rechts"${direction === 'rechts' ? ' selected' : ''}>rechts</option>
            <option value="links"${direction === 'links' ? ' selected' : ''}>links</option>
          </select>
        </label>
        <label>
          Wegnummer
          <input name="trail_number" type="text" maxlength="80" value="${escapeHtml(signboard?.trail_number || '')}" placeholder="1" required />
        </label>
      </div>
      <div class="trail-entry-header">
        <strong>Anschriften</strong>
        <button class="compact" type="button" data-action="add-entry">Anschrift hinzuf&uuml;gen</button>
      </div>
      <div class="trail-entries" data-role="trail-entries">
        ${entriesHtml}
      </div>
    </article>
  `;
}

function trailEntryEditorHtml(entry, index) {
  return `
    <div class="trail-entry-editor" data-role="trail-entry">
      <div class="trail-entry-header">
        <strong>Anschrift ${index + 1}</strong>
        <button class="danger compact" type="button" data-action="remove-entry">Entfernen</button>
      </div>
      <div class="trail-entry-grid">
        <label>
          Beschriftung
          <input name="label" type="text" maxlength="200" value="${escapeHtml(entry?.label || '')}" placeholder="Zielpunkt" required />
        </label>
        <label>
          Dauer
          <span class="duration-input">
            <input name="duration" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(durationInputValue(entry?.duration))}" />
            <span>min</span>
          </span>
        </label>
      </div>
    </div>
  `;
}

function handleTrailSignboardAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const signboardElement = button.closest('[data-role="trail-signboard"]');
  const action = button.dataset.action;

  if (action === 'remove-signboard') {
    signboardElement?.remove();
    renumberTrailEditors();
    clearTrailValidationHighlights();
    return;
  }

  if (action === 'add-entry') {
    const entriesElement = signboardElement?.querySelector('[data-role="trail-entries"]');
    const entryCount = entriesElement?.querySelectorAll('[data-role="trail-entry"]').length || 0;
    if (!entriesElement || entryCount >= 2) {
      showTrailValidationError('Pro Tafel sind maximal zwei Anschriften erlaubt.', button, signboardElement);
      return;
    }

    entriesElement.insertAdjacentHTML('beforeend', trailEntryEditorHtml(null, entryCount));
    renumberTrailEditors();
    clearTrailValidationHighlights();
    return;
  }

  if (action === 'remove-entry') {
    const entriesElement = signboardElement?.querySelector('[data-role="trail-entries"]');
    const entryCount = entriesElement?.querySelectorAll('[data-role="trail-entry"]').length || 0;
    if (entryCount <= 1) {
      showTrailValidationError('Eine Tafel braucht mindestens eine Anschrift.', button, signboardElement);
      return;
    }

    button.closest('[data-role="trail-entry"]')?.remove();
    renumberTrailEditors();
    clearTrailValidationHighlights();
  }
}

function renumberTrailEditors() {
  if (!trailSignboards) return;

  trailSignboards.querySelectorAll('[data-role="trail-signboard"]').forEach((signboardElement, signboardIndex) => {
    const title = signboardElement.querySelector('.trail-signboard-editor-header strong');
    if (title) title.textContent = `Tafel ${signboardIndex + 1}`;

    const entries = signboardElement.querySelectorAll('[data-role="trail-entry"]');
    const addEntryButton = signboardElement.querySelector('[data-action="add-entry"]');
    if (addEntryButton) addEntryButton.disabled = entries.length >= 2;

    entries.forEach((entryElement, entryIndex) => {
      const entryTitle = entryElement.querySelector('.trail-entry-header strong');
      if (entryTitle) entryTitle.textContent = `Anschrift ${entryIndex + 1}`;
    });
  });
}

function readTrailPoleFormPayload() {
  clearTrailValidationHighlights();
  const siteNumber = fieldTrailSiteNumber.value.trim();
  if (!siteNumber) {
    showTrailValidationError('Bitte eine Standortnummer eingeben.', fieldTrailSiteNumber);
    return null;
  }

  const signboards = Array.from(trailSignboards.querySelectorAll('[data-role="trail-signboard"]')).map((signboardElement, signboardIndex) => {
    const direction = signboardElement.querySelector('[name="direction"]').value.trim();
    const trailNumber = signboardElement.querySelector('input[name="trail_number"]').value.trim();
    const entries = Array.from(signboardElement.querySelectorAll('[data-role="trail-entry"]')).map((entryElement, entryIndex) => ({
      label: entryElement.querySelector('input[name="label"]').value.trim(),
      duration: entryElement.querySelector('input[name="duration"]').value.trim() || null,
      sort_order: entryIndex
    }));

    return {
      direction,
      trail_number: trailNumber,
      sort_order: signboardIndex,
      entries
    };
  });

  if (signboards.length < 1) {
    showTrailValidationError('Bitte mindestens eine Tafel anlegen.', addTrailSignboardBtn);
    return null;
  }

  for (let signboardIndex = 0; signboardIndex < signboards.length; signboardIndex += 1) {
    const signboard = signboards[signboardIndex];
    const signboardElement = trailSignboards.querySelectorAll('[data-role="trail-signboard"]')[signboardIndex];

    if (!signboard.direction) {
      showTrailValidationError(
        `Bitte die Richtung f\u00FCr Tafel ${signboardIndex + 1} eingeben.`,
        signboardElement?.querySelector('[name="direction"]'),
        signboardElement
      );
      return null;
    }

    if (!signboard.trail_number) {
      showTrailValidationError(
        `Bitte die Wegnummer f\u00FCr Tafel ${signboardIndex + 1} eingeben.`,
        signboardElement?.querySelector('input[name="trail_number"]'),
        signboardElement
      );
      return null;
    }

    if (signboard.entries.length < 1 || signboard.entries.length > 2) {
      showTrailValidationError(
        `Tafel ${signboardIndex + 1} braucht eine oder zwei Anschriften.`,
        signboardElement?.querySelector('[data-action="add-entry"]'),
        signboardElement
      );
      return null;
    }

    for (let entryIndex = 0; entryIndex < signboard.entries.length; entryIndex += 1) {
      const entryElement = signboardElement?.querySelectorAll('[data-role="trail-entry"]')[entryIndex];
      if (!signboard.entries[entryIndex].label) {
        showTrailValidationError(
          `Bitte die Beschriftung f\u00FCr Anschrift ${entryIndex + 1} in Tafel ${signboardIndex + 1} eingeben.`,
          entryElement?.querySelector('input[name="label"]'),
          entryElement || signboardElement
        );
        return null;
      }
    }
  }

  return {
    site_number: siteNumber,
    active: fieldTrailActive ? fieldTrailActive.value === '1' : (currentEditTrailPole?.active ?? true),
    notes: fieldTrailNotes.value.trim() || null,
    signboards
  };
}

function showTrailValidationError(message, focusTarget = null, highlightTarget = null) {
  showTrailFormError(message);
  highlightTarget?.classList.add('is-invalid');
  focusTarget?.focus?.({ preventScroll: true });
  focusTarget?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

function showTrailFormError(message) {
  if (!trailFormError) return;

  if (!message) {
    trailFormError.hidden = true;
    trailFormError.textContent = '';
    return;
  }

  trailFormError.textContent = message;
  trailFormError.hidden = false;
}

function clearTrailValidationHighlights() {
  showTrailFormError(null);
  trailSignboards?.querySelectorAll('.is-invalid').forEach((element) => {
    element.classList.remove('is-invalid');
  });
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

function sortedTrailPoles(poles, sortMode) {
  const next = [...poles];

  if (sortMode === 'updated-desc') {
    return next.sort((a, b) => timestampSortValue(b.updated_at) - timestampSortValue(a.updated_at));
  }

  if (sortMode === 'signboards-desc') {
    return next.sort((a, b) => {
      const countDiff = (b.signboards?.length || 0) - (a.signboards?.length || 0);
      if (countDiff !== 0) return countDiff;
      return compareSiteNumbers(a.site_number, b.site_number);
    });
  }

  return next.sort((a, b) => compareSiteNumbers(a.site_number, b.site_number));
}

function compareSiteNumbers(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'de', {
    numeric: true,
    sensitivity: 'base'
  });
}

function timestampSortValue(value) {
  if (!value) return 0;
  const normalized = String(value).includes('T')
    ? String(value)
    : `${String(value).replace(' ', 'T')}Z`;
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? time : 0;
}

function countTrailEntries(pole) {
  return (pole.signboards || []).reduce((sum, signboard) => sum + (signboard.entries?.length || 0), 0);
}

function firstTrailEntrySummary(pole) {
  const firstSignboard = pole.signboards?.[0];
  const firstEntry = firstSignboard?.entries?.[0];

  if (!firstSignboard || !firstEntry) return 'Keine Anschriften gepflegt';

  return `${firstSignboard.direction} · Weg ${firstSignboard.trail_number} · ${firstEntry.label}${formatTrailDuration(firstEntry.duration) ? ` (${formatTrailDuration(firstEntry.duration)})` : ''}`;
}

function durationInputValue(duration) {
  if (!duration) return '';

  const match = String(duration).match(/\d+/);
  return match ? match[0] : '';
}

function formatTrailDuration(duration) {
  const minutes = durationInputValue(duration);
  return minutes ? `${minutes} min` : '';
}

function inspectionSortValue(bench) {
  if (!bench.last_inspection) return 0;
  const time = new Date(`${bench.last_inspection}T00:00:00`).getTime();
  return Number.isFinite(time) ? time : 0;
}

function statusSortValue(bench) {
  const index = statusSortOrder.indexOf(benchVisualStatus(bench));
  return index === -1 ? statusSortOrder.length : index;
}

function isVisibleBench(bench) {
  return !bench.deleted_at && bench.status !== 'removed';
}

function benchVisualStatus(bench) {
  if (!bench.active) return 'inactive';
  return bench.status || 'removed';
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

function formatHistoryDate(value) {
  if (!value) return 'Unbekannter Zeitpunkt';

  const normalized = String(value).includes('T')
    ? String(value)
    : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatHistoryValue(value, field = null) {
  if (value === null || value === undefined || value === '') return '-';
  if (value === true) return 'Ja';
  if (value === false) return 'Nein';
  if (typeof value === 'string' && value.startsWith('http')) return 'Foto-Link';
  if (field === 'status') return statusLabels[value] || String(value);
  return String(value);
}

function historyActionLabel(action) {
  const labels = {
    created: 'Erstellt',
    baseline: 'Bestand übernommen',
    updated: 'Bearbeitet',
    status_updated: 'Status geändert',
    inspection_updated: 'Kontrolle gesetzt',
    position_updated: 'Position geändert',
    photo_updated: 'Foto geändert',
    deleted: 'Gelöscht'
  };

  return labels[action] || 'Bearbeitet';
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

function startPositionEdit(type, item, marker) {
  const state = type === 'trail' ? getTrailMarkerState(item.id) : getMarkerState(item.id);
  const currentLatLng = marker.getLatLng();
  const currentPosition = {
    lat: Number(currentLatLng.lat.toFixed(6)),
    lng: Number(currentLatLng.lng.toFixed(6))
  };

  activePositionEdit = {
    type,
    item,
    marker,
    originalPosition: state.originalPosition || currentPosition
  };

  state.isMoving = true;
  state.originalPosition = { ...activePositionEdit.originalPosition };
  state.pendingPosition = state.pendingPosition ?? { ...currentPosition };
  selectedPoint = null;
  clearTempMarker();
  map.closePopup();
  panel.hidden = true;
  trailPanel.hidden = true;
  if (benchListPanel) benchListPanel.hidden = true;
  if (trailListPanel) trailListPanel.hidden = true;
  closeGlobalHistoryPanel();
  marker.setLatLng([state.pendingPosition.lat, state.pendingPosition.lng]);
  marker.dragging.enable();
  marker.getElement()?.classList.add('is-moving');
  map.panTo([state.pendingPosition.lat, state.pendingPosition.lng], { animate: true });
  renderPositionEditBar();
}

async function saveActivePositionEdit() {
  if (!activePositionEdit) return;

  const { type, item, marker } = activePositionEdit;
  const state = type === 'trail' ? getTrailMarkerState(item.id) : getMarkerState(item.id);
  const latLng = marker.getLatLng();
  const nextPosition = state.pendingPosition ?? {
    lat: Number(latLng.lat.toFixed(6)),
    lng: Number(latLng.lng.toFixed(6))
  };

  clearActivePositionEdit(false);
  if (type === 'trail') {
    await upsertTrailPole(`/api/trail-poles/${item.id}`, 'PUT', nextPosition);
    return;
  }

  await upsertBench(`/api/benches/${item.id}`, 'PUT', nextPosition);
}

function cancelActivePositionEdit({ reopenPanel = false } = {}) {
  if (!activePositionEdit) return;
  const { type, item, marker } = activePositionEdit;
  clearActivePositionEdit(true);

  if (reopenPanel) {
    if (type === 'trail') {
      openTrailEditPanel(item, marker);
      return;
    }

    openEditPanel(item, marker);
  }
}

function clearActivePositionEdit(restorePosition) {
  if (!activePositionEdit) return;

  const { type, item, marker, originalPosition } = activePositionEdit;
  if (restorePosition) {
    marker.setLatLng([originalPosition.lat, originalPosition.lng]);
  }

  const state = type === 'trail' ? getTrailMarkerState(item.id) : getMarkerState(item.id);
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

  const { type, item, marker } = activePositionEdit;
  const latLng = marker.getLatLng();
  const position = {
    lat: Number(latLng.lat.toFixed(6)),
    lng: Number(latLng.lng.toFixed(6))
  };

  const itemName = type === 'trail'
    ? `Standort ${item.site_number || item.id}`
    : (item.title || `Bank ${item.id}`);
  positionEditTitle.textContent = `Position \u00E4ndern: ${itemName}`;
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

function handleTrailPoleLoadError(detail) {
  console.error('Trail pole loading failed:', detail);
  alert(`Wandertafeln konnten nicht geladen werden. ${detail}`);
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
    addCurrentLocationBtn.textContent = currentView === 'trails'
      ? 'Pfeiler hinzuf\u00FCgen'
      : 'Bank hinzuf\u00FCgen';
  }

  mapElement.closest('.map-shell')?.classList.toggle('is-admin', adminToggle.checked);
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

  return 'https://baenke-innichen-api.stefan-e58.workers.dev';
}

loadMunicipalityBoundary();
loadBenches();
initializeUserLocation();
updateViewControls();
