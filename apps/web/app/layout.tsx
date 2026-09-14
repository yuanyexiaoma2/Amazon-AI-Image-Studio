import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Amazon AI Image Studio',
  description: '亚马逊商品图生产 MVP 脚手架',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          background: '#0b1020',
          color: '#e8eefc',
          minHeight: '100vh',
        }}
      >
        <header
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #1e2a44',
            display: 'flex',
            gap: 16,
            alignItems: 'center',
          }}
        >
          <strong>Amazon AI Image Studio</strong>
          <nav style={{ display: 'flex', gap: 12, marginLeft: 'auto' }}>
            <a href="/" style={{ color: '#9db7ff' }}>
              首页
            </a>
            <a href="/login" style={{ color: '#9db7ff' }}>
              登录
            </a>
            <a href="/register" style={{ color: '#9db7ff' }}>
              注册
            </a>
            <a href="/projects" style={{ color: '#9db7ff' }}>
              项目
            </a>
          </nav>
        </header>
        <main style={{ minHeight: 'calc(100vh - 57px)' }}>{children}</main>
      </body>
    </html>
  );
}
