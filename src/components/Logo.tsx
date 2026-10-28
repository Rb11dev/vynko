// Original VYNKO mark: a "V" built from two overlapping speech bubbles, with a call-signal dot.
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="vy-g" x1="4" y1="2" x2="44" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6D4AFF" /><stop offset="1" stopColor="#FF5C8A" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill="url(#vy-g)" />
      <path d="M11 14.5c0-1.1.9-2 2-2h5.2c.9 0 1.7.6 1.9 1.5L24 28l3.9-14c.2-.9 1-1.5 1.9-1.5H35c1.1 0 2 .9 2 2 0 .2 0 .4-.1.6L30 36.4c-.3.9-1.1 1.6-2.1 1.6h-7.8c-1 0-1.8-.7-2.1-1.6L11.1 15.1c-.1-.2-.1-.4-.1-.6Z" fill="#fff" fillOpacity=".95" />
      <circle cx="37" cy="11" r="3.2" fill="#fff" />
    </svg>
  );
}
export function Logo({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      <span className="text-xl font-extrabold tracking-[0.18em]">VYNKO</span>
    </span>
  );
}
