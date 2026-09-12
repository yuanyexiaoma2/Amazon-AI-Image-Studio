export default function StudioStubRedirect() {
  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <h1>Studio</h1>
      <p>
        Project-scoped Studio lives at <code>/projects/[projectId]/studio?workspaceId=…</code>. Open a project and
        use <strong>Open Studio canvas</strong>.
      </p>
      <p>
        <a href="/projects" style={{ color: '#9db7ff' }}>
          Go to Projects
        </a>
      </p>
    </div>
  );
}
