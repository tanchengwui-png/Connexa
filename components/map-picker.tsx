"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

type MapPickerProps = {
  latitude: number | null;
  longitude: number | null;
  onChange: (latitude: number, longitude: number) => void;
};

export function MapPicker({ latitude, longitude, onChange }: MapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    let map: any;
    (async () => {
      const module = await import("leaflet");
      const L = ((module as { default?: any }).default ?? module) as any;
      if (cancelled || !containerRef.current) {
        return;
      }

      map = L.map(containerRef.current, {
        center: latitude && longitude ? [latitude, longitude] : [3.1390, 101.6869],
        zoom: 12,
        zoomControl: true
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(map);

      map.on("click", (event: any) => {
        const { lat, lng } = event.latlng;
        placeMarker(L, map, lat, lng);
        onChange(lat, lng);
      });

      mapInstanceRef.current = map;
      placeMarker(L, map, latitude ?? 3.139, longitude ?? 101.6869, { setView: false });
    })();

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.off();
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!markerRef.current || !mapInstanceRef.current) {
      return;
    }

    const { marker, map } = markerRef.current;
    const coords = [latitude ?? 3.139, longitude ?? 101.6869];
    marker.setLatLng(coords);
    map.setView(coords, map.getZoom());
  }, [latitude, longitude]);

  const placeMarker = (L: any, map: any, lat: number, lng: number, options?: { setView?: boolean }) => {
    if (!markerRef.current) {
      const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
      marker.on("dragend", (event: any) => {
        const { lat: newLat, lng: newLng } = event.target.getLatLng();
        onChange(newLat, newLng);
      });
      markerRef.current = { marker, map };
      if (options?.setView !== false) {
        map.setView([lat, lng], map.getZoom());
      }
    } else {
      markerRef.current.marker.setLatLng([lat, lng]);
      if (options?.setView !== false) {
        markerRef.current.map.setView([lat, lng], markerRef.current.map.getZoom());
      }
    }
  };

  return <div className="map-picker" ref={containerRef} />;
}
