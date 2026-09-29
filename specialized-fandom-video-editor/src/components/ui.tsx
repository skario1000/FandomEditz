import { useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../utils/cn';

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onReset?: () => void;
  format?: (v: number) => string;
  className?: string;
}) {
  const { label, value, min, max, step, onChange, onStart, onEnd, onReset, format } = props;
  const pct = ((value - min) / (max - min || 1)) * 100;
  const shown = format ? format(value) : step >= 1 ? String(Math.round(value)) : value.toFixed(step >= 0.1 ? 1 : 2);
  return (
    <label className={cn('block', props.className)} onDoubleClick={onReset} title={onReset ? 'Double-click to reset' : undefined}>
      <div className="mb-0.5 flex items-center justify-between text-[11px] text-zinc-400">
        <span>{label}</span>
        <span className="tabular-nums text-zinc-200">{shown}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerDown={() => onStart?.()}
        onPointerUp={(e) => {
          onEnd?.();
          e.currentTarget.blur();
        }}
        className="ev-range w-full"
        style={{ '--p': `${Math.max(0, Math.min(100, pct))}%` } as CSSProperties}
      />
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-2 py-1 text-left text-[12px] text-zinc-300" title={hint}>
      <span>{label}</span>
      <span className={cn('relative h-[18px] w-8 shrink-0 rounded-full transition-colors', checked ? 'bg-[#ff2d55]' : 'bg-zinc-700')}>
        <span className={cn('absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all', checked ? 'left-[16px]' : 'left-[2px]')} />
      </span>
    </button>
  );
}

export function Select({ label, value, options, onChange }: { label?: string; value: string; options: { v: string; l: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="block">
      {label && <div className="mb-0.5 text-[11px] text-zinc-400">{label}</div>}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            e.currentTarget.blur();
          }}
          className="w-full appearance-none rounded-md border border-white/[0.08] bg-[#15151d] px-2 py-1.5 pr-7 text-[12px] text-zinc-200 outline-none focus:border-[#ff2d55]/60"
        >
          {options.map((o) => (
            <option key={o.v} value={o.v}>
              {o.l}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
      </div>
    </label>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, className }: { value: T; options: { v: T; l: ReactNode; title?: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('flex rounded-md border border-white/[0.08] bg-[#121218] p-0.5', className)}>
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          title={o.title}
          onClick={() => onChange(o.v)}
          className={cn(
            'flex-1 whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium transition-colors',
            value === o.v ? 'bg-[#ff2d55] text-white shadow' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
          )}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

export function Btn({
  children,
  onClick,
  variant = 'ghost',
  className,
  title,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'ghost' | 'primary' | 'soft' | 'danger';
  className?: string;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'primary' && 'bg-gradient-to-r from-[#ff2d55] to-[#b026ff] text-white shadow-lg shadow-[#ff2d55]/20 hover:brightness-110',
        variant === 'soft' && 'border border-white/[0.08] bg-white/[0.04] text-zinc-200 hover:bg-white/[0.09]',
        variant === 'ghost' && 'text-zinc-300 hover:bg-white/[0.07] hover:text-white',
        variant === 'danger' && 'border border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20',
        className
      )}
    >
      {children}
    </button>
  );
}

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/[0.05]">
      <div className="flex items-center justify-between px-3 py-2">
        <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 hover:text-zinc-300">
          <ChevronDown className={cn('h-3 w-3 transition-transform', !open && '-rotate-90')} />
          {title}
        </button>
        {right}
      </div>
      {open && <div className="space-y-2.5 px-3 pb-3">{children}</div>}
    </div>
  );
}

export function NumField({ label, value, step = 0.01, min, max, onChange, suffix }: { label: string; value: number; step?: number; min?: number; max?: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <label className="block">
      <div className="mb-0.5 text-[11px] text-zinc-400">{label}</div>
      <div className="flex items-center rounded-md border border-white/[0.08] bg-[#15151d] focus-within:border-[#ff2d55]/60">
        <input
          type="number"
          value={Number(value.toFixed(3))}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
          className="w-full min-w-0 bg-transparent px-2 py-1 text-[12px] tabular-nums text-zinc-200 outline-none"
        />
        {suffix && <span className="pr-2 text-[10px] text-zinc-500">{suffix}</span>}
      </div>
    </label>
  );
}

export function Chip({ active, children, onClick, color }: { active?: boolean; children: ReactNode; onClick?: () => void; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        active ? 'border-transparent bg-white text-black' : 'border-white/[0.08] bg-white/[0.03] text-zinc-400 hover:text-zinc-100'
      )}
      style={active && color ? { background: color, color: '#0b0b10' } : undefined}
    >
      {children}
    </button>
  );
}
