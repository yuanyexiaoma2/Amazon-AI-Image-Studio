import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Amazon AI Image Studio',
  description: '亚马逊商品图生产 MVP 脚手架',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="site-header">
          <strong>Amazon AI Image Studio</strong>
          <nav className="site-nav">
            <a href="/">首页</a>
            <a href="/login">登录</a>
            <a href="/register">注册</a>
            <a href="/projects">项目</a>
          </nav>
        </header>
        <main className="site-main">{children}</main>
      </body>
    </html>
  );
}
