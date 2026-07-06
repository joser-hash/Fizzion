import { useCallback } from 'react';
import { adService, type RewardedPlacement, type RewardedResult } from '../lib/ads';
import { CONFIG } from '../lib/constants';
import { useGameStore } from '../store/gameStore';

/**
 * Thin wrapper around the AdService that also maintains the per-session
 * ad counters used for later tuning.
 */
export function useAdService() {
  const watchRewarded = useCallback(
    async (placement: RewardedPlacement): Promise<RewardedResult> => {
      const result = await adService.showRewarded(placement);
      useGameStore.getState().recordAd(result === 'completed');
      return result;
    },
    [],
  );

  /**
   * Between-rounds interstitial: at most one per N rounds, never during
   * the player's first two rounds ever, never for Remove Ads owners, and
   * courtesy-skipped when the player already watched a rewarded ad this
   * run. Returns after the ad closes (or immediately when no ad is due).
   */
  const maybeShowInterstitial = useCallback(async (): Promise<void> => {
    const s = useGameStore.getState();
    if (s.adsRemoved) return;
    if (s.rewardedThisRun) return;
    const pastGrace = s.roundsPlayed > CONFIG.interstitialGraceRounds;
    const due = s.roundsSinceInterstitial >= CONFIG.interstitialEveryNRounds;
    if (!pastGrace || !due) return;
    await adService.showInterstitial();
    const st = useGameStore.getState();
    st.recordAd(true);
    st.markInterstitialShown();
  }, []);

  return { watchRewarded, maybeShowInterstitial };
}
