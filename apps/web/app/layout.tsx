import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { SiteHeader } from '@/components/site-header';
import './globals.css';

export const metadata: Metadata = {
  title: 'Amazon AI Image Studio',
  description: '亚马逊商品图生产 MVP 脚手架',
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
