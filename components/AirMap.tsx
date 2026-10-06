'use client';

import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { POPULAR_STATIONS } from '@/lib/constants/stations';
import { CITIES_REGISTRY } from '@/lib/constants/cities';

const WAQI_TOKEN = process.env.NEXT_PUBLIC_WAQI_TOKEN || '50b0c272a11f35667dd0ef7de354d76e9560ac48';
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_KEY || 'cb1_4bl6_1_dc1bbfd8426369beb577afe4';

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
      // 初始化 Leaflet 地图 (清爽浅色主题)
      const map = L.map(mapContainerRef.current, {
        center,
        zoom,
        zoomControl: true,
      });

      // 底图：CARTO 官方授权清爽底图 (传入 Key 去除水印，支持 4 节点并发加速)
      L.tileLayer(`https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${CARTO_KEY}`, {
        attribution: '&copy; OpenStreetMap &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      // WAQI 实时热力切片图层
      const waqiTile = L.tileLayer(
        `https://tiles.aqicn.org/tiles/usepa-aqi/{z}/{x}/{y}.png?token=${WAQI_TOKEN}`,
        {
          attribution: 'Air Quality Tiles &copy; <a href="https://waqi.info">WAQI</a>',
          opacity: 0.65,
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
      const color = station.isCleanStation ? '#10b981' : '#f59e0b';
      const markerHtml = `
        <div style="
          background-color: ${color};
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 2px solid #ffffff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.25);
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
        <div style="color: #0f172a; font-size: 12px; font-family: sans-serif; padding: 2px;">
          <h4 style="margin: 0 0 4px 0; font-weight: bold; font-size: 13px; color: #0f172a;">${station.name}</h4>
          <p style="margin: 2px 0;">城市: <b>${station.city}</b></p>
          <p style="margin: 2px 0;">国控编号: <code>${station.code}</code></p>
          <p style="margin: 2px 0;">属性: ${station.isCleanStation ? '清洁对照点' : '国控实测站'}</p>
        </div>
      `);
      markersGroup.addLayer(marker);
    });

    // 2. 全球名城标签打点
    CITIES_REGISTRY.slice(0, 30).forEach((city) => {
      const isDomestic = city.isDomestic;
      const markerHtml = `
        <div style="
          background-color: ${isDomestic ? '#0284c7' : '#7c3aed'};
          padding: 3px 7px;
          border-radius: 6px;
          border: 1.5px solid #ffffff;
          color: #ffffff;
          font-size: 10px;
          font-weight: bold;
          white-space: nowrap;
          box-shadow: 0 2px 5px rgba(0,0,0,0.2);
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
        <div style="color: #0f172a; font-size: 12px; padding: 2px;">
          <h4 style="margin: 0 0 4px 0; font-weight: bold; color: #0f172a;">${city.nameZh} (${city.nameEn})</h4>
          <p style="margin: 2px 0;">国家/地区: ${city.country}</p>
          <p style="margin: 2px 0;">坐标: ${city.latitude.toFixed(2)}°, ${city.longitude.toFixed(2)}°</p>
          <a href="/?city=${city.id}" style="color: #0284c7; text-decoration: underline; font-weight: bold;">查看实时大盘 →</a>
        </div>
      `);
      markersGroup.addLayer(marker);
    });
  }, [showStations]);

  return <div ref={mapContainerRef} className="w-full h-full rounded-2xl overflow-hidden" />;
}
