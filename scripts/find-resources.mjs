// Usage: node scripts/find-resources.mjs
// Fetches CKAN metadata and suggests .env entries

const CKAN_URL = "https://data.tampere.fi/data/api/action/package_show?id=tampereen-liikennevalorajapinta";

async function main() {
  const r = await fetch(CKAN_URL);
  if (!r.ok) {
    console.error("Failed to fetch CKAN package_show:", r.status, await r.text().catch(()=>""), "\nCheck your network/VPN (some Tampere data may be geo-limited).");
    process.exit(1);
  }
  const json = await r.json();
  const pkg = json.result || json;
  const resources = (pkg.resources || []).map(r => ({
    name: r.name || r.title || "",
    format: (r.format || "").toUpperCase(),
    url: r.url || r.path || r.download_url || "",
    id: r.id
  }));

  console.log("Resources found:");
  for (const res of resources) {
    console.log(`- ${res.name} [${res.format}] -> ${res.url}`);
  }

  // Heuristics to pick the right ones
  const loc = resources.find(r =>
    /geojson/i.test(r.format) || /wgs84|geojson|location/i.test(r.name)
  );
  const states = resources.find(r =>
    /json/i.test(r.format) && /state|status|signal/i.test(r.name)
  );

  console.log("\nSuggested .env values (verify the URLs):\n");
  console.log("TRAFFIC_API_BASE=https://trafficlights.tampere.fi");
  if (loc)   console.log(`LOCATIONS_URL=${loc.url.startsWith("http") ? loc.url : "/"+loc.url.replace(/^\/+/, "")}`);
  else       console.log(`LOCATIONS_URL=<PUT THE GEOJSON LOCATIONS URL HERE>`);
  if (states) console.log(`STATES_URL=${states.url.startsWith("http") ? states.url : "/"+states.url.replace(/^\/+/, "")}`);
  else        console.log(`STATES_URL=<PUT THE REALTIME STATES JSON URL HERE>`);
  console.log("ENABLE_DEMO_MODE=false");
  console.log("POLL_INTERVAL_MS=2000");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
