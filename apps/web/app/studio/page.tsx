import Link from 'next/link';

export default function StudioStubRedirect() {
  return (
    <div className="container">
      <h1>工作台（画布）</h1>
      <p>
        画布工作台在项目里面。打开项目后点击
        <strong>打开工作台画布</strong>。
      </p>
      <p>
        <Link href="/projects">前往项目</Link>
      </p>
    </div>
  );
}
