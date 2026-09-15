import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="container">
      <h1>Amazon AI Image Studio</h1>
      <p>
        MVP 已覆盖 W3-B2：注册 → 项目 → Truth Pack（产品真相包） → Shot Plan（拍摄计划） →{' '}
        <strong>物化</strong> → Studio（画布）（含节点配置与交互）。当前仅 Fake 模式。
      </p>
      <ul>
        <li>
          <Link href="/register">注册</Link>
        </li>
        <li>
          <Link href="/login">登录</Link>
        </li>
        <li>
          <Link href="/projects">项目 / 素材 / Truth Pack（产品真相包）</Link>
        </li>
        <li>
          <Link href="/projects">Studio 画布（打开项目后进入 Studio）</Link>
        </li>
      </ul>
      <p className="muted" style={{ fontSize: 'var(--font-size-lg)' }}>
        规格：<code>docs/specs/amazon-ai-image-studio-v1.1.md</code> · 进度：{' '}
        <code>docs/progress.md</code>
      </p>
    </div>
  );
}
