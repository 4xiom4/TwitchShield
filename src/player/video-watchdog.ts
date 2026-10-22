import { pauseResumePlayer, reloadPlayer } from './react-hook';
import { loadUserConfig } from '../config';

export class VideoWatchdog {
  private video: HTMLVideoElement | null = null;
  private lastTime = 0;
  private lastProgress = Date.now();
  private stallCount = 0;
  private checkInterval: any = null;
  private isStripping = false;

  constructor() {
    this.initWatchdog();
  }

  public setStrippingState(isStripping: boolean): void {
    this.isStripping = isStripping;
  }

  private initWatchdog(): void {
    const attachToVideo = () => {
      const v = document.querySelector('video');
      if (v && v !== this.video) {
        this.video = v;
        this.bindEvents(v);
      }
    };

    attachToVideo();
    const observer = new MutationObserver(() => attachToVideo());
    observer.observe(document.body, { childList: true, subtree: true });

    this.checkInterval = setInterval(() => this.checkStall(), 1500);
  }

  private bindEvents(v: HTMLVideoElement): void {
    v.addEventListener('playing', () => {
      this.stallCount = 0;
      this.lastProgress = Date.now();
      this.lastTime = v.currentTime;
    });

    v.addEventListener('waiting', () => {
      this.onStallDetected('waiting event');
    });

    v.addEventListener('stalled', () => {
      this.onStallDetected('stalled event');
    });

    v.addEventListener('timeupdate', () => {
      if (v.currentTime !== this.lastTime) {
        this.lastTime = v.currentTime;
        this.lastProgress = Date.now();
        this.stallCount = 0;
      }
    });
  }

  private checkStall(): void {
    const config = loadUserConfig();
    if (!config.playerBufferingFix || !this.video) return;

    if (this.isStripping) return;

    if (!this.video.paused && !this.video.ended && this.video.readyState >= 2) {
      const now = Date.now();
      if (now - this.lastProgress > 3000) {
        this.onStallDetected('playback stalled (>3s no progress)');
      }
    }
  }

  private onStallDetected(reason: string): void {
    const config = loadUserConfig();
    if (!config.playerBufferingFix || this.isStripping) return;

    const now = Date.now();
    if (now - this.lastProgress < 1500) return;

    this.stallCount++;
    console.warn(`[TwitchShield Watchdog] Stall detected (${reason}), attempt #${this.stallCount}`);

    if (this.stallCount <= 2) {
      pauseResumePlayer();
    } else if (this.stallCount === 3 && config.playerBufferingDoPlayerReload) {
      reloadPlayer();
    }
    this.lastProgress = Date.now();
  }

  public destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}
