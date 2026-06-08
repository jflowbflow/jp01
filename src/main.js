import * as THREE from 'three';
import './style.css';

const canvas = document.querySelector('#game-canvas');
const pauseButton = document.querySelector('#pause-toggle');
const clearLineButton = document.querySelector('#clear-line');
const stationCountLabel = document.querySelector('#station-count');
const routeCountLabel = document.querySelector('#route-count');
const gameStatusLabel = document.querySelector('#game-status');
const hintText = document.querySelector('#hint-text');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4efe4);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
camera.position.z = 10;

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  canvas,
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const clock = new THREE.Clock();
const pointer = new THREE.Vector2();
const worldPointer = new THREE.Vector3();

const WORLD_HEIGHT = 10;
const STATION_RADIUS = 0.22;
const TAP_RADIUS = 0.48;
const INITIAL_STATION_COUNT = 4;
const MAX_STATIONS = 22;
const STARTING_SPAWN_INTERVAL = 4.5;
const MIN_SPAWN_INTERVAL = 2.75;

const state = {
  elapsed: 0,
  nextSpawnAt: 0,
  paused: false,
  spawnInterval: STARTING_SPAWN_INTERVAL,
  stationId: 0,
  stations: [],
  route: [],
  worldWidth: 10,
  worldHeight: WORLD_HEIGHT,
};

const stationMaterials = {
  fill: new THREE.MeshBasicMaterial({ color: 0xfffbeb }),
  outline: new THREE.LineBasicMaterial({ color: 0x111827 }),
  selectedFill: new THREE.MeshBasicMaterial({ color: 0xffe08a }),
  route: new THREE.MeshBasicMaterial({ color: 0xf97316 }),
  routePreview: new THREE.LineBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.45 }),
};

const mapGroup = new THREE.Group();
const stationGroup = new THREE.Group();
const routeGroup = new THREE.Group();

scene.add(mapGroup);
scene.add(routeGroup);
scene.add(stationGroup);

const water = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshBasicMaterial({ color: 0xdbeafe }),
);
water.position.z = -0.08;
scene.add(water);

const land = new THREE.Mesh(
  new THREE.PlaneGeometry(18, 12),
  new THREE.MeshBasicMaterial({ color: 0xf4efe4 }),
);
land.position.z = -0.07;
mapGroup.add(land);

const river = new THREE.Mesh(
  new THREE.PlaneGeometry(2.2, 18),
  new THREE.MeshBasicMaterial({ color: 0xbfdbfe }),
);
river.rotation.z = -0.5;
river.position.set(1.7, 0.1, -0.06);
mapGroup.add(river);

const routePreview = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  stationMaterials.routePreview,
);
routePreview.visible = false;
routeGroup.add(routePreview);

const shapeFactories = {
  circle() {
    return new THREE.CircleGeometry(STATION_RADIUS, 36);
  },
  square() {
    return new THREE.PlaneGeometry(STATION_RADIUS * 1.8, STATION_RADIUS * 1.8);
  },
  triangle() {
    const shape = new THREE.Shape();
    const radius = STATION_RADIUS * 1.18;

    for (let index = 0; index < 3; index += 1) {
      const angle = Math.PI / 2 + index * ((Math.PI * 2) / 3);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      if (index === 0) {
        shape.moveTo(x, y);
      } else {
        shape.lineTo(x, y);
      }
    }

    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  },
};

const stationShapes = Object.keys(shapeFactories);

function getPlayableBounds() {
  const toolbarPadding = 1.25;
  const hudPadding = 0.65;

  return {
    minX: -state.worldWidth / 2 + 0.85,
    maxX: state.worldWidth / 2 - 0.85,
    minY: -state.worldHeight / 2 + toolbarPadding,
    maxY: state.worldHeight / 2 - hudPadding,
  };
}

function createStationMesh(station) {
  const group = new THREE.Group();
  const fill = new THREE.Mesh(shapeFactories[station.shape](), stationMaterials.fill);
  const outlineGeometry =
    station.shape === 'circle'
      ? new THREE.RingGeometry(STATION_RADIUS * 0.95, STATION_RADIUS * 1.1, 36)
      : new THREE.EdgesGeometry(fill.geometry);
  const outline =
    station.shape === 'circle'
      ? new THREE.Mesh(outlineGeometry, new THREE.MeshBasicMaterial({ color: 0x111827 }))
      : new THREE.LineSegments(outlineGeometry, stationMaterials.outline);

  group.add(fill);
  group.add(outline);
  group.position.set(station.x, station.y, 0.1);
  group.scale.setScalar(0.01);
  group.userData.stationId = station.id;

  station.mesh = group;
  station.fill = fill;

  return group;
}

function getStationMinDistance() {
  return state.stations.length < 8 ? 1.7 : 1.25;
}

function pickStationPosition() {
  const bounds = getPlayableBounds();
  let bestCandidate = null;
  let bestDistance = 0;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = {
      x: THREE.MathUtils.lerp(bounds.minX, bounds.maxX, Math.random()),
      y: THREE.MathUtils.lerp(bounds.minY, bounds.maxY, Math.random()),
    };
    const nearestDistance = state.stations.reduce((nearest, station) => {
      const distance = Math.hypot(candidate.x - station.x, candidate.y - station.y);
      return Math.min(nearest, distance);
    }, Number.POSITIVE_INFINITY);

    if (nearestDistance > bestDistance) {
      bestCandidate = candidate;
      bestDistance = nearestDistance;
    }

    if (nearestDistance >= getStationMinDistance()) {
      return candidate;
    }
  }

  return bestCandidate;
}

function spawnStation(forcedShape) {
  if (state.stations.length >= MAX_STATIONS) {
    return null;
  }

  const position = pickStationPosition();
  if (!position) {
    return null;
  }

  const station = {
    id: state.stationId,
    shape: forcedShape ?? stationShapes[state.stationId % stationShapes.length],
    x: position.x,
    y: position.y,
    age: 0,
  };

  state.stationId += 1;
  state.stations.push(station);
  stationGroup.add(createStationMesh(station));
  updateHud();

  return station;
}

function createRouteSegment(start, end) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.hypot(deltaX, deltaY);
  const segment = new THREE.Mesh(new THREE.PlaneGeometry(length, 0.12), stationMaterials.route);

  segment.position.set((start.x + end.x) / 2, (start.y + end.y) / 2, 0.02);
  segment.rotation.z = Math.atan2(deltaY, deltaX);

  return segment;
}

function redrawRoute() {
  routeGroup.children
    .filter((child) => child !== routePreview)
    .forEach((child) => {
      routeGroup.remove(child);
      child.geometry.dispose();
    });

  state.stations.forEach((station) => {
    station.fill.material = state.route.includes(station) ? stationMaterials.selectedFill : stationMaterials.fill;
  });

  for (let index = 1; index < state.route.length; index += 1) {
    routeGroup.add(createRouteSegment(state.route[index - 1], state.route[index]));
  }

  updateHud();
}

function updateHud() {
  stationCountLabel.textContent = `${state.stations.length} station${
    state.stations.length === 1 ? '' : 's'
  }`;
  routeCountLabel.textContent = `${state.route.length} linked`;
  gameStatusLabel.textContent = state.paused ? 'paused' : 'running';
  pauseButton.textContent = state.paused ? 'Resume' : 'Pause';
  pauseButton.setAttribute('aria-pressed', String(state.paused));
}

function setPaused(paused) {
  state.paused = paused;
  hintText.textContent = paused
    ? 'Paused. Use the toolbar to resume play.'
    : 'Tap stations to add them to the metro line. New stations spawn automatically.';
  updateHud();
}

function appendStationToRoute(station) {
  if (!station) {
    return;
  }

  const routeIndex = state.route.indexOf(station);
  const lastStation = state.route.at(-1);

  if (station === lastStation) {
    return;
  }

  if (routeIndex >= 0) {
    state.route = state.route.slice(0, routeIndex + 1);
  } else {
    state.route.push(station);
  }

  hintText.textContent =
    state.route.length > 1 ? 'Line updated. Keep tapping stations to extend it.' : 'Choose the next station.';
  redrawRoute();
}

function findStationAt(point) {
  let nearestStation = null;
  let nearestDistance = TAP_RADIUS;

  state.stations.forEach((station) => {
    const distance = Math.hypot(point.x - station.x, point.y - station.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestStation = station;
    }
  });

  return nearestStation;
}

function updatePointerFromEvent(event) {
  const rect = canvas.getBoundingClientRect();

  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  worldPointer.set(pointer.x, pointer.y, 0).unproject(camera);

  return worldPointer;
}

function updateRoutePreview(position) {
  const lastStation = state.route.at(-1);
  if (!lastStation) {
    routePreview.visible = false;
    return;
  }

  routePreview.geometry.setFromPoints([
    new THREE.Vector3(lastStation.x, lastStation.y, 0.04),
    new THREE.Vector3(position.x, position.y, 0.04),
  ]);
  routePreview.geometry.attributes.position.needsUpdate = true;
}

function handlePointerDown(event) {
  event.preventDefault();
  const position = updatePointerFromEvent(event);
  const station = findStationAt(position);

  if (station) {
    appendStationToRoute(station);
    canvas.setPointerCapture(event.pointerId);
    routePreview.visible = true;
    updateRoutePreview(position);
  } else {
    hintText.textContent = 'Tap directly on a station to extend the line.';
  }
}

function handlePointerMove(event) {
  if (!routePreview.visible) {
    return;
  }

  updateRoutePreview(updatePointerFromEvent(event));
}

function handlePointerUp(event) {
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  const station = findStationAt(updatePointerFromEvent(event));
  if (station) {
    appendStationToRoute(station);
  }

  routePreview.visible = false;
}

function updateStations(delta) {
  state.stations.forEach((station) => {
    station.age += delta;
    const scale = THREE.MathUtils.smoothstep(Math.min(station.age / 0.45, 1), 0, 1);
    station.mesh.scale.setScalar(scale);
  });
}

function updateSpawning(delta) {
  if (state.paused) {
    return;
  }

  state.elapsed += delta;
  if (state.elapsed < state.nextSpawnAt) {
    return;
  }

  spawnStation();
  state.spawnInterval = Math.max(MIN_SPAWN_INTERVAL, state.spawnInterval - 0.12);
  state.nextSpawnAt = state.elapsed + state.spawnInterval;
}

function seedStations() {
  const seedShapes = ['circle', 'square', 'triangle', 'circle'];
  seedShapes.slice(0, INITIAL_STATION_COUNT).forEach((shape) => spawnStation(shape));
  state.nextSpawnAt = state.elapsed + 1.2;
}

function handleResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const aspect = width / height;

  state.worldHeight = WORLD_HEIGHT;
  state.worldWidth = WORLD_HEIGHT * aspect;

  camera.left = -state.worldWidth / 2;
  camera.right = state.worldWidth / 2;
  camera.top = state.worldHeight / 2;
  camera.bottom = -state.worldHeight / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener('resize', handleResize);
canvas.addEventListener('pointerdown', handlePointerDown);
canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerup', handlePointerUp);
canvas.addEventListener('pointercancel', () => {
  routePreview.visible = false;
});

pauseButton.addEventListener('click', () => {
  setPaused(!state.paused);
});

clearLineButton.addEventListener('click', () => {
  state.route = [];
  routePreview.visible = false;
  hintText.textContent = 'Line cleared. Tap a station to start a new route.';
  redrawRoute();
});

function animate() {
  const delta = Math.min(clock.getDelta(), 0.1);

  updateStations(delta);
  updateSpawning(delta);
  renderer.render(scene, camera);
}

handleResize();
seedStations();
updateHud();
renderer.setAnimationLoop(animate);
