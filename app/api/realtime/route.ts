import { NextRequest, NextResponse } from 'next/server';
import { fetchWAQICityData } from '@/lib/services/waqi';

export const runtime = 'edge'; // Cloudflare Edge 运行时兼容

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get('city') || 'beijing';

  try {
    const data = await fetchWAQICityData(city);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
