// First-party event tracking (spec §8). Aggregate-only, no cookies, no IDs.
// Viewability = IntersectionObserver ≥50% visible for 1 continuous second.

import type { TrackingConfig } from './types';

export type EventType = 'load' | 'viewable' | 'product_impression' | 'click';

export class Tracker {
  private readonly url: string;
  private readonly base: Record<string, string>;
  private readonly kv: Record<string, string>;
  private readonly device: string;
  private sentViewable = false;
  private readonly seenProducts = new Set<string>();

  constructor(config: TrackingConfig, kv: Record<string, string>, device: string) {
    this.url = config.endpoint.replace(/\/$/, '') + '/api/events';
    this.base = {
      placement_id: config.placementId,
      instance_id: config.instanceId,
      advertiser_id: config.advertiserId,
      site_id: config.siteId,
    };
    this.kv = kv;
    this.device = device;
  }

  send(type: EventType, productId?: string): void {
    try {
      if (type === 'viewable') {
        if (this.sentViewable) return;
        this.sentViewable = true;
      }
      if (type === 'product_impression' && productId) {
        if (this.seenProducts.has(productId)) return;
        this.seenProducts.add(productId);
      }
      const body = JSON.stringify({
        type,
        ...this.base,
        product_id: productId,
        kv_context: this.kv,
        device_class: this.device,
      });
      if (navigator.sendBeacon && navigator.sendBeacon(this.url, new Blob([body], { type: 'application/json' }))) {
        return;
      }
      void fetch(this.url, {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      /* fail silent */
    }
  }

  /** Fires 'viewable' once the element has been ≥50% in view for 1s (spec §8). */
  observeViewable(el: Element): void {
    this.observe(el, () => this.send('viewable'));
  }

  /** Fires 'product_impression' once per product actually in view. */
  observeProduct(el: Element, productId: string): void {
    this.observe(el, () => this.send('product_impression', productId));
  }

  private observe(el: Element, fire: () => void): void {
    try {
      if (typeof IntersectionObserver === 'undefined') return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.intersectionRatio >= 0.5) {
              if (timer === undefined) {
                timer = setTimeout(() => {
                  fire();
                  io.disconnect();
                }, 1000);
              }
            } else if (timer !== undefined) {
              clearTimeout(timer);
              timer = undefined;
            }
          }
        },
        { threshold: [0, 0.5] },
      );
      io.observe(el);
    } catch {
      /* fail silent */
    }
  }
}
