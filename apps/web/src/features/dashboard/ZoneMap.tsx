import mapboxgl from "mapbox-gl";
import { useEffect, useRef, useState } from "react";
import type { ZonesResponse } from "@gridproof/shared-types";
import "mapbox-gl/dist/mapbox-gl.css";

type Zone = ZonesResponse["zones"][number];

type ZoneMapProps = {
  zones: Zone[];
  statusByZoneId: Record<string, string>;
  selectedZoneId: string | undefined;
  onSelectZone: (zoneId: string) => void;
};

const accessToken = import.meta.env.VITE_MAPBOX_TOKEN ?? "";

const UNKNOWN_COLOR = "#64748b";

const STATUS_COLORS: Record<string, string> = {
  grid_up: "#15803d",
  grid_down: "#dc2626",
  unknown: UNKNOWN_COLOR
};

/** Nigeria's bounding box, so an empty or single-zone map still frames the country. */
const NIGERIA_BOUNDS: [[number, number], [number, number]] = [
  [2.6917, 4.2406],
  [14.678, 13.892]
];

export function ZoneMap({ zones, statusByZoneId, selectedZoneId, onSelectZone }: ZoneMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [mapError, setMapError] = useState<string | null>(null);
  // Keep the latest callback in a ref so marker click handlers never close over a stale prop.
  const onSelectRef = useRef(onSelectZone);
  onSelectRef.current = onSelectZone;

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !accessToken) return;

    let map: mapboxgl.Map;
    try {
      if (!mapboxgl.supported()) {
        setMapError("This browser or device does not support the WebGL map.");
        return;
      }

      mapboxgl.accessToken = accessToken;
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/light-v11",
        bounds: NIGERIA_BOUNDS,
        fitBoundsOptions: { padding: 40 }
      });
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      map.on("error", () => setMapError("The live map could not be loaded. Use the feeder list to continue."));
      mapRef.current = map;
    } catch {
      setMapError("The live map could not be initialized. Use the feeder list to continue.");
      return;
    }

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync markers to the current zone list, reusing existing markers so a status
  // change repaints in place instead of tearing down every marker each render.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<string>();

    for (const zone of zones) {
      seen.add(zone.id);
      const status = statusByZoneId[zone.id] ?? zone.latestStatus;
      const color = STATUS_COLORS[status] ?? UNKNOWN_COLOR;
      const existing = markersRef.current.get(zone.id);

      if (existing) {
        existing.setLngLat([zone.centroid.lng, zone.centroid.lat]);
        const element = existing.getElement();
        element.style.background = color;
        element.setAttribute("aria-pressed", String(zone.id === selectedZoneId));
        element.title = `${zone.name}: ${status.replace("_", " ")}`;
        continue;
      }

      const element = document.createElement("button");
      element.type = "button";
      element.className = "zone-marker-pin";
      element.style.background = color;
      element.title = `${zone.name}: ${status.replace("_", " ")}`;
      element.setAttribute("aria-label", `${zone.name}, ${status.replace("_", " ")}`);
      element.setAttribute("aria-pressed", String(zone.id === selectedZoneId));
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelectRef.current(zone.id);
      });

      const marker = new mapboxgl.Marker({ element })
        .setLngLat([zone.centroid.lng, zone.centroid.lat])
        .addTo(map);
      markersRef.current.set(zone.id, marker);
    }

    for (const [zoneId, marker] of markersRef.current) {
      if (!seen.has(zoneId)) {
        marker.remove();
        markersRef.current.delete(zoneId);
      }
    }
  }, [zones, statusByZoneId, selectedZoneId]);

  // Refit whenever the set of zones changes, so adding DisCos widens the view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || zones.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    zones.forEach((zone) => bounds.extend([zone.centroid.lng, zone.centroid.lat]));
    map.fitBounds(bounds, { padding: 60, maxZoom: 9, duration: 600 });
  }, [zones]);

  if (!accessToken) {
    return (
      <div className="map-canvas map-fallback" role="status">
        <p>
          Map unavailable: set <code>VITE_MAPBOX_TOKEN</code> in <code>apps/web/.env</code> to render the
          live zone map.
        </p>
      </div>
    );
  }

  if (mapError) {
    return (
      <div className="map-canvas map-fallback" role="alert">
        <p>{mapError}</p>
      </div>
    );
  }

  return <div className="map-canvas" data-testid="zone-map" ref={containerRef} />;
}
