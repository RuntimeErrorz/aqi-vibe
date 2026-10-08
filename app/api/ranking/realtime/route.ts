import { NextResponse } from 'next/server';
import { getRealtimeRanking } from '@/lib/services/realtime-ranking';

export const runtime = 'nodejs';
export const revalidate = 600; // 10 分钟缓存

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get('refresh') === 'true' || url.searchParams.has('t');
    const data = await getRealtimeRanking(forceRefresh);

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': forceRefresh
          ? 'no-cache, no-store, must-revalidate'
          : 'public, max-age=120, stale-while-revalidate=300',
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
