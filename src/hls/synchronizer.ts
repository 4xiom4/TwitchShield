import { ParsedHLS, HLSSegment } from '../types';
import { parseHLS, stringifyHLS } from './parser';

export const SILENT_MP4_BASE64 =
  'data:video/mp4;base64,AAAAKGZ0eXBtcDQyAAAAAWlzb21tcDQyZGFzaGF2YzFpc282aGxzZgAABEltb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAYagAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAABqHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAURtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAALuAAAAAAFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAADvbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAACzc3RibAAAAGdzdHNkAAAAAAAAAAEAAABXbXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAALuAAAAAAAAzZXNkcwAAAAADgICAIgABAASAgIAUQBUAAAAAAAAAAAAAAAWAgIACEZAGgICAAQIAAAAQc3R0cwAAAAAAAAAAAAAAEHN0c2MAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAeV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAoAAAAFoAAAAAAGBbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAA9CQAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABLG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAOxzdGJsAAAAoHN0c2QAAAAAAAAAAQAAAJBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAoABaABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAOmF2Y0MBTUAe/+EAI2dNQB6WUoFAX/LgLUBAQFAAAD6AAA6mDgAAHoQAA9CW7y4KAQAEaOuPIAAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAAAAAQc3RjbwAAAAAAAAAAAAAASG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAC4AAAAAAoAAAAAAACB0cmV4AAAAAAAAAAIAAAABAACCNQAAAAACQAAA';

export interface SyncState {
  lastSequence: number | null;
  isBackupActive: boolean;
  adSegmentCache: Map<string, number>;
}

export class HLSSynchronizer {
  private adSegmentCache = new Map<string, number>();
  private lastSeenSequence: number | null = null;
  private currentStreamType: string | null = null;

  public hasAds(textStr: string, adSignifier = 'stitched'): boolean {
    return (
      textStr.includes(adSignifier) ||
      textStr.includes('stitched-ad') ||
      textStr.includes('"MIDROLL"') ||
      textStr.includes('"midroll"')
    );
  }

  public isAdSegment(url: string): boolean {
    return this.adSegmentCache.has(url);
  }

  /**
   * Sanitizes tracking and strips ad segments when no clean backup stream is available.
   */
  public stripAdsFromPlaylist(
    rawText: string,
    adSignifier = 'stitched'
  ): { cleanedText: string; strippedCount: number } {
    let strippedCount = 0;
    const parsed = parseHLS(rawText, adSignifier);

    if (parsed.isMaster) {
      return { cleanedText: rawText, strippedCount: 0 };
    }

    const cleanedSegments: HLSSegment[] = [];
    let hadDiscontinuity = false;

    // Filter out prefetch tags during ads
    parsed.headers = parsed.headers.filter(
      h => !h.startsWith('#EXT-X-TWITCH-PREFETCH:')
    );

    for (const seg of parsed.segments) {
      if (seg.isAd) {
        strippedCount++;
        this.adSegmentCache.set(seg.uri, Date.now());
        hadDiscontinuity = true;
      } else {
        if (hadDiscontinuity && cleanedSegments.length > 0) {
          seg.discontinuity = true;
          hadDiscontinuity = false;
        }
        cleanedSegments.push(seg);
      }
    }

    parsed.segments = cleanedSegments;

    // Purge old cache entries (older than 2 minutes)
    const now = Date.now();
    for (const [key, timestamp] of this.adSegmentCache.entries()) {
      if (now - timestamp > 120000) {
        this.adSegmentCache.delete(key);
      }
    }

    let cleaned = stringifyHLS(parsed);

    // Sanitize any ad click tracking tags
    cleaned = cleaned
      .replaceAll(/(X-TV-TWITCH-AD-URL=")(?:[^"]*)(")/g, '$1https://twitch.tv$2')
      .replaceAll(/(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")(?:[^"]*)(")/g, '$1https://twitch.tv$2');

    return {
      cleanedText: cleaned,
      strippedCount
    };
  }

  /**
   * Aligns continuity tags between main stream and backup stream to eliminate audio desync.
   */
  public alignBackupPlaylist(
    backupText: string,
    playerType: string
  ): string {
    const parsed = parseHLS(backupText);
    if (parsed.isMaster || parsed.segments.length === 0) {
      return backupText;
    }

    // If stream type changed (main <-> backup), enforce discontinuity tag on the first segment
    if (this.currentStreamType !== playerType) {
      this.currentStreamType = playerType;
      parsed.segments[0].discontinuity = true;
    }

    this.lastSeenSequence = parsed.mediaSequence ?? null;
    return stringifyHLS(parsed);
  }

  public resetStreamType(): void {
    this.currentStreamType = null;
  }
}
