import { type CSSProperties, type FC, useId } from 'react';

interface AppIconProps {
  /** Rendered width/height in px. The icon is square. */
  size?: number;
  style?: CSSProperties;
  className?: string;
}

/**
 * The VibeYTM app icon as inline SVG — the same artwork that ships in
 * `src-tauri/icons` (source: `src-tauri/app-icon.svg`). A glossy red
 * squircle holding a headphone-wearing head with a musical smiling face
 * (eighth-note eyes + smile).
 *
 * Rendered full-bleed (viewBox cropped to the squircle, dropping the
 * macOS dock padding) so it reads as a substantial in-app brand mark.
 *
 * Gradient/filter/clip IDs are namespaced per instance via `useId` so
 * multiple icons (or other inline SVGs on the page) never cross-reference
 * each other's defs.
 */
export const AppIcon: FC<AppIconProps> = ({ size = 112, style, className }) => {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="100 100 824 824"
      fill="none"
      role="img"
      aria-label="VibeYTM"
      style={style}
      className={className}
    >
      <defs>
        <linearGradient
          id={id('bg')}
          x1="512"
          y1="100"
          x2="512"
          y2="924"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#FF5B60" />
          <stop offset="0.42" stopColor="#FF1E2D" />
          <stop offset="1" stopColor="#C00018" />
        </linearGradient>
        <linearGradient
          id={id('gloss')}
          x1="512"
          y1="100"
          x2="512"
          y2="600"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.30" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id={id('fig')}
          x1="512"
          y1="220"
          x2="512"
          y2="820"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#EFEFF4" />
        </linearGradient>
        <linearGradient
          id={id('note')}
          x1="512"
          y1="380"
          x2="512"
          y2="650"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#FF2A38" />
          <stop offset="1" stopColor="#DE0C1E" />
        </linearGradient>
        <filter id={id('figShadow')} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow
            dx="0"
            dy="14"
            stdDeviation="20"
            floodColor="#54000A"
            floodOpacity="0.38"
          />
        </filter>
        <filter id={id('noteShadow')} x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow
            dx="0"
            dy="6"
            stdDeviation="9"
            floodColor="#3A0006"
            floodOpacity="0.22"
          />
        </filter>
        <clipPath id={id('squircle')}>
          <rect x="100" y="100" width="824" height="824" rx="186" ry="186" />
        </clipPath>
      </defs>

      {/* App squircle */}
      <rect
        x="100"
        y="100"
        width="824"
        height="824"
        rx="186"
        ry="186"
        fill={`url(#${id('bg')})`}
      />
      <rect
        x="100"
        y="100"
        width="824"
        height="824"
        rx="186"
        ry="186"
        fill={`url(#${id('gloss')})`}
      />
      <rect
        x="103"
        y="103"
        width="818"
        height="818"
        rx="183"
        ry="183"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.22"
        strokeWidth="3"
      />

      <g clipPath={`url(#${id('squircle')})`}>
        <g filter={`url(#${id('figShadow')})`}>
          {/* Head */}
          <circle cx="512" cy="515" r="294" fill={`url(#${id('fig')})`} />
          {/* Headphone band over the top */}
          <path
            d="M 212 455 A 305 305 0 0 1 812 455"
            fill="none"
            stroke={`url(#${id('fig')})`}
            strokeWidth="60"
            strokeLinecap="round"
          />
        </g>
        {/* Ear cups */}
        <g filter={`url(#${id('figShadow')})`}>
          <rect x="139" y="413" width="146" height="255" rx="65" fill={`url(#${id('fig')})`} />
          <rect x="739" y="413" width="146" height="255" rx="65" fill={`url(#${id('fig')})`} />
        </g>

        {/* Musical smiling face (features spread 1.5x apart) */}
        <g fill={`url(#${id('note')})`} filter={`url(#${id('noteShadow')})`}>
          {/* left eye: little eighth-note */}
          <g transform="translate(-32 -24)">
            <ellipse cx="448" cy="496" rx="30" ry="25" transform="rotate(-18 448 496)" />
            <rect x="472" y="430" width="11" height="66" rx="5" />
            <path d="M 483 430 q 30 7 25 40 q -3 -19 -25 -24 z" />
          </g>
          {/* right eye: little eighth-note */}
          <g transform="translate(32 -24)">
            <ellipse cx="576" cy="496" rx="30" ry="25" transform="rotate(-18 576 496)" />
            <rect x="600" y="430" width="11" height="66" rx="5" />
            <path d="M 611 430 q 30 7 25 40 q -3 -19 -25 -24 z" />
          </g>
        </g>
        {/* smile */}
        <path
          d="M 426 560 Q 512 658 598 560"
          fill="none"
          stroke={`url(#${id('note')})`}
          strokeWidth="30"
          strokeLinecap="round"
          filter={`url(#${id('noteShadow')})`}
          transform="translate(0 28)"
        />
      </g>
    </svg>
  );
};
