import Link from 'next/link';

export default function StudioStubRedirect() {
  return (
    <div className="container">
      <h1>Studio（画布）</h1>
      <p>
        项目级 Studio 位于 <code>/projects/[projectId]/studio?workspaceId=…</code>。打开项目后点击
        <strong>打开 Studio 画布</strong>。
      </p>
      <p>
        <Link href="/projects">前往项目</Link>
      </p>
    </div>
  );
}
