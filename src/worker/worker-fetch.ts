import { HLSSynchronizer, SILENT_MP4_BASE64 } from '../hls/synchronizer';
import { parseAttributes } from '../hls/parser';
import { StreamChannelInfo, StreamResolutionInfo } from '../types';

export class WorkerFetchHook {
  private synchronizer = new HLSSynchronizer();
  private streamInfos: Record<string, StreamChannelInfo> = {};
  private streamInfosByUrl: Record<string, StreamChannelInfo> = {};
  private pendingFetchRequests = new Map<string, { resolve: (res: Response) => void; reject: (err: any) => void }>();

  public clientId = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  public gqlDeviceId = '';
  public authorizationHeader: string | undefined = undefined;
  public clientIntegrityHeader: string | null = null;
  public clientVersion: string | null = null;
  public clientSession: string | null = null;
  public backupPlayerTypes = ['embed', 'popout', 'autoplay'];
  public fallbackPlayerType = 'embed';
  public isAdStrippingEnabled = true;

  constructor() {
    this.initMessageHandler();
  }

  private initMessageHandler(): void {
    self.addEventListener('message', (e: MessageEvent) => {
      const data = e.data;
      if (!data) return;

      switch (data.key) {
        case 'UpdateClientVersion':
          this.clientVersion = data.value;
          break;
        case 'UpdateClientSession':
          this.clientSession = data.value;
          break;
        case 'UpdateClientId':
          this.clientId = data.value;
          break;
        case 'UpdateDeviceId':
          this.gqlDeviceId = data.value;
          break;
        case 'UpdateClientIntegrityHeader':
          this.clientIntegrityHeader = data.value;
          break;
        case 'UpdateAuthorizationHeader':
          this.authorizationHeader = data.value;
          break;
        case 'FetchResponse': {
          const resp = data.value;
          if (this.pendingFetchRequests.has(resp.id)) {
            const { resolve, reject } = this.pendingFetchRequests.get(resp.id)!;
            this.pendingFetchRequests.delete(resp.id);
            if (resp.error) {
              reject(new Error(resp.error));
            } else {
              resolve(new Response(resp.body, {
                status: resp.status,
                statusText: resp.statusText,
                headers: resp.headers
              }));
            }
          }
          break;
        }
      }
    });
  }

  public hookFetch(): void {
    const realFetch = self.fetch;

    self.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      // Serve silent MP4 dummy for stripped ad segments
      if (this.synchronizer.isAdSegment(urlStr)) {
        return realFetch(SILENT_MP4_BASE64, init);
      }

      const cleanUrl = urlStr.trimEnd();

      // Intercept media playlists
      if (cleanUrl.endsWith('.m3u8')) {
        const resp = await realFetch(input, init);
        if (resp.status === 200) {
          const originalText = await resp.text();
          const processedText = await this.processM3U8(cleanUrl, originalText, realFetch);
          return new Response(processedText, {
            status: resp.status,
            statusText: resp.statusText,
            headers: resp.headers
          });
        }
        return resp;
      }

      // Intercept master playlist (channel encodings)
      if (cleanUrl.includes('/channel/hls/') && !cleanUrl.includes('picture-by-picture')) {
        const match = cleanUrl.match(/\/channel\/hls\/([^/.]+)/);
        const channelName = match ? match[1] : null;

        const resp = await realFetch(input, init);
        if (resp.status === 200 && channelName) {
          const encodingsText = await resp.text();
          this.parseMasterPlaylist(channelName, cleanUrl, encodingsText);
          return new Response(encodingsText, {
            status: resp.status,
            statusText: resp.statusText,
            headers: resp.headers
          });
        }
        return resp;
      }

      return realFetch(input, init);
    };
  }

  private parseMasterPlaylist(channelName: string, masterUrl: string, encodingsM3U8: string): void {
    const streamInfo: StreamChannelInfo = {
      ChannelName: channelName,
      IsShowingAd: false,
      LastPlayerReload: Date.now(),
      EncodingsM3U8: encodingsM3U8,
      ModifiedM3U8: null,
      IsUsingModifiedM3U8: false,
      UsherParams: new URL(masterUrl).search,
      RequestedAds: new Set(),
      Urls: {},
      ResolutionList: [],
      BackupEncodingsM3U8Cache: {},
      ActiveBackupPlayerType: null,
      IsMidroll: false,
      IsStrippingAdSegments: false,
      NumStrippedAdSegments: 0
    };

    const lines = encodingsM3U8.replaceAll('\r', '').split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1].includes('.m3u8')) {
        const attrs = parseAttributes(lines[i]);
        const res = String(attrs['RESOLUTION'] || '');
        if (res) {
          const info: StreamResolutionInfo = {
            Resolution: res,
            FrameRate: attrs['FRAME-RATE'],
            Codecs: String(attrs['CODECS'] || ''),
            Url: lines[i + 1]
          };
          streamInfo.Urls[lines[i + 1]] = info;
          streamInfo.ResolutionList.push(info);
          this.streamInfosByUrl[lines[i + 1]] = streamInfo;
        }
      }
    }

    this.streamInfos[channelName] = streamInfo;
  }

  private async processM3U8(
    url: string,
    rawText: string,
    realFetch: typeof fetch
  ): Promise<string> {
    const streamInfo = this.streamInfosByUrl[url];
    if (!streamInfo) return rawText;

    const hasAds = this.synchronizer.hasAds(rawText);

    if (hasAds) {
      streamInfo.IsMidroll = rawText.includes('"MIDROLL"') || rawText.includes('"midroll"');
      if (!streamInfo.IsShowingAd) {
        streamInfo.IsShowingAd = true;
      }

      const currentRes = streamInfo.Urls[url];
      let backupM3U8: string | null = null;
      let usedBackupType: string | null = null;

      // Try backup player types
      for (const pType of this.backupPlayerTypes) {
        try {
          const encodings = await this.getBackupEncodings(streamInfo, pType, realFetch);
          if (encodings && currentRes) {
            const targetUrl = this.getStreamUrlForResolution(encodings, currentRes);
            if (targetUrl) {
              const resp = await realFetch(targetUrl);
              if (resp.status === 200) {
                const text = await resp.text();
                if (text && !this.synchronizer.hasAds(text)) {
                  backupM3U8 = text;
                  usedBackupType = pType;
                  break;
                }
              }
            }
          }
        } catch {}
      }

      if (backupM3U8 && usedBackupType) {
        streamInfo.ActiveBackupPlayerType = usedBackupType;
        self.postMessage({
          key: 'UpdateAdBlockBanner',
          hasAds: true,
          isMidroll: streamInfo.IsMidroll,
          isStrippingAdSegments: false,
          backupType: usedBackupType
        });
        return this.synchronizer.alignBackupPlaylist(backupM3U8, usedBackupType);
      }

      // Fallback: Strip ads
      if (this.isAdStrippingEnabled) {
        const { cleanedText, strippedCount } = this.synchronizer.stripAdsFromPlaylist(rawText);
        streamInfo.IsStrippingAdSegments = true;
        streamInfo.NumStrippedAdSegments += strippedCount;

        self.postMessage({
          key: 'UpdateAdBlockBanner',
          hasAds: true,
          isMidroll: streamInfo.IsMidroll,
          isStrippingAdSegments: true,
          numStrippedAdSegments: streamInfo.NumStrippedAdSegments
        });
        return cleanedText;
      }
    } else if (streamInfo.IsShowingAd) {
      streamInfo.IsShowingAd = false;
      streamInfo.IsStrippingAdSegments = false;
      streamInfo.ActiveBackupPlayerType = null;
      this.synchronizer.resetStreamType();

      self.postMessage({
        key: 'UpdateAdBlockBanner',
        hasAds: false
      });
      self.postMessage({ key: 'PauseResumePlayer' });
    }

    return rawText;
  }

  private async getBackupEncodings(
    info: StreamChannelInfo,
    playerType: string,
    realFetch: typeof fetch
  ): Promise<string | null> {
    if (info.BackupEncodingsM3U8Cache[playerType]) {
      return info.BackupEncodingsM3U8Cache[playerType];
    }

    const token = await this.requestAccessToken(info.ChannelName, playerType);
    if (!token) return null;

    const usherUrl = new URL(
      `https://usher.ttvnw.net/api/channel/hls/${info.ChannelName}.m3u8${info.UsherParams}`
    );
    usherUrl.searchParams.set('sig', token.sig);
    usherUrl.searchParams.set('token', token.token);

    const resp = await realFetch(usherUrl.href);
    if (resp.status === 200) {
      const text = await resp.text();
      info.BackupEncodingsM3U8Cache[playerType] = text;
      return text;
    }
    return null;
  }

  private requestAccessToken(
    channelName: string,
    playerType: string
  ): Promise<{ sig: string; token: string } | null> {
    return new Promise((resolve) => {
      const reqId = Math.random().toString(36).substring(2, 15);
      const payload = {
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
            sha256Hash: 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9'
          }
        }
      };

      const headers: Record<string, string> = {
        'Client-ID': this.clientId,
        'X-Device-Id': this.gqlDeviceId
      };
      if (this.authorizationHeader) headers['Authorization'] = this.authorizationHeader;
      if (this.clientIntegrityHeader) headers['Client-Integrity'] = this.clientIntegrityHeader;
      if (this.clientVersion) headers['Client-Version'] = this.clientVersion;
      if (this.clientSession) headers['Client-Session-Id'] = this.clientSession;

      this.pendingFetchRequests.set(reqId, {
        resolve: async (res: Response) => {
          try {
            const data = await res.json();
            const tokenData = data?.data?.streamPlaybackAccessToken;
            if (tokenData?.signature && tokenData?.value) {
              resolve({ sig: tokenData.signature, token: tokenData.value });
              return;
            }
          } catch {}
          resolve(null);
        },
        reject: () => resolve(null)
      });

      self.postMessage({
        key: 'FetchRequest',
        value: {
          id: reqId,
          url: 'https://gql.twitch.tv/gql',
          options: {
            method: 'POST',
            body: JSON.stringify(payload),
            headers
          }
        }
      });
    });
  }

  private getStreamUrlForResolution(
    encodingsM3U8: string,
    currentRes: StreamResolutionInfo
  ): string | null {
    const lines = encodingsM3U8.replaceAll('\r', '').split('\n');
    let matchedUrl: string | null = null;
    let closestUrl: string | null = null;
    let minDiff = Infinity;

    const [curW, curH] = currentRes.Resolution.split('x').map(Number);

    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1].includes('.m3u8')) {
        const attrs = parseAttributes(lines[i]);
        const resStr = String(attrs['RESOLUTION'] || '');
        if (resStr) {
          if (resStr === currentRes.Resolution) {
            matchedUrl = lines[i + 1];
            break;
          }
          const [w, h] = resStr.split('x').map(Number);
          const diff = Math.abs(w * h - curW * curH);
          if (diff < minDiff) {
            minDiff = diff;
            closestUrl = lines[i + 1];
          }
        }
      }
    }
    return matchedUrl || closestUrl;
  }
}
