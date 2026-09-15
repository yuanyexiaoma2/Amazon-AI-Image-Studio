import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

/**
 * V2 PR-1 — shared UI primitives on top of globals.css component classes.
 * No runtime CSS-in-JS; styling lives in `app/globals.css` tokens/classes.
 */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'default' | 'primary';
    size?: 'md' | 'lg';
  },
) {
  const { variant = 'default', size = 'md', className, type, ...rest } = props;
  return (
    <button
      type={type ?? 'button'}
      className={cx('btn', variant === 'primary' && 'btn-primary', size === 'lg' && 'btn-lg', className)}
      {...rest}
    />
  );
}

export function Card(props: { children: ReactNode; className?: string }) {
  return <div className={cx('card', props.className)}>{props.children}</div>;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input className={cx('input', className)} {...rest} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, ...rest } = props;
  return <select className={cx('input', className)} {...rest} />;
}

export type BadgeTone = 'default' | 'ok' | 'danger' | 'warn' | 'accent';

export function Badge(props: { tone?: BadgeTone; children: ReactNode }) {
  const tone = props.tone ?? 'default';
  return (
    <span className={cx('badge', tone !== 'default' && `badge-${tone}`)}>{props.children}</span>
  );
}

export function ErrorBanner(props: { message: string; onRetry?: () => void }) {
  return (
    <p role="alert" className="banner-error">
      {props.message}{' '}
      {props.onRetry ? (
        <Button type="button" onClick={props.onRetry}>
          重试
        </Button>
      ) : null}
    </p>
  );
}

export function EmptyState(props: { children: ReactNode }) {
  return (
    <p role="status" className="empty-state">
      {props.children}
    </p>
  );
}

export function Spinner(props: { label?: string }) {
  return (
    <span role="status" className="row" style={{ gap: 6 }}>
      <span className="spinner" aria-hidden="true" />
      {props.label ? <span>{props.label}</span> : null}
    </span>
  );
}
