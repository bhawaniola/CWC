export const ASSET_PATHS = {
  logo: "/assets/sanjeevani-logo.png",
  hero: "/assets/rescue-hero.png",
  map: "/assets/network-map.png"
};

export const MAP_BOUNDS = {
  north: 17.56,
  south: 17.21,
  west: 78.26,
  east: 78.62
};

export const MAP_LOCATIONS = [
  {
    id: "zone-1",
    zoneName: "Ridge Rescue Zone 1",
    city: "Varuna Hills",
    label: "Varuna Hills, Zone 1",
    address: "Varuna Hills Relief Point",
    x: 31,
    y: 20
  },
  {
    id: "zone-2",
    zoneName: "Shelter Ring Zone 2",
    city: "Devapur",
    label: "Devapur, Zone 2",
    address: "Devapur School Shelter",
    x: 48,
    y: 17
  },
  {
    id: "zone-3",
    zoneName: "Kothapalli Zone 3",
    city: "Kothapalli",
    label: "Kothapalli, Zone 3",
    address: "Kothapalli Zone 3",
    x: 69,
    y: 28
  },
  {
    id: "zone-4",
    zoneName: "Canal Village Zone 4",
    city: "Lakshmipur",
    label: "Lakshmipur, Zone 4",
    address: "Lakshmipur Primary Health Camp",
    x: 24,
    y: 53
  },
  {
    id: "zone-5",
    zoneName: "Central Base Zone 5",
    city: "Bhavanipur",
    label: "Bhavanipur, Zone 5",
    address: "Bhavanipur Main Base Road",
    x: 50,
    y: 51
  },
  {
    id: "zone-6",
    zoneName: "Riverbank Relief Zone 6",
    city: "Surya Nagar",
    label: "Surya Nagar, Zone 6",
    address: "Surya Nagar Riverbank Camp",
    x: 76,
    y: 50
  },
  {
    id: "zone-7",
    zoneName: "City Edge Zone 7",
    city: "Nirmal City",
    label: "Nirmal City, Zone 7",
    address: "Nirmal City Sports Ground",
    x: 24,
    y: 78
  },
  {
    id: "zone-8",
    zoneName: "South Shelter Zone 8",
    city: "Anandpur",
    label: "Anandpur, Zone 8",
    address: "Anandpur Community Shelter",
    x: 44,
    y: 84
  },
  {
    id: "zone-9",
    zoneName: "Floodplain Zone 9",
    city: "Neerajpur",
    label: "Neerajpur, Zone 9",
    address: "Neerajpur High Ground Shelter",
    x: 77,
    y: 78
  },
  {
    id: "zone-10",
    zoneName: "Southern Flood Zone 10",
    city: "Rajivapur",
    label: "Rajivapur, Zone 10",
    address: "Rajivapur Bridge Relief Point",
    x: 77,
    y: 88
  }
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function coordinatesFromPercent(x, y) {
  const safeX = clamp(x, 0, 100);
  const safeY = clamp(y, 0, 100);
  const lat = MAP_BOUNDS.north - (safeY / 100) * (MAP_BOUNDS.north - MAP_BOUNDS.south);
  const lng = MAP_BOUNDS.west + (safeX / 100) * (MAP_BOUNDS.east - MAP_BOUNDS.west);

  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6))
  };
}

export function nearestMapLocation(point) {
  return MAP_LOCATIONS.reduce((closest, location) => {
    return distance(point, location) < distance(point, closest) ? location : closest;
  }, MAP_LOCATIONS[0]);
}

export function createSelection(x, y) {
  const precisePoint = {
    x: Number(clamp(x, 0, 100).toFixed(3)),
    y: Number(clamp(y, 0, 100).toFixed(3))
  };
  const coordinates = coordinatesFromPercent(precisePoint.x, precisePoint.y);
  const nearest = nearestMapLocation(precisePoint);

  return {
    ...precisePoint,
    ...coordinates,
    zoneId: nearest.id,
    zoneName: nearest.zoneName,
    city: nearest.city,
    label: nearest.label,
    address: nearest.address
  };
}

export function createSelectionFromLocationId(locationId) {
  const location = MAP_LOCATIONS.find((item) => item.id === locationId) || MAP_LOCATIONS[2];

  return {
    ...createSelection(location.x, location.y),
    zoneId: location.id,
    zoneName: location.zoneName,
    city: location.city,
    label: location.label,
    address: location.address
  };
}

export function createDefaultLocationForPod(podId) {
  const match = String(podId || "").match(/\d+/);
  const podNumber = match ? Number(match[0]) : 3;
  const location = MAP_LOCATIONS[(podNumber - 1 + MAP_LOCATIONS.length) % MAP_LOCATIONS.length];

  return createSelectionFromLocationId(location.id);
}

export const DEFAULT_LOCATION = {
  ...createSelectionFromLocationId("zone-3")
};
