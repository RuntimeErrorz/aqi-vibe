'use client';

import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const WAQI_TOKEN = process.env.NEXT_PUBLIC_WAQI_TOKEN || '50b0c272a11f35667dd0ef7de354d76e9560ac48';
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_KEY || 'cb1_4bl6_1_dc1bbfd8426369beb577afe4';

interface AirMapProps {
  showWaqiTiles: boolean;
  center?: [number, number];
  zoom?: number;
}

export default function AirMap({ showWaqiTiles, center = [35.0, 105.0], zoom = 4 }: AirMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const waqiLayerRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      // 初始化 Leaflet 地图
      const map = L.map(mapContainerRef.current, {
        center,
        zoom,
        zoomControl: true,
      });

      // 底图：CARTO 官方授权底图 (携带授权 Key 去水印，清晰标准大字号渲染)
      L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${CARTO_KEY}`, {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      // WAQI 实时热力切片图层 (高清晰度不失真渲染)
      const waqiTile = L.tileLayer(
        `https://tiles.aqicn.org/tiles/usepa-aqi/{z}/{x}/{y}.png?token=${WAQI_TOKEN}`,
        {
          attribution: 'Air Quality Tiles &copy; <a href="https://waqi.info">WAQI</a>',
          opacity: 0.9,
          maxZoom: 18,
        }
      );
      if (showWaqiTiles) {
        waqiTile.addTo(map);
      }
      waqiLayerRef.current = waqiTile;

      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // 响应视图中心与缩放变更 (平滑飞行漫游)
  useEffect(() => {
    if (mapInstanceRef.current && center) {
      mapInstanceRef.current.flyTo(center, zoom || 9, {
        duration: 1.5,
        easeLinearity: 0.25,
      });
    }
  }, [center, zoom]);

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

  return <div ref={mapContainerRef} className="w-full h-full rounded-2xl overflow-hidden" />;
}
