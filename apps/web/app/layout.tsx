import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { SiteHeader } from '@/components/site-header';
import './globals.css';

export const metadata: Metadata = {
  title: '亚马逊 AI 生图工作台',
  description: '亚马逊商品图生产工作台',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Suspense fallback={<header className="site-header" />}>
          <SiteHeader />
        </Suspense>
        <main className="site-main">{children}</main>
      </body>
    </html>
  );
}
