import { useState, useRef, type ReactNode } from 'react';

interface TooltipProps {
  text: string;
  children: ReactNode;
  delay?: number;
  position?: 'bottom' | 'top';
}

export function Tooltip({ text, children, delay = 500, position = 'bottom' }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const onEnter = () => {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  };

  const onLeave = () => {
    clearTimeout(timerRef.current);
    setVisible(false);
  };

  const posClass = position === 'bottom'
    ? 'top-full mt-1.5'
    : 'bottom-full mb-1.5';

  return (
    <div className="relative inline-flex" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {children}
      {visible && (
        <div className={`absolute left-1/2 -translate-x-1/2 ${posClass} px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-[11px] text-zinc-300 whitespace-nowrap z-50 pointer-events-none shadow-lg`}>
          {text}
        </div>
      )}
    </div>
  );
}
