import { IAP_CATALOG, type IapProduct } from './constants';

export type RewardedPlacement =
  | 'stabilize'
  | 'color_lock'
  | 'double_down'
  | 'second_wind'
  | 'boost_reroll'
  | 'daily_gift'
  | 'upgrade_trial';
export type RewardedResult = 'completed' | 'skipped';

/**
 * The only ad surface gameplay code may touch. The real AdMob/AppLovin
 * implementation replaces MockAdService at Capacitor wrap time.
 */
export interface AdService {
  showRewarded(placement: RewardedPlacement): Promise<RewardedResult>;
  showInterstitial(): Promise<void>;
  isBannerAvailable(): boolean;
}

export interface PurchaseResult {
  success: boolean;
  productId: string;
}

export interface PurchaseService {
  getCatalog(): readonly IapProduct[];
  purchase(productId: string): Promise<PurchaseResult>;
}

// ---- mock implementations ------------------------------------------------

export interface MockAdRequest {
  kind: 'rewarded' | 'interstitial';
  placement?: RewardedPlacement;
}

type AdHostListener = (req: MockAdRequest | null) => void;

/**
 * Mock: a full-screen "AD (mock)" modal with a 3s countdown, hosted by the
 * React <AdModal>. The modal registers itself via `mockAdController`.
 */
class MockAdService implements AdService {
  private listener: AdHostListener | null = null;
  private resolver: ((r: RewardedResult) => void) | null = null;

  /** Called by the AdModal host component. */
  setHost(listener: AdHostListener | null): void {
    this.listener = listener;
  }

  /** Called by the AdModal when the user finishes or skips. */
  finish(result: RewardedResult): void {
    this.listener?.(null);
    this.resolver?.(result);
    this.resolver = null;
  }

  showRewarded(placement: RewardedPlacement): Promise<RewardedResult> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.listener?.({ kind: 'rewarded', placement });
    });
  }

  showInterstitial(): Promise<void> {
    return new Promise((resolve) => {
      this.resolver = () => resolve();
      this.listener?.({ kind: 'interstitial' });
    });
  }

  isBannerAvailable(): boolean {
    return true;
  }
}

class MockPurchaseService implements PurchaseService {
  getCatalog(): readonly IapProduct[] {
    return IAP_CATALOG;
  }

  purchase(productId: string): Promise<PurchaseResult> {
    return Promise.resolve({ success: true, productId });
  }
}

export const mockAdController = new MockAdService();
export const adService: AdService = mockAdController;
export const purchaseService: PurchaseService = new MockPurchaseService();
