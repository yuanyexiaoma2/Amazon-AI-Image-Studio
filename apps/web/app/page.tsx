export default function HomePage() {
  return (
    <div>
      <h1>Amazon AI Image Studio</h1>
      <p>
        MVP through W2: register → project → <strong>upload → inspect → thumbnail → Truth Pack</strong>.
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
          <a href="/studio" style={{ color: '#9db7ff' }}>
            Canvas stub (@xyflow/react)
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
