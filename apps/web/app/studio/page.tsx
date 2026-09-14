export default function StudioStubRedirect() {
  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <h1>Studio（画布）</h1>
      <p>
        项目级 Studio 位于 <code>/projects/[projectId]/studio?workspaceId=…</code>。打开项目后点击
        <strong>打开 Studio 画布</strong>。
      </p>
      <p>
        <a href="/projects" style={{ color: '#9db7ff' }}>
          前往项目
        </a>
      </p>
    </div>
  );
}
