import { NextResponse } from 'next/server';
import { getRealtimeRanking } from '@/lib/services/realtime-ranking';

export const runtime = 'nodejs';
export const revalidate = 60; // 60 秒极短打闸，与静态导出模式完全兼容

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get('refresh') === 'true' || url.searchParams.has('t');
    const data = await getRealtimeRanking(forceRefresh);

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': forceRefresh
          ? 'no-cache, no-store, must-revalidate'
          : 'public, max-age=60, stale-while-revalidate=120',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    console.error('Error generating realtime ranking:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch realtime rankings',
      },
      { status: 500 }
    );
  }
}
