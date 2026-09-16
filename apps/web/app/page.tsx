import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isLocalMode } from '@/lib/local-mode';
import { ensureLocalPrincipal } from '@/lib/local-principal';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // PR-6: local workbench — the canvas is the home screen, no login wall.
  if (isLocalMode()) {
    const { project } = await ensureLocalPrincipal();
    redirect(`/projects/${project.id}/studio`);
  }

  return (
    <div className="container">
      <h1>Amazon AI Image Studio</h1>
      <p className="home-lead">
        注册 → 项目 → Truth Pack（产品真相包） → Shot Plan（拍摄计划） → <strong>物化</strong> →
        Studio（画布），含节点配置与交互。当前仅 Fake 模式。
      </p>
      <div className="card-grid">
        <Link href="/register" className="card card-link">
          <div className="card-link-title">注册</div>
          <div className="card-link-desc">创建账号，开始第一个项目</div>
        </Link>
        <Link href="/login" className="card card-link">
          <div className="card-link-title">登录</div>
          <div className="card-link-desc">回到你的工作空间</div>
        </Link>
        <Link href="/projects" className="card card-link">
          <div className="card-link-title">项目</div>
          <div className="card-link-desc">项目 / 素材 / Truth Pack（产品真相包）</div>
        </Link>
        <Link href="/projects" className="card card-link">
          <div className="card-link-title">Studio 画布</div>
          <div className="card-link-desc">打开项目后进入 Studio</div>
        </Link>
      </div>
      <p className="faint" style={{ marginTop: 'var(--space-6)', fontSize: 'var(--font-size-sm)' }}>
        规格：<code>docs/specs/amazon-ai-image-studio-v1.1.md</code> · 进度：{' '}
        <code>docs/progress.md</code>
      </p>
    </div>
  );
}
