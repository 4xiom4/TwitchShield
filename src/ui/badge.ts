import { loadUserConfig, saveUserConfig } from '../config';
import { reloadPlayer } from '../player/react-hook';
import { GQLManager } from '../gql/dynamic-hash';

export interface BannerData {
  hasAds: boolean;
  isMidroll?: boolean;
  isStrippingAdSegments?: boolean;
  numStrippedAdSegments?: number;
  backupType?: string | null;
}

export class TwitchShieldOverlay {
  private container: HTMLDivElement | null = null;
  private statusText: HTMLSpanElement | null = null;
  private settingsModal: HTMLDivElement | null = null;
  private adsBlockedCount = 0;

  constructor() {
    this.createOverlay();
  }

  public update(data: BannerData): void {
    if (!this.container || !this.statusText) {
      this.createOverlay();
    }
    if (!this.container || !this.statusText) return;

    if (data.hasAds) {
      this.container.style.display = 'flex';
      let msg = '🛡️ Shield: Blocking ';
      msg += data.isMidroll ? 'midroll ' : '';
      if (data.isStrippingAdSegments) {
        msg += '(stripping)';
      } else if (data.backupType) {
        msg += `(${data.backupType})`;
      } else {
        msg += 'ads';
      }
      this.statusText.textContent = msg;
      this.adsBlockedCount++;
    } else {
      this.container.style.display = 'none';
    }
  }

  private createOverlay(): void {
    const playerRoot = document.querySelector('.video-player');
    if (!playerRoot || playerRoot.querySelector('.ts-overlay-root')) return;

    const root = document.createElement('div');
    root.className = 'ts-overlay-root';
    root.style.cssText = `
      position: absolute;
      top: 12px;
      left: 12px;
      z-index: 9999;
      display: none;
      align-items: center;
      gap: 8px;
      font-family: Inter, Roobert, "Helvetica Neue", sans-serif;
      font-size: 12px;
      color: #efeff1;
      background: rgba(24, 24, 27, 0.85);
      backdrop-filter: blur(4px);
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid rgba(145, 70, 255, 0.4);
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      user-select: none;
      cursor: pointer;
    `;

    const status = document.createElement('span');
    status.textContent = '🛡️ TwitchShield Active';
    root.appendChild(status);

    const gearBtn = document.createElement('span');
    gearBtn.textContent = ' ⚙️';
    gearBtn.title = 'TwitchShield Settings';
    root.appendChild(gearBtn);

    root.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSettingsModal(playerRoot as HTMLElement);
    });

    playerRoot.appendChild(root);
    this.container = root;
    this.statusText = status;
  }

  private toggleSettingsModal(parent: HTMLElement): void {
    if (this.settingsModal) {
      this.settingsModal.remove();
      this.settingsModal = null;
      return;
    }

    const cfg = loadUserConfig();
    const gql = GQLManager.getInstance();

    const modal = document.createElement('div');
    modal.className = 'ts-settings-modal';
    modal.style.cssText = `
      position: absolute;
      top: 50px;
      left: 12px;
      z-index: 10000;
      background: #18181b;
      color: #efeff1;
      border: 1px solid #772ce8;
      border-radius: 8px;
      padding: 14px;
      width: 260px;
      font-family: Inter, Roobert, sans-serif;
      font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.6);
    `;

    modal.innerHTML = `
      <div style="font-weight: 700; margin-bottom: 10px; display: flex; justify-content: space-between;">
        <span>TwitchShield</span>
        <span id="ts-close-btn" style="cursor: pointer; color: #adadb8;">✕</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px;">
        <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
          <span>Auto Buffer Watchdog</span>
          <input type="checkbox" id="ts-cfg-buffering" ${cfg.playerBufferingFix ? 'checked' : ''} />
        </label>
        <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
          <span>Ad Stripping Fallback</span>
          <input type="checkbox" id="ts-cfg-stripping" ${cfg.isAdStrippingEnabled ? 'checked' : ''} />
        </label>
        <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
          <span>Full Reload on Stall</span>
          <input type="checkbox" id="ts-cfg-reload" ${cfg.playerBufferingDoPlayerReload ? 'checked' : ''} />
        </label>
      </div>
      <div style="font-size: 11px; color: #adadb8; border-top: 1px solid #2e2e35; padding-top: 8px; margin-bottom: 10px;">
        <div>GQL Hash: <code>${gql.getPlaybackAccessTokenHash().substring(0, 10)}...</code></div>
        <div>Blocked in session: <b>${this.adsBlockedCount}</b></div>
      </div>
      <button id="ts-force-reload-btn" style="
        width: 100%;
        background: #9146FF;
        color: white;
        border: none;
        border-radius: 4px;
        padding: 6px;
        font-weight: 600;
        cursor: pointer;
      ">🔄 Force Reload Stream</button>
    `;

    parent.appendChild(modal);
    this.settingsModal = modal;

    modal.querySelector('#ts-close-btn')?.addEventListener('click', () => {
      modal.remove();
      this.settingsModal = null;
    });

    modal.querySelector('#ts-cfg-buffering')?.addEventListener('change', (e) => {
      saveUserConfig({ playerBufferingFix: (e.target as HTMLInputElement).checked });
    });

    modal.querySelector('#ts-cfg-stripping')?.addEventListener('change', (e) => {
      saveUserConfig({ isAdStrippingEnabled: (e.target as HTMLInputElement).checked });
    });

    modal.querySelector('#ts-cfg-reload')?.addEventListener('change', (e) => {
      saveUserConfig({ playerBufferingDoPlayerReload: (e.target as HTMLInputElement).checked });
    });

    modal.querySelector('#ts-force-reload-btn')?.addEventListener('click', () => {
      reloadPlayer();
    });
  }
}
