import { NextRequest, NextResponse } from 'next/server';
import { getStationsByCity, POPULAR_STATIONS } from '@/lib/constants/stations';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get('city');

  if (city) {
    const list = getStationsByCity(city);
    return NextResponse.json({ total: list.length, stations: list });
  }

  return NextResponse.json({ total: POPULAR_STATIONS.length, stations: POPULAR_STATIONS });
}
