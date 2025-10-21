// Adapters parse whatever the upstream returns into a common format the UI expects.

// Expected normalized shapes:
//
// Locations -> Array<{ id: string, name?: string, lat: number, lon: number }>
// States    -> Array<{ id: string, state: string }> where state is GRINT code (as string)
//
// We try a few common patterns (GeoJSON, flat arrays, mappings) and fall back.

function parseLocations(raw) {
  // GeoJSON FeatureCollection
  if (raw && raw.type === "FeatureCollection" && Array.isArray(raw.features)) {
    return raw.features.map((f, idx) => {
      const [lon, lat] = (f.geometry && f.geometry.coordinates) || [0,0];
      const props = f.properties || {};
      const id = String(props.id || props.intersectionId || props.sgId || idx);
      const name = props.name || props.Intersection || `Intersection ${id}`;
      return { id, name, lat: Number(lat), lon: Number(lon) };
    }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  }

  // Array of objects with lat/lon
  if (Array.isArray(raw)) {
    return raw.map((o, idx) => ({
      id: String(o.id || o.intersectionId || o.sgId || idx),
      name: o.name || o.label || `Intersection ${idx}`,
      lat: Number(o.lat || o.latitude || (o.location && o.location.lat)),
      lon: Number(o.lon || o.lng || o.longitude || (o.location && o.location.lon))
    })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  }

  // CSV text?
  if (typeof raw === "string" && raw.includes(",")) {
    // naive CSV parser (expects headers id,lat,lon or similar)
    const [headerLine, ...lines] = raw.split(/\r?\n/).filter(Boolean);
    const headers = headerLine.split(",").map(h => h.trim().toLowerCase());
    const idxId = headers.findIndex(h => ["id","intersectionid","sgid"].includes(h));
    const idxLat = headers.findIndex(h => ["lat","latitude","y"].includes(h));
    const idxLon = headers.findIndex(h => ["lon","lng","longitude","x"].includes(h));
    const idxName = headers.findIndex(h => ["name","label","intersection"].includes(h));
    return lines.map((line, i) => {
      const cols = line.split(",");
      return {
        id: String(idxId >= 0 ? cols[idxId] : i),
        name: idxName >= 0 ? cols[idxName] : `Intersection ${i}`,
        lat: Number(idxLat >= 0 ? cols[idxLat] : NaN),
        lon: Number(idxLon >= 0 ? cols[idxLon] : NaN)
      };
    }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  }

  return [];
}

function parseStates(raw) {
  // Already in normalized shape?
  if (Array.isArray(raw) && raw.length && raw[0].id !== undefined && raw[0].state !== undefined) {
    return raw.map(r => ({ id: String(r.id), state: String(r.state) }));
  }

  // Common "signalGroups" array
  if (raw && Array.isArray(raw.signalGroups)) {
    return raw.signalGroups.map((sg, idx) => ({
      id: String(sg.id || sg.intersectionId || sg.sgId || idx),
      state: String(sg.state || sg.grint || sg.code || "")
    }));
  }

  // Map/dictionary: { "<id>": "<state>", ... }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return Object.keys(raw).map(k => ({ id: String(k), state: String(raw[k]) }));
  }

  // CSV text?
  if (typeof raw === "string" && raw.includes(",")) {
    const [headerLine, ...lines] = raw.split(/\r?\n/).filter(Boolean);
    const headers = headerLine.split(",").map(h => h.trim().toLowerCase());
    const idxId = headers.findIndex(h => ["id","intersectionid","sgid"].includes(h));
    const idxState = headers.findIndex(h => ["state","grint","code","status"].includes(h));
    return lines.map((line, i) => {
      const cols = line.split(",");
      return {
        id: String(idxId >= 0 ? cols[idxId] : i),
        state: String(idxState >= 0 ? cols[idxState] : "")
      };
    });
  }

  return [];
}

window.TampereAdapters = { parseLocations, parseStates };
