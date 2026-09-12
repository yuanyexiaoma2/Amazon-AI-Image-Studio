export default function HomePage() {
  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <h1>Amazon AI Image Studio</h1>
      <p>
        MVP through W3-B2: register → project → Truth → Shot Plan → <strong>materialize</strong> → Studio (schemas + interactions). Fake only.
      </p>
      <ul>
        <li>
          <a href="/register" style={{ color: '#9db7ff' }}>
            Register
          </a>
        </li>
        <li>
          <a href="/login" style={{ color: '#9db7ff' }}>
            Login
          </a>
        </li>
        <li>
          <a href="/projects" style={{ color: '#9db7ff' }}>
            Projects / assets / Truth Pack
          </a>
        </li>
        <li>
          <a href="/projects" style={{ color: '#9db7ff' }}>
            Studio canvas (open a project → Studio)
          </a>
        </li>
      </ul>
      <p style={{ opacity: 0.7, fontSize: 14 }}>
        Spec: <code>docs/specs/amazon-ai-image-studio-v1.1.md</code> · Progress:{' '}
        <code>docs/progress.md</code>
      </p>
    </div>
  );
}
