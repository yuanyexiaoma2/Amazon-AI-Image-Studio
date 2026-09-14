export default function HomePage() {
  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <h1>Amazon AI Image Studio</h1>
      <p>
        MVP 已覆盖 W3-B2：注册 → 项目 → Truth Pack（产品真相包） → Shot Plan（拍摄计划） →{' '}
        <strong>物化</strong> → Studio（画布）（含节点配置与交互）。当前仅 Fake 模式。
      </p>
      <ul>
        <li>
          <a href="/register" style={{ color: '#9db7ff' }}>
            注册
          </a>
        </li>
        <li>
          <a href="/login" style={{ color: '#9db7ff' }}>
            登录
          </a>
        </li>
        <li>
          <a href="/projects" style={{ color: '#9db7ff' }}>
            项目 / 素材 / Truth Pack（产品真相包）
          </a>
        </li>
        <li>
          <a href="/projects" style={{ color: '#9db7ff' }}>
            Studio 画布（打开项目后进入 Studio）
          </a>
        </li>
      </ul>
      <p style={{ opacity: 0.7, fontSize: 14 }}>
        规格：<code>docs/specs/amazon-ai-image-studio-v1.1.md</code> · 进度：{' '}
        <code>docs/progress.md</code>
      </p>
    </div>
  );
}
