'use client';

import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { POPULAR_STATIONS } from '@/lib/constants/stations';
import { CITIES_REGISTRY } from '@/lib/constants/cities';

const WAQI_TOKEN = process.env.NEXT_PUBLIC_WAQI_TOKEN || '50b0c272a11f35667dd0ef7de354d76e9560ac48';

interface AirMapProps {
  showWaqiTiles: boolean;
  showStations: boolean;
  center?: [number, number];
  zoom?: number;
}

export default function AirMap({ showWaqiTiles, showStations, center = [35.0, 105.0], zoom = 4 }: AirMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const waqiLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      // 初始化 Leaflet 地图 (深色主题)
      const map = L.map(mapContainerRef.current, {
        center,
        zoom,
        zoomControl: true,
      });

      // 底图：CartoDB Dark Matter
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      // WAQI 实时热力切片图层
      const waqiTile = L.tileLayer(
        `https://tiles.aqicn.org/tiles/usepa-aqi/{z}/{x}/{y}.png?token=${WAQI_TOKEN}`,
        {
          attribution: 'Air Quality Tiles &copy; <a href="https://waqi.info">WAQI</a>',
          opacity: 0.75,
        }
      );
      if (showWaqiTiles) {
        waqiTile.addTo(map);
      }
      waqiLayerRef.current = waqiTile;

      // 站点与城市标记图层组
      const markersGroup = L.layerGroup().addTo(map);
      markersLayerRef.current = markersGroup;

      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // 响应切换 WAQI 瓦片图层
  useEffect(() => {
    const map = mapInstanceRef.current;
    const waqiTile = waqiLayerRef.current;
    if (!map || !waqiTile) return;

    if (showWaqiTiles) {
      if (!map.hasLayer(waqiTile)) {
        waqiTile.addTo(map);
      }
    } else {
      if (map.hasLayer(waqiTile)) {
        map.removeLayer(waqiTile);
      }
    }
  }, [showWaqiTiles]);

  // 渲染国控微站与全球重点城市打点
  useEffect(() => {
    const markersGroup = markersLayerRef.current;
    if (!markersGroup) return;

    markersGroup.clearLayers();

    if (!showStations) return;

    // 1. 国控站点微观打点
    POPULAR_STATIONS.forEach((station) => {
      const color = station.isCleanStation ? '#10b981' : '#eab308';
      const markerHtml = `
        <div style="
          background-color: ${color};
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 2px solid #ffffff;
          box-shadow: 0 0 8px ${color};
        "></div>
      `;

      const customIcon = L.divIcon({
        className: 'station-icon',
        html: markerHtml,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const marker = L.marker([station.latitude, station.longitude], { icon: customIcon });
      marker.bindPopup(`
        <div style="color: #0f172a; font-size: 12px; font-family: sans-serif;">
          <h4 style="margin: 0 0 4px 0; font-weight: bold; font-size: 13px;">${station.name}</h4>
          <p style="margin: 2px 0;">城市: <b>${station.city}</b></p>
          <p style="margin: 2px 0;">国控编号: <code>${station.code}</code></p>
          <p style="margin: 2px 0;">属性: ${station.isCleanStation ? '清洁对照点' : '国控实测站'}</p>
        </div>
      `);
      markersGroup.addLayer(marker);
    });

    // 2. 全球名城大圈打点
    CITIES_REGISTRY.slice(0, 30).forEach((city) => {
      const isDomestic = city.isDomestic;
      const markerHtml = `
        <div style="
          background-color: ${isDomestic ? 'rgba(56, 189, 248, 0.8)' : 'rgba(168, 85, 247, 0.8)'};
          padding: 3px 6px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.6);
          color: #ffffff;
          font-size: 10px;
          font-weight: bold;
          white-space: nowrap;
          box-shadow: 0 2px 6px rgba(0,0,0,0.4);
        ">
          ${city.nameZh}
        </div>
      `;

      const cityIcon = L.divIcon({
        className: 'city-label-icon',
        html: markerHtml,
        iconSize: [40, 20],
        iconAnchor: [20, 10],
      });

      const marker = L.marker([city.latitude, city.longitude], { icon: cityIcon });
      marker.bindPopup(`
        <div style="color: #0f172a; font-size: 12px;">
          <h4 style="margin: 0 0 4px 0; font-weight: bold;">${city.nameZh} (${city.nameEn})</h4>
          <p style="margin: 2px 0;">国家: ${city.country}</p>
          <p style="margin: 2px 0;">经纬度: ${city.latitude.toFixed(2)}°, ${city.longitude.toFixed(2)}°</p>
          <a href="/?city=${city.id}" style="color: #0284c7; text-decoration: underline; font-weight: bold;">查看实时大屏 →</a>
        </div>
      `);
      markersGroup.addLayer(marker);
    });
  }, [showStations]);

  return <div ref={mapContainerRef} className="w-full h-full rounded-2xl overflow-hidden shadow-2xl" />;
}
