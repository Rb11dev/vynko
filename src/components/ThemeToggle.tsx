'use client';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains('dark')), []);
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('vynko-theme', next ? 'dark' : 'light'); } catch { /* private mode */ }
    setDark(next);
  };
  return (
    <button onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`grid h-10 w-10 place-items-center rounded-xl text-muted transition hover:bg-raised hover:text-ink ${className}`}>
      {dark ? <Sun size={19} /> : <Moon size={19} />}
    </button>
  );
}
