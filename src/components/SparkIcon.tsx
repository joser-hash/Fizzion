/**
 * Sparks-currency icon: a neon diamond — soft glow halo, solid body, bright
 * core — matching the game's layered-glow look. Inherits the surrounding
 * text color via currentColor.
 */
export function SparkIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={{ display: 'inline-block', verticalAlign: '-0.125em' }}
      aria-hidden
    >
      <defs>
        <filter id="spark-neon-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.8" />
        </filter>
      </defs>
      <path
        d="M12 1.5 L20.5 12 L12 22.5 L3.5 12 Z"
        fill="currentColor"
        opacity="0.6"
        filter="url(#spark-neon-glow)"
      />
      <path d="M12 3 L19.2 12 L12 21 L4.8 12 Z" fill="currentColor" />
      <path d="M12 7.5 L15.6 12 L12 16.5 L8.4 12 Z" fill="#fff" opacity="0.9" />
    </svg>
  );
}
