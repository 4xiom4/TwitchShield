import { getTranslations, SupportedLanguage } from '../i18n';
import { loadUserConfig, saveUserConfig, getCachedGQLHash, setCachedGQLHash } from '../config';

export function runTwitchShield() {
  'use strict';

  const ourTwitchShieldVersion = 38;
  const win = window as any;

  if (typeof win.twitchShieldVersion !== 'undefined' && win.twitchShieldVersion >= ourTwitchShieldVersion) {
    console.log("[TwitchShield] Ya está activo v" + win.twitchShieldVersion);
    return;
  }
  win.twitchShieldVersion = ourTwitchShieldVersion;

  const userConfig = loadUserConfig();
  let currentLang: SupportedLanguage = userConfig.language || 'es';
  let isSilentMode = userConfig.silentMode ?? true;
  let t = getTranslations(currentLang);

  function declareOptions(scope: any) {
    scope.AdSignifier = 'stitched';
    scope.ClientID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
    scope.BackupPlayerTypes = ['embed', 'popout', 'autoplay'];
    scope.FallbackPlayerType = 'embed';
    scope.ForceAccessTokenPlayerType = 'popout';
    scope.SkipPlayerReloadOnHevc = false;
    scope.AlwaysReloadPlayerOnAd = false;
    scope.ReloadPlayerAfterAd = true;
    scope.PlayerReloadMinimalRequestsTime = 1500;
    scope.PlayerReloadMinimalRequestsPlayerIndex = 2; // autoplay
    scope.HasTriggeredPlayerReload = false;
    scope.StreamInfos = [];
    scope.StreamInfosByUrl = [];
    scope.GQLDeviceID = null;
    scope.ClientVersion = null;
    scope.ClientSession = null;
    scope.ClientIntegrityHeader = null;
    scope.AuthorizationHeader = undefined;
    scope.GQLPlaybackAccessTokenHash = getCachedGQLHash() || 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';
    scope.SimulatedAdsDepth = 0;
    scope.PlayerBufferingFix = userConfig.playerBufferingFix ?? true;
    scope.PlayerBufferingDelay = 600;
    scope.PlayerBufferingSameStateCount = 3;
    scope.PlayerBufferingDangerZone = 1;
    scope.PlayerBufferingDoPlayerReload = false;
    scope.PlayerBufferingMinRepeatDelay = 8000;
    scope.PlayerBufferingPrerollCheckEnabled = false;
    scope.PlayerBufferingPrerollCheckOffset = 5;
    scope.V2API = false;
    scope.IsAdStrippingEnabled = userConfig.isAdStrippingEnabled ?? true;
    scope.AdSegmentCache = new Map();
    scope.AllSegmentsAreAdSegments = false;
    scope.SilentMode = isSilentMode;
  }

  let isActivelyStrippingAds = false;
  let localStorageHookFailed = false;
  const twitchWorkers: any[] = [];
  const workerStringConflicts = ['twitch', 'isVariantA'];
  const workerStringAllow: string[] = [];
  const workerStringReinsert = ['isVariantA', 'besuper/', '${patch_url}'];

  function getCleanWorker(worker: any) {
    let root = null;
    let parent = null;
    let proto = worker;
    while (proto) {
      const workerString = proto.toString();
      if (workerStringConflicts.some((x) => workerString.includes(x)) && !workerStringAllow.some((x) => workerString.includes(x))) {
        if (parent !== null) {
          Object.setPrototypeOf(parent, Object.getPrototypeOf(proto));
        }
      } else {
        if (root === null) {
          root = proto;
        }
        parent = proto;
      }
      proto = Object.getPrototypeOf(proto);
    }
    return root;
  }

  function getWorkersForReinsert(worker: any) {
    const result: any[] = [];
    let proto = worker;
    while (proto) {
      const workerString = proto.toString();
      if (workerStringReinsert.some((x) => workerString.includes(x))) {
        result.push(proto);
      }
      proto = Object.getPrototypeOf(proto);
    }
    return result;
  }

  function reinsertWorkers(worker: any, reinsert: any[]) {
    let parent = worker;
    for (let i = 0; i < reinsert.length; i++) {
      Object.setPrototypeOf(reinsert[i], parent);
      parent = reinsert[i];
    }
    return parent;
  }

  function isValidWorker(worker: any) {
    const workerString = worker.toString();
    return !workerStringConflicts.some((x) => workerString.includes(x))
      || workerStringAllow.some((x) => workerString.includes(x))
      || workerStringReinsert.some((x) => workerString.includes(x));
  }

  function getWasmWorkerJs(twitchBlobUrl: string) {
    const req = new XMLHttpRequest();
    req.open('GET', twitchBlobUrl, false);
    req.overrideMimeType('text/javascript');
    req.send();
    return req.responseText;
  }

  function stripAdSegments(textStr: string, stripAllSegments: boolean, streamInfo: any) {
    let hasStrippedAdSegments = false;
    const lines = textStr.replaceAll('\r', '').split('\n');
    const newAdUrl = 'https://twitch.tv';
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      line = line
        .replaceAll(/(X-TV-TWITCH-AD-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`)
        .replaceAll(/(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`);
      if (i < lines.length - 1 && line.startsWith('#EXTINF') && (!line.includes(',live') || stripAllSegments || (self as any).AllSegmentsAreAdSegments)) {
        const segmentUrl = lines[i + 1];
        if (!(self as any).AdSegmentCache.has(segmentUrl)) {
          streamInfo.NumStrippedAdSegments++;
        }
        (self as any).AdSegmentCache.set(segmentUrl, Date.now());
        hasStrippedAdSegments = true;
      }
      if (line.includes((self as any).AdSignifier)) {
        hasStrippedAdSegments = true;
      }
    }
    if (hasStrippedAdSegments) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('#EXT-X-TWITCH-PREFETCH:')) {
          lines[i] = '';
        }
      }
    } else {
      streamInfo.NumStrippedAdSegments = 0;
    }
    streamInfo.IsStrippingAdSegments = hasStrippedAdSegments;
    (self as any).AdSegmentCache.forEach((value: number, key: string, map: Map<string, number>) => {
      if (value < Date.now() - 120000) {
        map.delete(key);
      }
    });
    return lines.join('\n');
  }

  function parseAttributes(str: string) {
    return Object.fromEntries(
      str.split(/(?:^|,)((?:[^=]*)=(?:"[^"]*"|[^,]*))/)
      .filter(Boolean)
      .map(x => {
        const idx = x.indexOf('=');
        const key = x.substring(0, idx);
        const value = x.substring(idx + 1);
        const num = Number(value);
        return [key, Number.isNaN(num) ? value.startsWith('"') ? JSON.parse(value) : value : num];
      })
    );
  }

  function getStreamUrlForResolution(encodingsM3u8: string, resolutionInfo: any) {
    const encodingsLines = encodingsM3u8.replaceAll('\r', '').split('\n');
    const [targetWidth, targetHeight] = resolutionInfo.Resolution.split('x').map(Number);
    let matchedResolutionUrl: string | null = null;
    let matchedFrameRate = false;
    let closestResolutionUrl: string | null = null;
    let closestResolutionDifference = Infinity;
    for (let i = 0; i < encodingsLines.length - 1; i++) {
      if (encodingsLines[i].startsWith('#EXT-X-STREAM-INF') && encodingsLines[i + 1].includes('.m3u8')) {
        const attributes = parseAttributes(encodingsLines[i]);
        const resolution = attributes['RESOLUTION'];
        const frameRate = attributes['FRAME-RATE'];
        if (resolution) {
          if (resolution == resolutionInfo.Resolution && (!matchedResolutionUrl || (!matchedFrameRate && frameRate == resolutionInfo.FrameRate))) {
            matchedResolutionUrl = encodingsLines[i + 1];
            matchedFrameRate = frameRate == resolutionInfo.FrameRate;
            if (matchedFrameRate) {
              return matchedResolutionUrl;
            }
          }
          const [width, height] = (resolution as string).split('x').map(Number);
          const difference = Math.abs((width * height) - (targetWidth * targetHeight));
          if (difference < closestResolutionDifference) {
            closestResolutionUrl = encodingsLines[i + 1];
            closestResolutionDifference = difference;
          }
        }
      }
    }
    return closestResolutionUrl;
  }

  function getServerTimeFromM3u8(encodingsM3u8: string) {
    if ((self as any).V2API) {
      const matches = encodingsM3u8.match(/#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="([^"]+)"/);
      return matches && matches.length > 1 ? matches[1] : null;
    }
    const matches = encodingsM3u8.match('SERVER-TIME="([0-9.]+)"');
    return matches && matches.length > 1 ? matches[1] : null;
  }

  function replaceServerTimeInM3u8(encodingsM3u8: string, newServerTime: string | null) {
    if ((self as any).V2API) {
      return newServerTime ? encodingsM3u8.replace(/(#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE=")[^"]+(")/, `$1${newServerTime}$2`) : encodingsM3u8;
    }
    return newServerTime ? encodingsM3u8.replace(new RegExp('(SERVER-TIME=")[0-9.]+"'), `SERVER-TIME="${newServerTime}"`) : encodingsM3u8;
  }

  function getAccessToken(channelName: string, playerType: string) {
    const s = self as any;
    const body = {
      operationName: 'PlaybackAccessToken',
      variables: {
        isLive: true,
        login: channelName,
        isVod: false,
        vodID: "",
        playerType: playerType,
        platform: playerType == 'autoplay' ? 'android' : 'web'
      },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: s.GQLPlaybackAccessTokenHash || "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9"
        }
      }
    };
    return (self as any).gqlRequest(body, playerType);
  }

  function gqlRequest(body: any, playerType: string) {
    const s = self as any;
    if (!s.GQLDeviceID) {
      s.GQLDeviceID = '';
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      for (let i = 0; i < 32; i++) {
        s.GQLDeviceID += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    }
    let headers: Record<string, any> = {
      'Client-ID': s.ClientID,
      'X-Device-Id': s.GQLDeviceID,
      'Authorization': s.AuthorizationHeader,
      ...(s.ClientIntegrityHeader && { 'Client-Integrity': s.ClientIntegrityHeader }),
      ...(s.ClientVersion && { 'Client-Version': s.ClientVersion }),
      ...(s.ClientSession && { 'Client-Session-Id': s.ClientSession })
    };
    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).substring(2, 15);
      const fetchRequest = {
        id: requestId,
        url: 'https://gql.twitch.tv/gql',
        options: {
          method: 'POST',
          body: JSON.stringify(body),
          headers
        }
      };
      s.pendingFetchRequests.set(requestId, { resolve, reject });
      s.postMessage({
        key: 'FetchRequest',
        value: fetchRequest
      });
    });
  }

  async function processM3U8(url: string, textStr: string, realFetch: any) {
    const s = self as any;
    const streamInfo = s.StreamInfosByUrl[url];
    if (!streamInfo) return textStr;

    if (s.HasTriggeredPlayerReload) {
      s.HasTriggeredPlayerReload = false;
      streamInfo.LastPlayerReload = Date.now();
    }

    const haveAdTags = textStr.includes(s.AdSignifier) || s.SimulatedAdsDepth > 0;
    if (haveAdTags) {
      streamInfo.IsMidroll = textStr.includes('"MIDROLL"') || textStr.includes('"midroll"');
      if (!streamInfo.IsShowingAd) {
        streamInfo.IsShowingAd = true;
        s.postMessage({
          key: 'UpdateAdBlockBanner',
          isMidroll: streamInfo.IsMidroll,
          hasAds: streamInfo.IsShowingAd,
          isStrippingAdSegments: false
        });
      }
      if (!streamInfo.IsMidroll) {
        const lines = textStr.replaceAll('\r', '').split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.startsWith('#EXTINF') && lines.length > i + 1) {
            if (!line.includes(',live') && !streamInfo.RequestedAds.has(lines[i + 1])) {
              streamInfo.RequestedAds.add(lines[i + 1]);
              fetch(lines[i + 1]).then((res) => { res.blob(); });
              break;
            }
          }
        }
      }
      const currentResolution = streamInfo.Urls[url];
      if (!currentResolution) return textStr;

      const isHevc = currentResolution.Codecs.startsWith('hev') || currentResolution.Codecs.startsWith('hvc');
      if (((isHevc && !s.SkipPlayerReloadOnHevc) || s.AlwaysReloadPlayerOnAd) && streamInfo.ModifiedM3U8 && !streamInfo.IsUsingModifiedM3U8) {
        streamInfo.IsUsingModifiedM3U8 = true;
        streamInfo.LastPlayerReload = Date.now();
        s.postMessage({ key: 'ReloadPlayer' });
      }

      let backupPlayerType = null;
      let backupM3u8 = null;
      let fallbackM3u8 = null;
      let startIndex = 0;
      let isDoingMinimalRequests = false;
      if (streamInfo.LastPlayerReload > Date.now() - s.PlayerReloadMinimalRequestsTime) {
        startIndex = s.PlayerReloadMinimalRequestsPlayerIndex;
        isDoingMinimalRequests = true;
      }

      for (let playerTypeIndex = startIndex; !backupM3u8 && playerTypeIndex < s.BackupPlayerTypes.length; playerTypeIndex++) {
        const playerType = s.BackupPlayerTypes[playerTypeIndex];
        const realPlayerType = playerType.replace('-CACHED', '');
        const isFullyCachedPlayerType = playerType != realPlayerType;
        for (let i = 0; i < 2; i++) {
          let isFreshM3u8 = false;
          let encodingsM3u8 = streamInfo.BackupEncodingsM3U8Cache[playerType];
          if (!encodingsM3u8) {
            isFreshM3u8 = true;
            try {
              const accessTokenResponse: any = await getAccessToken(streamInfo.ChannelName, realPlayerType);
              if (accessTokenResponse.status === 200) {
                const accessToken = await accessTokenResponse.json();
                const urlInfo = new URL('https://usher.ttvnw.net/api/' + (s.V2API ? 'v2/' : '') + 'channel/hls/' + streamInfo.ChannelName + '.m3u8' + streamInfo.UsherParams);
                urlInfo.searchParams.set('sig', accessToken.data.streamPlaybackAccessToken.signature);
                urlInfo.searchParams.set('token', accessToken.data.streamPlaybackAccessToken.value);
                const encodingsM3u8Response = await realFetch(urlInfo.href);
                if (encodingsM3u8Response.status === 200) {
                  encodingsM3u8 = streamInfo.BackupEncodingsM3U8Cache[playerType] = await encodingsM3u8Response.text();
                }
              }
            } catch (err) {}
          }
          if (encodingsM3u8) {
            try {
              const streamM3u8Url = getStreamUrlForResolution(encodingsM3u8, currentResolution);
              const streamM3u8Response = await realFetch(streamM3u8Url);
              if (streamM3u8Response.status == 200) {
                const m3u8Text = await streamM3u8Response.text();
                if (m3u8Text) {
                  if (playerType == s.FallbackPlayerType) fallbackM3u8 = m3u8Text;
                  if ((!m3u8Text.includes(s.AdSignifier) && (s.SimulatedAdsDepth == 0 || playerTypeIndex >= s.SimulatedAdsDepth - 1)) || (!fallbackM3u8 && playerTypeIndex >= s.BackupPlayerTypes.length - 1)) {
                    backupPlayerType = playerType;
                    backupM3u8 = m3u8Text;
                    break;
                  }
                  if (isFullyCachedPlayerType || isDoingMinimalRequests) {
                    backupPlayerType = playerType;
                    backupM3u8 = m3u8Text;
                    break;
                  }
                }
              }
            } catch (err) {}
          }
          streamInfo.BackupEncodingsM3U8Cache[playerType] = null;
          if (isFreshM3u8) break;
        }
      }

      if (!backupM3u8 && fallbackM3u8) {
        backupPlayerType = s.FallbackPlayerType;
        backupM3u8 = fallbackM3u8;
      }
      if (backupM3u8) {
        textStr = backupM3u8;
        if (streamInfo.ActiveBackupPlayerType != backupPlayerType) {
          streamInfo.ActiveBackupPlayerType = backupPlayerType;
          console.log(`[TwitchShield] Bloqueando anuncios (${backupPlayerType})`);
        }
      }

      const stripHevc = isHevc && streamInfo.ModifiedM3U8;
      if (s.IsAdStrippingEnabled || stripHevc) {
        textStr = stripAdSegments(textStr, stripHevc, streamInfo);
      }
    } else if (streamInfo.IsShowingAd) {
      console.log('[TwitchShield] Finalizado bloqueo de anuncios');
      streamInfo.IsShowingAd = false;
      streamInfo.IsStrippingAdSegments = false;
      streamInfo.NumStrippedAdSegments = 0;
      streamInfo.ActiveBackupPlayerType = null;
      if (streamInfo.IsUsingModifiedM3U8 || s.ReloadPlayerAfterAd) {
        streamInfo.IsUsingModifiedM3U8 = false;
        streamInfo.LastPlayerReload = Date.now();
        s.postMessage({ key: 'ReloadPlayer' });
      } else {
        s.postMessage({ key: 'PauseResumePlayer' });
      }
    }

    s.postMessage({
      key: 'UpdateAdBlockBanner',
      isMidroll: streamInfo.IsMidroll,
      hasAds: streamInfo.IsShowingAd,
      isStrippingAdSegments: streamInfo.IsStrippingAdSegments,
      numStrippedAdSegments: streamInfo.NumStrippedAdSegments
    });
    return textStr;
  }

  function hookWorkerFetch() {
    const s = self as any;
    console.log('[TwitchShield] hookWorkerFetch inicializado');
    const realFetch = fetch;
    (self as any).fetch = async function(url: any, options: any) {
      if (typeof url === 'string') {
        if (s.AdSegmentCache && s.AdSegmentCache.has(url)) {
          return new Promise(function(resolve, reject) {
            realFetch('data:video/mp4;base64,AAAAKGZ0eXBtcDQyAAAAAWlzb21tcDQyZGFzaGF2YzFpc282aGxzZgAABEltb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAYagAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAABqHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAURtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAALuAAAAAAFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAADvbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAACzc3RibAAAAGdzdHNkAAAAAAAAAAEAAABXbXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAALuAAAAAAAAzZXNkcwAAAAADgICAIgABAASAgIAUQBUAAAAAAAAAAAAAAAWAgIACEZAGgICAAQIAAAAQc3R0cwAAAAAAAAAAAAAAEHN0c2MAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAeV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAoAAAAFoAAAAAAGBbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAA9CQAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABLG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAOxzdGJsAAAAoHN0c2QAAAAAAAAAAQAAAJBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAoABaABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAOmF2Y0MBTUAe/+EAI2dNQB6WUoFAX/LgLUBAQFAAAD6AAA6mDgAAHoQAA9CW7y4KAQAEaOuPIAAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAAAAAQc3RjbwAAAAAAAAAAAAAASG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAC4AAAAAAoAAAAAAACB0cmV4AAAAAAAAAAIAAAABAACCNQAAAAACQAAA', options)
              .then(res => resolve(res))
              .catch(err => reject(err));
          });
        }
        url = url.trimEnd();
        if (url.endsWith('m3u8')) {
          return new Promise(function(resolve, reject) {
            const processAfter = async function(response: Response) {
              if (response.status === 200) {
                resolve(new Response(await processM3U8(url, await response.text(), realFetch)));
              } else {
                resolve(response);
              }
            };
            realFetch(url, options)
              .then(res => processAfter(res))
              .catch(err => reject(err));
          });
        } else if (url.includes('/channel/hls/') && !url.includes('picture-by-picture')) {
          s.V2API = url.includes('/api/v2/');
          const channelNameMatch = (new URL(url)).pathname.match(/([^\/]+)(?=\.\w+$)/);
          const channelName = channelNameMatch ? channelNameMatch[0] : '';
          if (s.ForceAccessTokenPlayerType) {
            const tempUrl = new URL(url);
            tempUrl.searchParams.delete('parent_domains');
            url = tempUrl.toString();
          }
          return new Promise(function(resolve, reject) {
            const processAfter = async function(response: Response) {
              if (response.status == 200) {
                const encodingsM3u8 = await response.text();
                const serverTime = getServerTimeFromM3u8(encodingsM3u8);
                let streamInfo = s.StreamInfos[channelName];
                if (streamInfo != null && streamInfo.EncodingsM3U8 != null && (await realFetch(streamInfo.EncodingsM3U8.match(/^https:.*\.m3u8$/m)[0])).status !== 200) {
                  streamInfo = null;
                }
                if (streamInfo == null || streamInfo.EncodingsM3U8 == null) {
                  s.StreamInfos[channelName] = streamInfo = {
                    ChannelName: channelName,
                    IsShowingAd: false,
                    LastPlayerReload: 0,
                    EncodingsM3U8: encodingsM3u8,
                    ModifiedM3U8: null,
                    IsUsingModifiedM3U8: false,
                    UsherParams: (new URL(url)).search,
                    RequestedAds: new Set(),
                    Urls: [],
                    ResolutionList: [],
                    BackupEncodingsM3U8Cache: [],
                    ActiveBackupPlayerType: null,
                    IsMidroll: false,
                    IsStrippingAdSegments: false,
                    NumStrippedAdSegments: 0
                  };
                  const lines = encodingsM3u8.replaceAll('\r', '').split('\n');
                  for (let i = 0; i < lines.length - 1; i++) {
                    if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1].includes('.m3u8')) {
                      const attributes = parseAttributes(lines[i]);
                      const resolution = attributes['RESOLUTION'];
                      if (resolution) {
                        const resolutionInfo = {
                          Resolution: resolution,
                          FrameRate: attributes['FRAME-RATE'],
                          Codecs: attributes['CODECS'],
                          Url: lines[i + 1]
                        };
                        streamInfo.Urls[lines[i + 1]] = resolutionInfo;
                        streamInfo.ResolutionList.push(resolutionInfo);
                      }
                      s.StreamInfosByUrl[lines[i + 1]] = streamInfo;
                    }
                  }
                }
                streamInfo.LastPlayerReload = Date.now();
                resolve(new Response(replaceServerTimeInM3u8(streamInfo.IsUsingModifiedM3U8 ? streamInfo.ModifiedM3U8 : streamInfo.EncodingsM3U8, serverTime)));
              } else {
                resolve(response);
              }
            };
            realFetch(url, options)
              .then(res => processAfter(res))
              .catch(err => reject(err));
          });
        }
      }
      return realFetch.apply(this, arguments as any);
    };
  }

  function hookWindowWorker() {
    const reinsert = getWorkersForReinsert(window.Worker);
    const newWorker = class Worker extends (getCleanWorker(window.Worker) as any) {
      constructor(twitchBlobUrl: any, options: any) {
        let isTwitchWorker = false;
        try {
          isTwitchWorker = new URL(twitchBlobUrl).origin.endsWith('.twitch.tv');
        } catch {}
        if (!isTwitchWorker) {
          super(twitchBlobUrl, options);
          return;
        }
        const s = self as any;
        const newBlobStr = `
          const pendingFetchRequests = new Map();
          ${stripAdSegments.toString()}
          ${getStreamUrlForResolution.toString()}
          ${processM3U8.toString()}
          ${hookWorkerFetch.toString()}
          ${declareOptions.toString()}
          ${getAccessToken.toString()}
          ${gqlRequest.toString()}
          ${parseAttributes.toString()}
          ${getWasmWorkerJs.toString()}
          ${getServerTimeFromM3u8.toString()}
          ${replaceServerTimeInM3u8.toString()}
          const workerString = getWasmWorkerJs('${twitchBlobUrl.replaceAll("'", "%27")}');
          declareOptions(self);
          GQLDeviceID = ${s.GQLDeviceID ? "'" + s.GQLDeviceID + "'" : null};
          AuthorizationHeader = ${s.AuthorizationHeader ? "'" + s.AuthorizationHeader + "'" : undefined};
          ClientIntegrityHeader = ${s.ClientIntegrityHeader ? "'" + s.ClientIntegrityHeader + "'" : null};
          ClientVersion = ${s.ClientVersion ? "'" + s.ClientVersion + "'" : null};
          ClientSession = ${s.ClientSession ? "'" + s.ClientSession + "'" : null};
          GQLPlaybackAccessTokenHash = ${s.GQLPlaybackAccessTokenHash ? "'" + s.GQLPlaybackAccessTokenHash + "'" : null};
          self.addEventListener('message', function(e) {
            if (e.data.key == 'UpdateClientVersion') {
              ClientVersion = e.data.value;
            } else if (e.data.key == 'UpdateClientSession') {
              ClientSession = e.data.value;
            } else if (e.data.key == 'UpdateClientId') {
              ClientID = e.data.value;
            } else if (e.data.key == 'UpdateDeviceId') {
              GQLDeviceID = e.data.value;
            } else if (e.data.key == 'UpdateClientIntegrityHeader') {
              ClientIntegrityHeader = e.data.value;
            } else if (e.data.key == 'UpdateAuthorizationHeader') {
              AuthorizationHeader = e.data.value;
            } else if (e.data.key == 'UpdateGQLHash') {
              GQLPlaybackAccessTokenHash = e.data.value;
            } else if (e.data.key == 'UpdateSilentMode') {
              SilentMode = e.data.value;
            } else if (e.data.key == 'FetchResponse') {
              const responseData = e.data.value;
              if (pendingFetchRequests.has(responseData.id)) {
                const { resolve, reject } = pendingFetchRequests.get(responseData.id);
                pendingFetchRequests.delete(responseData.id);
                if (responseData.error) {
                  reject(new Error(responseData.error));
                } else {
                  const response = new Response(responseData.body, {
                    status: responseData.status,
                    statusText: responseData.statusText,
                    headers: responseData.headers
                  });
                  resolve(response);
                }
              }
            } else if (e.data.key == 'TriggeredPlayerReload') {
              HasTriggeredPlayerReload = true;
            }
          });
          hookWorkerFetch();
          eval(workerString);
        `;
        super(URL.createObjectURL(new Blob([newBlobStr])), options);
        twitchWorkers.push(this);
        (this as any).addEventListener('message', (e: MessageEvent) => {
          if (e.data.key == 'UpdateAdBlockBanner') {
            updateAdblockBanner(e.data);
          } else if (e.data.key == 'PauseResumePlayer') {
            doTwitchPlayerTask(true, false);
          } else if (e.data.key == 'ReloadPlayer') {
            doTwitchPlayerTask(false, true);
          }
        });
        (this as any).addEventListener('message', async (event: MessageEvent) => {
          if (event.data.key == 'FetchRequest') {
            const fetchRequest = event.data.value;
            const responseData = await handleWorkerFetchRequest(fetchRequest);
            (this as any).postMessage({
              key: 'FetchResponse',
              value: responseData
            });
          }
        });
      }
    };
    let workerInstance = reinsertWorkers(newWorker, reinsert);
    Object.defineProperty(window, 'Worker', {
      get: function() {
        return workerInstance;
      },
      set: function(value) {
        if (isValidWorker(value)) {
          workerInstance = value;
        } else {
          console.log('[TwitchShield] Intento de reasignar worker denegado');
        }
      }
    });
  }

  function updateAdblockBanner(data: any) {
    // Si silentMode está activo, NO mostramos banner en pantalla para no interrumpir
    if (isSilentMode) {
      if (data.hasAds) {
        console.log(`[TwitchShield] ${t.blockingAds} (${data.isMidroll ? 'midroll' : 'preroll'})`);
      }
      return;
    }

    const playerRootDiv = document.querySelector('.video-player');
    if (playerRootDiv != null) {
      let adBlockDiv: any = playerRootDiv.querySelector('.adblock-overlay');
      if (adBlockDiv == null) {
        adBlockDiv = document.createElement('div');
        adBlockDiv.className = 'adblock-overlay';
        adBlockDiv.innerHTML = '<div class="player-adblock-notice" style="color: white; background-color: rgba(24, 24, 27, 0.85); backdrop-filter: blur(4px); border: 1px solid rgba(145, 70, 255, 0.4); border-radius: 4px; position: absolute; top: 12px; left: 12px; padding: 4px 8px; font-size: 11px; z-index: 9999;"><p style="margin: 0;"></p></div>';
        adBlockDiv.style.display = 'none';
        adBlockDiv.P = adBlockDiv.querySelector('p');
        playerRootDiv.appendChild(adBlockDiv);
      }
      if (adBlockDiv != null) {
        isActivelyStrippingAds = data.isStrippingAdSegments;
        let msg = data.isMidroll ? t.blockingMidroll : t.blockingAds;
        if (data.isStrippingAdSegments) msg += ` (${t.strippingAds})`;
        adBlockDiv.P.textContent = `🛡️ ${msg}`;
        adBlockDiv.style.display = data.hasAds ? 'block' : 'none';
      }
    }
  }

  function getPlayerAndState() {
    function findReactNode(root: any, constraint: any): any {
      if (root.stateNode && constraint(root.stateNode)) {
        return root.stateNode;
      }
      let node = root.child;
      while (node) {
        const result = findReactNode(node, constraint);
        if (result) return result;
        node = node.sibling;
      }
      return null;
    }
    function findReactRootNode() {
      let reactRootNode = null;
      const rootNode: any = document.querySelector('#root');
      if (rootNode && rootNode._reactRootContainer && rootNode._reactRootContainer._internalRoot && rootNode._reactRootContainer._internalRoot.current) {
        reactRootNode = rootNode._reactRootContainer._internalRoot.current;
      }
      if (reactRootNode == null && rootNode != null) {
        const containerName = Object.keys(rootNode).find(x => x.startsWith('__reactContainer'));
        if (containerName != null) {
          reactRootNode = rootNode[containerName];
        }
      }
      return reactRootNode;
    }
    const reactRootNode = findReactRootNode();
    if (!reactRootNode) return null;
    let player = findReactNode(reactRootNode, (node: any) => node.setPlayerActive && node.props && node.props.mediaPlayerInstance);
    player = player && player.props && player.props.mediaPlayerInstance ? player.props.mediaPlayerInstance : null;
    if (player?.playerInstance) {
      player = player.playerInstance;
    }
    const playerState = findReactNode(reactRootNode, (node: any) => node.setSrc && node.setInitialPlaybackSettings);
    return { player, state: playerState };
  }

  function doTwitchPlayerTask(isPausePlay: boolean, isReload: boolean) {
    const playerAndState = getPlayerAndState();
    if (!playerAndState || !playerAndState.player) {
      // Fallback a elemento video nativo si React tree no está disponible
      const v = document.querySelector('video');
      if (v) {
        if (isPausePlay) {
          v.pause();
          v.play().catch(() => {});
        }
      }
      return;
    }
    const { player, state: playerState } = playerAndState;
    if (player.isPaused() || player.core?.paused) return;

    if (isPausePlay) {
      player.pause();
      player.play();
      return;
    }
    if (isReload && playerState) {
      console.log('[TwitchShield] Recargando reproductor de Twitch...');
      playerState.setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true });
      postTwitchWorkerMessage('TriggeredPlayerReload', true);
      player.play();
    }
  }

  function postTwitchWorkerMessage(key: string, value?: any) {
    twitchWorkers.forEach((worker) => {
      worker.postMessage({ key, value });
    });
  }

  async function handleWorkerFetchRequest(fetchRequest: any) {
    try {
      const response = await win.realFetch(fetchRequest.url, fetchRequest.options);
      const responseBody = await response.text();
      return {
        id: fetchRequest.id,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody
      };
    } catch (error: any) {
      return {
        id: fetchRequest.id,
        error: error?.message || 'Error de red'
      };
    }
  }

  function hookFetch() {
    const realFetch = window.fetch;
    win.realFetch = realFetch;
    window.fetch = function(url: any, init?: any, ...args: any[]) {
      if (typeof url === 'string') {
        if (url.includes('gql')) {
          const s = (typeof window !== 'undefined' ? window : self) as any;
          let deviceId = init?.headers?.['X-Device-Id'] || init?.headers?.['Device-ID'];
          if (typeof deviceId === 'string' && s.GQLDeviceID != deviceId) {
            s.GQLDeviceID = deviceId;
            postTwitchWorkerMessage('UpdateDeviceId', s.GQLDeviceID);
          }
          if (init?.headers?.['Client-Version'] && init.headers['Client-Version'] !== s.ClientVersion) {
            postTwitchWorkerMessage('UpdateClientVersion', s.ClientVersion = init.headers['Client-Version']);
          }
          if (init?.headers?.['Client-Session-Id'] && init.headers['Client-Session-Id'] !== s.ClientSession) {
            postTwitchWorkerMessage('UpdateClientSession', s.ClientSession = init.headers['Client-Session-Id']);
          }
          if (init?.headers?.['Client-Integrity'] && init.headers['Client-Integrity'] !== s.ClientIntegrityHeader) {
            postTwitchWorkerMessage('UpdateClientIntegrityHeader', s.ClientIntegrityHeader = init.headers['Client-Integrity']);
          }
          if (init?.headers?.['Authorization'] && init.headers['Authorization'] !== s.AuthorizationHeader) {
            postTwitchWorkerMessage('UpdateAuthorizationHeader', s.AuthorizationHeader = init.headers['Authorization']);
          }

          // Extracción dinámica del hash de PlaybackAccessToken
          if (init && typeof init.body === 'string' && init.body.includes('PlaybackAccessToken')) {
            try {
              const bodyJson = JSON.parse(init.body);
              const items = Array.isArray(bodyJson) ? bodyJson : [bodyJson];
              for (const it of items) {
                const foundHash = it?.extensions?.persistedQuery?.sha256Hash;
                if (foundHash && foundHash.length === 64 && foundHash !== s.GQLPlaybackAccessTokenHash) {
                  s.GQLPlaybackAccessTokenHash = foundHash;
                  setCachedGQLHash(foundHash);
                  postTwitchWorkerMessage('UpdateGQLHash', foundHash);
                  console.log('[TwitchShield] Hash dinámico capturado:', foundHash);
                }
              }
            } catch {}

            // Reemplazo de playerType por 'popout' para evitar prerolls
            const targetPlayerType = s.ForceAccessTokenPlayerType || 'popout';
            if (targetPlayerType) {
              let replacedPlayerType = '';
              try {
                const newBody = JSON.parse(init.body);
                if (Array.isArray(newBody)) {
                  for (let i = 0; i < newBody.length; i++) {
                    if (newBody[i]?.variables?.playerType && newBody[i]?.variables?.playerType !== targetPlayerType) {
                      replacedPlayerType = newBody[i].variables.playerType;
                      newBody[i].variables.playerType = targetPlayerType;
                    }
                  }
                } else {
                  if (newBody?.variables?.playerType && newBody?.variables?.playerType !== targetPlayerType) {
                    replacedPlayerType = newBody.variables.playerType;
                    newBody.variables.playerType = targetPlayerType;
                  }
                }
                if (replacedPlayerType) {
                  console.log(`[TwitchShield] Reemplazado '${replacedPlayerType}' por '${targetPlayerType}'`);
                  init.body = JSON.stringify(newBody);
                }
              } catch {}
            }
          }
        }
      }
      return (win.realFetch || realFetch).apply(this, [url, init, ...args] as any);
    };
  }

  function onContentLoaded() {
    try {
      Object.defineProperty(document, 'visibilityState', {
        get() { return 'visible'; }
      });
    } catch {}
    try {
      Object.defineProperty(document, 'hidden', {
        get() { return false; }
      });
    } catch {}

    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    const visibilityChange = () => {
      const videos = document.getElementsByTagName('video');
      if (videos.length > 0 && videos[0].paused && !videos[0].ended && videos[0].muted) {
        videos[0].play().catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', visibilityChange, true);
    document.addEventListener('webkitvisibilitychange', visibilityChange, true);
    document.addEventListener('mozvisibilitychange', visibilityChange, true);
    document.addEventListener('hasFocus', block, true);
  }

  // API global en consola para personalización y control del usuario
  win.TwitchShield = {
    version: ourTwitchShieldVersion,
    reloadStream: () => doTwitchPlayerTask(false, true),
    setSilentMode: (silent: boolean) => {
      isSilentMode = silent;
      (self as any).SilentMode = silent;
      saveUserConfig({ silentMode: silent });
      postTwitchWorkerMessage('UpdateSilentMode', silent);
      console.log(`[TwitchShield] Modo silencioso: ${silent ? 'ACTIVADO' : 'DESACTIVADO'}`);
    },
    setLanguage: (lang: SupportedLanguage) => {
      if (lang === 'es' || lang === 'en') {
        currentLang = lang;
        t = getTranslations(lang);
        saveUserConfig({ language: lang });
        console.log(`[TwitchShield] Idioma cambiado a: ${lang.toUpperCase()}`);
      }
    },
    status: () => ({
      version: ourTwitchShieldVersion,
      silentMode: isSilentMode,
      language: currentLang,
      capturedHash: (self as any).GQLPlaybackAccessTokenHash,
      activeWorkers: twitchWorkers.length
    })
  };

  // Inicialización
  declareOptions(window);
  hookWindowWorker();
  hookFetch();

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    onContentLoaded();
  } else {
    window.addEventListener('DOMContentLoaded', onContentLoaded);
  }

  console.log(`[TwitchShield] Inicializado correctamente v${ourTwitchShieldVersion} (Modo: ${isSilentMode ? 'Silencioso' : 'Con avisos'}, Idioma: ${currentLang})`);
}
