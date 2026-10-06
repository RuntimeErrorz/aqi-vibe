import { NextRequest, NextResponse } from 'next/server';
import { get365CalendarHeatmap, getAnnualTrends } from '@/lib/services/history-data';
import { StandardType } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get('city') || 'cn-beijing';
  const year = Number(searchParams.get('year') || '2025');
  const standard = (searchParams.get('standard') as StandardType) || 'CN';

  const heatmap = get365CalendarHeatmap(city, year, standard);
  const annual = getAnnualTrends(city, standard);

  return NextResponse.json({
    city,
    year,
    standard,
    heatmap,
    annual,
  });
}
