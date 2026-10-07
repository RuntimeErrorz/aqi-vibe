import type { Metadata } from 'next';
import './globals.css';
import { StandardProvider } from '@/components/StandardContext';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: 'AQI Vibe | 全球与国内空气质量监测及历史统计平台',
  description: '高精度实时监控 375 座国内城市、564 座全球城市与 2026+ 国控站点，回溯 2014 年至今的长期环境数据趋势。支持中国国标与美标一键切换。',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen flex flex-col bg-slate-50 text-slate-900 antialiased selection:bg-sky-500 selection:text-white">
        <StandardProvider>
          <Navbar />
          <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {children}
          </main>
          <Footer />
        </StandardProvider>
      </body>
    </html>
  );
}
