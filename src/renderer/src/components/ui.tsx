import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { DownloadProgress } from '@shared/types'
import { formatBytes } from '../lib/api'

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ')

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'default' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  icon?: ReactNode
  busy?: boolean
}

export function Button({ variant = 'default', size = 'md', icon, busy, className, children, disabled, ...rest }: BtnProps): ReactNode {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-45'
  const sizes = size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8.5 px-3.5 text-[13px]'
  const variants = {
    primary: 'bg-accent text-accent-ink hover:brightness-110',
    default: 'bg-surface-2 border border-line hover:border-line-strong hover:bg-surface-3',
    ghost: 'text-ink-2 hover:text-ink hover:bg-surface-2',
    danger: 'bg-surface-2 border border-line text-bad hover:border-bad'
  }[variant]
  return (
    <button {...rest} disabled={disabled || busy} className={cx(base, sizes, variants, className)}>
      {busy ? <Spinner /> : icon}
      {children}
    </button>
  )
}

export function IconButton({ label, active, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }): ReactNode {
  return (
    <button
      {...rest}
      title={label}
      aria-label={label}
      className={cx('inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:opacity-35', active ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink', className)}
    >
      {children}
    </button>
  )
}

export function Spinner({ size = 14 }: { size?: number }): ReactNode {
  return <span className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent opacity-80" style={{ width: size, height: size }} />
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }): ReactNode {
  return (
    <label className={cx('flex cursor-pointer items-start justify-between gap-4 py-1.5', disabled && 'opacity-50')}>
      <span>
        <span className="block">{label}</span>
        {hint && <span className="block text-[12.5px] text-ink-3">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-surface-3')}
      >
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-4.5' : 'left-0.5')} />
      </button>
    </label>
  )
}

export function Select<T extends string>({ value, onChange, options, className, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string; label?: string }): ReactNode {
  return (
    <select aria-label={label} className={cx('field h-8.5 py-0', className)} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Slider({ value, min, max, step = 1, onChange, label, format }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string; format?: (v: number) => string }): ReactNode {
  return (
    <label className="block py-1.5">
      <span className="mb-1.5 flex justify-between">
        <span>{label}</span>
        <span className="num text-ink-2">{format ? format(value) : value}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </label>
  )
}

export function Section({ title, description, children, aside }: { title: string; description?: string; children: ReactNode; aside?: ReactNode }): ReactNode {
  return (
    <section className="border-b border-line py-6 first:pt-0 last:border-0">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[17px]">{title}</h3>
          {description && <p className="mt-1 max-w-[70ch] text-[13px] text-ink-2">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex items-center justify-between gap-6 py-1.5">
      <div className="min-w-0">
        <div>{label}</div>
        {hint && <div className="text-[12.5px] text-ink-3">{hint}</div>}
      </div>
      <div className="w-64 shrink-0">{children}</div>
    </div>
  )
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'; children: ReactNode }): ReactNode {
  const tones = { neutral: 'bg-surface-3 text-ink-2', good: 'bg-good/15 text-good', warn: 'bg-warn/15 text-warn', bad: 'bg-bad/15 text-bad', accent: 'bg-accent-soft text-accent' }[tone]
  return <span className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] font-semibold tracking-wide', tones)}>{children}</span>
}

export function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'bad' }): ReactNode {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full transition-[width] duration-200', tone === 'bad' ? 'bg-bad' : 'bg-accent')} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  )
}

const PHASE: Record<DownloadProgress['phase'], string> = { downloading: 'Downloading', verifying: 'Verifying', extracting: 'Installing', done: 'Done', error: 'Failed', cancelled: 'Cancelled' }

export function DownloadRow({ p, onCancel }: { p: DownloadProgress; onCancel?: () => void }): ReactNode {
  const frac = p.totalBytes > 0 ? p.receivedBytes / p.totalBytes : 0
  return (
    <div className="fade-up">
      <div className="mb-1 flex items-center justify-between gap-3 text-[12.5px]">
        <span className="truncate text-ink-2">
          {PHASE[p.phase]} {p.label}
          {p.phase === 'error' && p.message ? ` — ${p.message}` : ''}
        </span>
        <span className="num shrink-0 text-ink-3">
          {p.phase === 'downloading' && p.totalBytes > 0 ? `${formatBytes(p.receivedBytes)} / ${formatBytes(p.totalBytes)}` : ''}
          {onCancel && p.phase === 'downloading' && (
            <button className="ml-2 text-ink-2 underline hover:text-ink" onClick={onCancel}>
              Cancel
            </button>
          )}
        </span>
      </div>
      <ProgressBar value={p.phase === 'done' ? 1 : frac} tone={p.phase === 'error' ? 'bad' : 'accent'} />
    </div>
  )
}

export function Modal({ title, onClose, children, width = 560, footer }: { title: string; onClose: () => void; children: ReactNode; width?: number; footer?: ReactNode }): ReactNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="fade-up flex max-h-full flex-col rounded-lg border border-line bg-surface shadow-[var(--shadow)]" style={{ width, maxWidth: '100%' }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[18px]">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <h3 className="text-[18px]">{title}</h3>
      {children && <p className="max-w-[52ch] text-ink-2">{children}</p>}
      {action}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad' | 'good'; children: ReactNode }): ReactNode {
  const tones = { info: 'border-info/40 bg-info/10', warn: 'border-warn/40 bg-warn/10', bad: 'border-bad/40 bg-bad/10', good: 'border-good/40 bg-good/10' }[tone]
  return <div className={cx('selectable rounded-md border px-3 py-2 text-[13px]', tones)}>{children}</div>
}
