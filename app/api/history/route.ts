import { NextRequest, NextResponse } from 'next/server';
import { get365CalendarHeatmap, getAnnualTrends } from '@/lib/services/history-data';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get('city') || 'cn-beijing';
  const year = Number(searchParams.get('year') || '2025');

  const heatmap = get365CalendarHeatmap(city, year);
  const annual = getAnnualTrends(city);

  return NextResponse.json({
    city,
    year,
    heatmap,
    annual,
  });
}
