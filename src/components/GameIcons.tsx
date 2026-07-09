import type { FC, ReactNode } from 'react';

/**
 * Monoline neon icon set for boosts and shop upgrades. Same family as
 * SparkIcon: currentColor so each context tints it (rarity color on boost
 * cards, Sparks yellow in the shop), glow via CSS drop-shadow instead of an
 * SVG filter so repeated instances don't collide on filter ids.
 */
export interface GameIconProps {
  size?: number;
  className?: string;
}

export type GameIcon = FC<GameIconProps>;

function Base({
  size = 20,
  className,
  children,
}: GameIconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={{
        display: 'inline-block',
        verticalAlign: '-0.125em',
        filter: 'drop-shadow(0 0 3px currentColor)',
      }}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

// --- Boosts -----------------------------------------------------------------

/** Winding fuse ending in a spark burst. */
const LongFuseIcon: GameIcon = (p) => (
  <Base {...p}>
    <path d="M3 19c4.5 0 4.5-7 8-7s3.5-6 7-6" />
    <path d="M18 2.5v2M21.5 6h-2M20.8 3.2l-1.4 1.4" />
  </Base>
);

/** Gauge dial, needle past center. */
const TunerIcon: GameIcon = (p) => (
  <Base {...p}>
    <path d="M4 17a8 8 0 0 1 16 0" />
    <path d="M12 17l4.6-5.4" />
    <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
  </Base>
);

/** Spark diamond with a plus. */
const BountyIcon: GameIcon = (p) => (
  <Base {...p}>
    <path d="M10 5.5 15.5 12 10 18.5 4.5 12Z" />
    <path d="M19 4.5v5M16.5 7h5" />
  </Base>
);

/** Chevron with speed lines. */
const FeatherweightIcon: GameIcon = (p) => (
  <Base {...p}>
    <path d="M11 5l8 7-8 7" />
    <path d="M3.5 8.5h4M2.5 12h5M3.5 15.5h4" />
  </Base>
);

/** Arrows converging on a core. */
const PressureValveIcon: GameIcon = (p) => (
  <Base {...p}>
    <circle cx="12" cy="13" r="3" />
    <path d="M4.5 4.5l3.6 3.6M8.1 5.6v2.5H5.6" />
    <path d="M19.5 4.5l-3.6 3.6M15.9 5.6v2.5h2.5" />
    <path d="M12 21.5v-3.6M10 19.4l2 2 2-2" />
  </Base>
);

/** Shield. */
const InsuranceIcon: GameIcon = (p) => (
  <Base {...p}>
    <path d="M12 3l7 2.8v5.4c0 4.5-2.9 7.5-7 9.8-4.1-2.3-7-5.3-7-9.8V5.8Z" />
    <path d="M9.2 11.6l2 2.2 3.6-4" />
  </Base>
);

/** Prism refracting into four drops. */
const PrismIcon: GameIcon = (p) => (
  <Base {...p}>
    <path d="M9 4.5 15.5 18h-13Z" />
    <path d="M2.5 8.5H6" />
    <circle cx="19" cy="7" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="20.5" cy="10.7" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="20.5" cy="14.4" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="19" cy="18" r="1.1" fill="currentColor" stroke="none" />
  </Base>
);

/** Flame inside a ring. */
const ControlledBurnIcon: GameIcon = (p) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 6.8c2 2.2 3 3.9 3 5.6a3 3 0 0 1-6 0c0-1.7 1-3.4 3-5.6Z" />
  </Base>
);

/** Two chain links, sparks flying off the strained one. */
const ChainReactorIcon: GameIcon = (p) => (
  <Base {...p}>
    <rect x="2.5" y="9.5" width="9.5" height="6" rx="3" />
    <rect x="12" y="9.5" width="9.5" height="6" rx="3" />
    <path d="M18 5.5l1.2-1.7M20 7.5 21.8 6.4" />
  </Base>
);

// --- Shop upgrades ----------------------------------------------------------

/** Portal ring with corner brackets. */
const ReinforcedPortalIcon: GameIcon = (p) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="5" />
    <path d="M3.5 7.5v-2.5a1.5 1.5 0 0 1 1.5-1.5h2.5" />
    <path d="M16.5 3.5h2.5a1.5 1.5 0 0 1 1.5 1.5v2.5" />
    <path d="M20.5 16.5v2.5a1.5 1.5 0 0 1-1.5 1.5h-2.5" />
    <path d="M7.5 20.5h-2.5a1.5 1.5 0 0 1-1.5-1.5v-2.5" />
  </Base>
);

/** Horseshoe magnet with field arcs. */
const MagnetCoreIcon: GameIcon = (p) => (
  <Base {...p}>
    <path d="M8 3v7a4 4 0 0 0 8 0V3" />
    <path d="M6.2 6h3.6M14.2 6h3.6" />
    <path d="M7.5 17.5a6 6 0 0 1 9 0" />
    <path d="M9.8 20.5a3.2 3.2 0 0 1 4.4 0" />
  </Base>
);

/** Nested hexagons. */
const DenseShellIcon: GameIcon = (p) => (
  <Base {...p}>
    <path d="M12 2.8l7.6 4.4v9.6L12 21.2l-7.6-4.4V7.2Z" />
    <path d="M12 8l3.8 2.2v4.4L12 16.8l-3.8-2.2v-4.4Z" />
  </Base>
);

/** Padlock with a charge bolt. */
const LockBatteryIcon: GameIcon = (p) => (
  <Base {...p}>
    <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" />
    <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
    <path d="M13 12.8l-2.2 3h2.8l-2.2 3" />
  </Base>
);

/** Pickaxe over a spark diamond. */
const ProspectorIcon: GameIcon = (p) => (
  <Base {...p}>
    <path d="M5.5 8.5C8.5 4.5 14.5 3.5 19 6.5" />
    <path d="M12 5.2 20 16" />
    <path d="M6.5 13.5l3 3.5-3 3.5-3-3.5Z" />
  </Base>
);

/** Warding sign: thief ring, crossed out. */
const WardIcon: GameIcon = (p) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M6.3 6.3l11.4 11.4" />
  </Base>
);

/** Revival pulse with a plus. */
const SecondChancePlusIcon: GameIcon = (p) => (
  <Base {...p}>
    <path d="M3 13.5h3.5L9 8.5l3.5 9 2.5-6H18" />
    <path d="M20.5 3.5v4M18.5 5.5h4" />
  </Base>
);

/** Droplet held above the ground line. */
const StickyDropsIcon: GameIcon = (p) => (
  <Base {...p}>
    <path d="M12 3.5c3.2 4 4.8 6.5 4.8 8.9a4.8 4.8 0 0 1-9.6 0c0-2.4 1.6-4.9 4.8-8.9Z" />
    <path d="M8.5 21.5h7" />
  </Base>
);

/** Sunrise over the horizon. */
const WarmStartIcon: GameIcon = (p) => (
  <Base {...p}>
    <path d="M3 17.5h18" />
    <path d="M7.5 17.5a4.5 4.5 0 0 1 9 0" />
    <path d="M12 9V6M6.6 10.6 4.8 8.8M17.4 10.6l1.8-1.8" />
  </Base>
);

/** Icons keyed by boost / upgrade id (the two id spaces don't overlap). */
export const GAME_ICONS: Record<string, GameIcon> = {
  // boosts
  long_fuse: LongFuseIcon,
  tuner: TunerIcon,
  bounty: BountyIcon,
  featherweight: FeatherweightIcon,
  pressure_valve: PressureValveIcon,
  insurance: InsuranceIcon,
  prism: PrismIcon,
  controlled_burn: ControlledBurnIcon,
  chain_reactor: ChainReactorIcon,
  // shop upgrades
  reinforced_portal: ReinforcedPortalIcon,
  magnet_core: MagnetCoreIcon,
  dense_shell: DenseShellIcon,
  lock_battery: LockBatteryIcon,
  prospector: ProspectorIcon,
  ward: WardIcon,
  second_chance_plus: SecondChancePlusIcon,
  sticky_drops: StickyDropsIcon,
  warm_start: WarmStartIcon,
};
