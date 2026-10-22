import { getCachedGQLHash, setCachedGQLHash } from '../config';
import { GQLHeaders } from '../types';

export const FALLBACK_PLAYBACK_ACCESS_TOKEN_HASH =
  'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';

export class GQLManager {
  private static instance: GQLManager;
  private currentHash: string;
  private deviceId: string | null = null;
  private headers: GQLHeaders = {};

  private constructor() {
    this.currentHash = getCachedGQLHash() || FALLBACK_PLAYBACK_ACCESS_TOKEN_HASH;
  }

  public static getInstance(): GQLManager {
    if (!GQLManager.instance) {
      GQLManager.instance = new GQLManager();
    }
    return GQLManager.instance;
  }

  public getPlaybackAccessTokenHash(): string {
    return this.currentHash;
  }

  public updateHash(hash: string): void {
    if (hash && hash !== this.currentHash) {
      this.currentHash = hash;
      setCachedGQLHash(hash);
      console.log(`[TwitchShield] Captured new PlaybackAccessToken sha256 hash: ${hash}`);
    }
  }

  public updateHeaders(headers: Record<string, string | undefined>): void {
    if (headers['Client-Integrity']) {
      this.headers['Client-Integrity'] = headers['Client-Integrity'];
    }
    if (headers['Client-Version']) {
      this.headers['Client-Version'] = headers['Client-Version'];
    }
    if (headers['Client-Session-Id']) {
      this.headers['Client-Session-Id'] = headers['Client-Session-Id'];
    }
    if (headers['Authorization']) {
      this.headers['Authorization'] = headers['Authorization'];
    }
    const devId = headers['X-Device-Id'] || headers['Device-ID'];
    if (devId) {
      this.deviceId = devId;
      this.headers['X-Device-Id'] = devId;
    }
  }

  public getDeviceId(): string {
    if (!this.deviceId) {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let id = '';
      for (let i = 0; i < 32; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      this.deviceId = id;
    }
    return this.deviceId;
  }

  public getHeaders(clientId: string): Record<string, string> {
    const res: Record<string, string> = {
      'Client-ID': clientId,
      'X-Device-Id': this.getDeviceId()
    };

    if (this.headers['Authorization']) {
      res['Authorization'] = this.headers['Authorization'];
    }
    if (this.headers['Client-Integrity']) {
      res['Client-Integrity'] = this.headers['Client-Integrity'];
    }
    if (this.headers['Client-Version']) {
      res['Client-Version'] = this.headers['Client-Version'];
    }
    if (this.headers['Client-Session-Id']) {
      res['Client-Session-Id'] = this.headers['Client-Session-Id'];
    }

    return res;
  }

  public createAccessTokenPayload(channelName: string, playerType: string): object {
    return {
      operationName: 'PlaybackAccessToken',
      variables: {
        isLive: true,
        login: channelName,
        isVod: false,
        vodID: '',
        playerType: playerType,
        platform: playerType === 'autoplay' ? 'android' : 'web'
      },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: this.getPlaybackAccessTokenHash()
        }
      }
    };
  }

  /**
   * Inspects outgoing fetch requests to capture latest hash and headers.
   */
  public inspectFetchRequest(url: string, init?: RequestInit): void {
    if (!url.includes('/gql') || !init) return;

    if (init.headers) {
      const h = init.headers as Record<string, string>;
      this.updateHeaders(h);
    }

    if (typeof init.body === 'string' && init.body.includes('PlaybackAccessToken')) {
      try {
        const parsed = JSON.parse(init.body);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (
            item?.operationName === 'PlaybackAccessToken' &&
            item?.extensions?.persistedQuery?.sha256Hash
          ) {
            this.updateHash(item.extensions.persistedQuery.sha256Hash);
          }
        }
      } catch {}
    }
  }
}
