// ==UserScript==
// @name         TwitchShield
// @namespace    https://github.com/4xiom4/TwitchShield
// @version      38.0.0
// @description  Bloqueo de anuncios en Twitch de cero latencia, silencioso, con extracción dinámica de tokens GraphQL y sincronización HLS.
// @author       4xiom4 & contributors
// @match        *://*.twitch.tv/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==
"use strict";
(() => {
  // src/core/twitch-shield.ts
  function runTwitchShield() {
    "use strict";
    const ourTwitchShieldVersion = 39;
    const win = window;
    if (typeof win.twitchShieldVersion !== "undefined" && win.twitchShieldVersion >= ourTwitchShieldVersion) {
      console.log("[TwitchShield] Ya est\xE1 activo v" + win.twitchShieldVersion);
      return;
    }
    win.twitchShieldVersion = ourTwitchShieldVersion;
    win.TwitchShieldSilentMode = true;
    function declareOptions(scope) {
      scope.AdSignifier = "stitched";
      scope.ClientID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
      scope.BackupPlayerTypes = [
        "embed",
        "popout",
        "autoplay"
      ];
      scope.FallbackPlayerType = "embed";
      scope.ForceAccessTokenPlayerType = "popout";
      scope.SkipPlayerReloadOnHevc = false;
      scope.AlwaysReloadPlayerOnAd = false;
      scope.ReloadPlayerAfterAd = true;
      scope.PlayerReloadMinimalRequestsTime = 1500;
      scope.PlayerReloadMinimalRequestsPlayerIndex = 2;
      scope.HasTriggeredPlayerReload = false;
      scope.StreamInfos = [];
      scope.StreamInfosByUrl = [];
      scope.GQLDeviceID = null;
      scope.ClientVersion = null;
      scope.ClientSession = null;
      scope.ClientIntegrityHeader = null;
      scope.AuthorizationHeader = void 0;
      scope.GQLPlaybackAccessTokenHash = (typeof localStorage !== "undefined" ? localStorage.getItem("TWITCH_SHIELD_GQL_HASH") : null) || "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9";
      scope.SimulatedAdsDepth = 0;
      scope.PlayerBufferingFix = true;
      scope.PlayerBufferingDelay = 600;
      scope.PlayerBufferingSameStateCount = 3;
      scope.PlayerBufferingDangerZone = 1;
      scope.PlayerBufferingDoPlayerReload = false;
      scope.PlayerBufferingMinRepeatDelay = 8e3;
      scope.PlayerBufferingPrerollCheckEnabled = false;
      scope.PlayerBufferingPrerollCheckOffset = 5;
      scope.V2API = false;
      scope.IsAdStrippingEnabled = true;
      scope.AdSegmentCache = /* @__PURE__ */ new Map();
      scope.AllSegmentsAreAdSegments = false;
    }
    let isActivelyStrippingAds = false;
    let localStorageHookFailed = false;
    const twitchWorkers = [];
    const workerStringConflicts = ["twitch", "isVariantA"];
    const workerStringAllow = [];
    const workerStringReinsert = ["isVariantA", "besuper/", "${patch_url}"];
    function getCleanWorker(worker) {
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
    function getWorkersForReinsert(worker) {
      const result = [];
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
    function reinsertWorkers(worker, reinsert) {
      let parent = worker;
      for (let i = 0; i < reinsert.length; i++) {
        Object.setPrototypeOf(reinsert[i], parent);
        parent = reinsert[i];
      }
      return parent;
    }
    function isValidWorker(worker) {
      const workerString = worker.toString();
      return !workerStringConflicts.some((x) => workerString.includes(x)) || workerStringAllow.some((x) => workerString.includes(x)) || workerStringReinsert.some((x) => workerString.includes(x));
    }
    function getWasmWorkerJs(twitchBlobUrl) {
      const req = new XMLHttpRequest();
      req.open("GET", twitchBlobUrl, false);
      req.overrideMimeType("text/javascript");
      req.send();
      return req.responseText;
    }
    function stripAdSegments(textStr, stripAllSegments, streamInfo) {
      let hasStrippedAdSegments = false;
      const lines = textStr.replaceAll("\r", "").split("\n");
      const newAdUrl = "https://twitch.tv";
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        line = line.replaceAll(/(X-TV-TWITCH-AD-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`).replaceAll(/(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`);
        if (i < lines.length - 1 && line.startsWith("#EXTINF") && (!line.includes(",live") || stripAllSegments || self.AllSegmentsAreAdSegments)) {
          const segmentUrl = lines[i + 1];
          if (!self.AdSegmentCache.has(segmentUrl)) {
            streamInfo.NumStrippedAdSegments++;
          }
          self.AdSegmentCache.set(segmentUrl, Date.now());
          hasStrippedAdSegments = true;
        }
        if (line.includes(self.AdSignifier)) {
          hasStrippedAdSegments = true;
        }
      }
      if (hasStrippedAdSegments) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith("#EXT-X-TWITCH-PREFETCH:")) {
            lines[i] = "";
          }
        }
      } else {
        streamInfo.NumStrippedAdSegments = 0;
      }
      streamInfo.IsStrippingAdSegments = hasStrippedAdSegments;
      self.AdSegmentCache.forEach((value, key, map) => {
        if (value < Date.now() - 12e4) {
          map.delete(key);
        }
      });
      return lines.join("\n");
    }
    function parseAttributes(str) {
      return Object.fromEntries(
        str.split(/(?:^|,)((?:[^=]*)=(?:"[^"]*"|[^,]*))/).filter(Boolean).map((x) => {
          const idx = x.indexOf("=");
          const key = x.substring(0, idx);
          const value = x.substring(idx + 1);
          const num = Number(value);
          return [key, Number.isNaN(num) ? value.startsWith('"') ? JSON.parse(value) : value : num];
        })
      );
    }
    function getStreamUrlForResolution(encodingsM3u8, resolutionInfo) {
      const encodingsLines = encodingsM3u8.replaceAll("\r", "").split("\n");
      const [targetWidth, targetHeight] = resolutionInfo.Resolution.split("x").map(Number);
      let matchedResolutionUrl = null;
      let matchedFrameRate = false;
      let closestResolutionUrl = null;
      let closestResolutionDifference = Infinity;
      for (let i = 0; i < encodingsLines.length - 1; i++) {
        if (encodingsLines[i].startsWith("#EXT-X-STREAM-INF") && encodingsLines[i + 1].includes(".m3u8")) {
          const attributes = parseAttributes(encodingsLines[i]);
          const resolution = attributes["RESOLUTION"];
          const frameRate = attributes["FRAME-RATE"];
          if (resolution) {
            if (resolution == resolutionInfo.Resolution && (!matchedResolutionUrl || !matchedFrameRate && frameRate == resolutionInfo.FrameRate)) {
              matchedResolutionUrl = encodingsLines[i + 1];
              matchedFrameRate = frameRate == resolutionInfo.FrameRate;
              if (matchedFrameRate) {
                return matchedResolutionUrl;
              }
            }
            const [width, height] = resolution.split("x").map(Number);
            const difference = Math.abs(width * height - targetWidth * targetHeight);
            if (difference < closestResolutionDifference) {
              closestResolutionUrl = encodingsLines[i + 1];
              closestResolutionDifference = difference;
            }
          }
        }
      }
      return closestResolutionUrl;
    }
    function getServerTimeFromM3u8(encodingsM3u8) {
      if (self.V2API) {
        const matches2 = encodingsM3u8.match(/#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="([^"]+)"/);
        return matches2 && matches2.length > 1 ? matches2[1] : null;
      }
      const matches = encodingsM3u8.match('SERVER-TIME="([0-9.]+)"');
      return matches && matches.length > 1 ? matches[1] : null;
    }
    function replaceServerTimeInM3u8(encodingsM3u8, newServerTime) {
      if (self.V2API) {
        return newServerTime ? encodingsM3u8.replace(/(#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE=")[^"]+(")/, `$1${newServerTime}$2`) : encodingsM3u8;
      }
      return newServerTime ? encodingsM3u8.replace(new RegExp('(SERVER-TIME=")[0-9.]+"'), `SERVER-TIME="${newServerTime}"`) : encodingsM3u8;
    }
    function getAccessToken(channelName, playerType) {
      const s = self;
      const body = {
        operationName: "PlaybackAccessToken",
        variables: {
          isLive: true,
          login: channelName,
          isVod: false,
          vodID: "",
          playerType,
          platform: playerType == "autoplay" ? "android" : "web"
        },
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: typeof s.GQLPlaybackAccessTokenHash !== "undefined" && s.GQLPlaybackAccessTokenHash ? s.GQLPlaybackAccessTokenHash : "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9"
          }
        }
      };
      return self.gqlRequest(body, playerType);
    }
    function gqlRequest(body, playerType) {
      const s = self;
      if (!s.GQLDeviceID) {
        s.GQLDeviceID = "";
        const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < 32; i++) {
          s.GQLDeviceID += chars.charAt(Math.floor(Math.random() * chars.length));
        }
      }
      let headers = {
        "Client-ID": s.ClientID,
        "X-Device-Id": s.GQLDeviceID,
        "Authorization": s.AuthorizationHeader,
        ...s.ClientIntegrityHeader && { "Client-Integrity": s.ClientIntegrityHeader },
        ...s.ClientVersion && { "Client-Version": s.ClientVersion },
        ...s.ClientSession && { "Client-Session-Id": s.ClientSession }
      };
      return new Promise((resolve, reject) => {
        const requestId = Math.random().toString(36).substring(2, 15);
        const fetchRequest = {
          id: requestId,
          url: "https://gql.twitch.tv/gql",
          options: {
            method: "POST",
            body: JSON.stringify(body),
            headers
          }
        };
        const pendingMap = typeof pendingFetchRequests !== "undefined" ? pendingFetchRequests : s.pendingFetchRequests;
        if (pendingMap) {
          pendingMap.set(requestId, { resolve, reject });
        }
        s.postMessage({
          key: "FetchRequest",
          value: fetchRequest
        });
      });
    }
    async function processM3U8(url, textStr, realFetch) {
      const s = self;
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
            key: "UpdateAdBlockBanner",
            isMidroll: streamInfo.IsMidroll,
            hasAds: streamInfo.IsShowingAd,
            isStrippingAdSegments: false
          });
        }
        if (!streamInfo.IsMidroll) {
          const lines = textStr.replaceAll("\r", "").split("\n");
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith("#EXTINF") && lines.length > i + 1) {
              if (!line.includes(",live") && !streamInfo.RequestedAds.has(lines[i + 1])) {
                streamInfo.RequestedAds.add(lines[i + 1]);
                fetch(lines[i + 1]).then((res) => {
                  res.blob();
                });
                break;
              }
            }
          }
        }
        const currentResolution = streamInfo.Urls[url];
        if (!currentResolution) return textStr;
        const isHevc = currentResolution.Codecs.startsWith("hev") || currentResolution.Codecs.startsWith("hvc");
        if ((isHevc && !s.SkipPlayerReloadOnHevc || s.AlwaysReloadPlayerOnAd) && streamInfo.ModifiedM3U8 && !streamInfo.IsUsingModifiedM3U8) {
          streamInfo.IsUsingModifiedM3U8 = true;
          streamInfo.LastPlayerReload = Date.now();
          s.postMessage({ key: "ReloadPlayer" });
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
          const realPlayerType = playerType.replace("-CACHED", "");
          const isFullyCachedPlayerType = playerType != realPlayerType;
          for (let i = 0; i < 2; i++) {
            let isFreshM3u8 = false;
            let encodingsM3u8 = streamInfo.BackupEncodingsM3U8Cache[playerType];
            if (!encodingsM3u8) {
              isFreshM3u8 = true;
              try {
                const accessTokenResponse = await getAccessToken(streamInfo.ChannelName, realPlayerType);
                if (accessTokenResponse.status === 200) {
                  const accessToken = await accessTokenResponse.json();
                  const urlInfo = new URL("https://usher.ttvnw.net/api/" + (s.V2API ? "v2/" : "") + "channel/hls/" + streamInfo.ChannelName + ".m3u8" + streamInfo.UsherParams);
                  urlInfo.searchParams.set("sig", accessToken.data.streamPlaybackAccessToken.signature);
                  urlInfo.searchParams.set("token", accessToken.data.streamPlaybackAccessToken.value);
                  const encodingsM3u8Response = await realFetch(urlInfo.href);
                  if (encodingsM3u8Response.status === 200) {
                    encodingsM3u8 = streamInfo.BackupEncodingsM3U8Cache[playerType] = await encodingsM3u8Response.text();
                  }
                }
              } catch (err) {
              }
            }
            if (encodingsM3u8) {
              try {
                const streamM3u8Url = getStreamUrlForResolution(encodingsM3u8, currentResolution);
                const streamM3u8Response = await realFetch(streamM3u8Url);
                if (streamM3u8Response.status == 200) {
                  const m3u8Text = await streamM3u8Response.text();
                  if (m3u8Text) {
                    if (playerType == s.FallbackPlayerType) fallbackM3u8 = m3u8Text;
                    if (!m3u8Text.includes(s.AdSignifier) && (s.SimulatedAdsDepth == 0 || playerTypeIndex >= s.SimulatedAdsDepth - 1) || !fallbackM3u8 && playerTypeIndex >= s.BackupPlayerTypes.length - 1) {
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
              } catch (err) {
              }
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
        console.log("[TwitchShield] Finalizado bloqueo de anuncios");
        streamInfo.IsShowingAd = false;
        streamInfo.IsStrippingAdSegments = false;
        streamInfo.NumStrippedAdSegments = 0;
        streamInfo.ActiveBackupPlayerType = null;
        if (streamInfo.IsUsingModifiedM3U8 || s.ReloadPlayerAfterAd) {
          streamInfo.IsUsingModifiedM3U8 = false;
          streamInfo.LastPlayerReload = Date.now();
          s.postMessage({ key: "ReloadPlayer" });
        } else {
          s.postMessage({ key: "PauseResumePlayer" });
        }
      }
      s.postMessage({
        key: "UpdateAdBlockBanner",
        isMidroll: streamInfo.IsMidroll,
        hasAds: streamInfo.IsShowingAd,
        isStrippingAdSegments: streamInfo.IsStrippingAdSegments,
        numStrippedAdSegments: streamInfo.NumStrippedAdSegments
      });
      return textStr;
    }
    function hookWorkerFetch() {
      const s = self;
      console.log("[TwitchShield] hookWorkerFetch inicializado");
      const realFetch = fetch;
      self.fetch = async function(url, options) {
        if (typeof url === "string") {
          if (s.AdSegmentCache && s.AdSegmentCache.has(url)) {
            return new Promise(function(resolve, reject) {
              realFetch("data:video/mp4;base64,AAAAKGZ0eXBtcDQyAAAAAWlzb21tcDQyZGFzaGF2YzFpc282aGxzZgAABEltb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAYagAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAABqHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAURtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAALuAAAAAAFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAADvbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAACzc3RibAAAAGdzdHNkAAAAAAAAAAEAAABXbXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAALuAAAAAAAAzZXNkcwAAAAADgICAIgABAASAgIAUQBUAAAAAAAAAAAAAAAWAgIACEZAGgICAAQIAAAAQc3R0cwAAAAAAAAAAAAAAEHN0c2MAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAeV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAoAAAAFoAAAAAAGBbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAA9CQAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABLG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAOxzdGJsAAAAoHN0c2QAAAAAAAAAAQAAAJBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAoABaABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAOmF2Y0MBTUAe/+EAI2dNQB6WUoFAX/LgLUBAQFAAAD6AAA6mDgAAHoQAA9CW7y4KAQAEaOuPIAAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAAAAAQc3RjbwAAAAAAAAAAAAAASG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAC4AAAAAAoAAAAAAACB0cmV4AAAAAAAAAAIAAAABAACCNQAAAAACQAAA", options).then((res) => resolve(res)).catch((err) => reject(err));
            });
          }
          url = url.trimEnd();
          if (url.endsWith("m3u8")) {
            return new Promise(function(resolve, reject) {
              const processAfter = async function(response) {
                if (response.status === 200) {
                  resolve(new Response(await processM3U8(url, await response.text(), realFetch)));
                } else {
                  resolve(response);
                }
              };
              realFetch(url, options).then((res) => processAfter(res)).catch((err) => reject(err));
            });
          } else if (url.includes("/channel/hls/") && !url.includes("picture-by-picture")) {
            s.V2API = url.includes("/api/v2/");
            const channelNameMatch = new URL(url).pathname.match(/([^\/]+)(?=\.\w+$)/);
            const channelName = channelNameMatch ? channelNameMatch[0] : "";
            if (s.ForceAccessTokenPlayerType) {
              const tempUrl = new URL(url);
              tempUrl.searchParams.delete("parent_domains");
              url = tempUrl.toString();
            }
            return new Promise(function(resolve, reject) {
              const processAfter = async function(response) {
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
                      UsherParams: new URL(url).search,
                      RequestedAds: /* @__PURE__ */ new Set(),
                      Urls: [],
                      ResolutionList: [],
                      BackupEncodingsM3U8Cache: [],
                      ActiveBackupPlayerType: null,
                      IsMidroll: false,
                      IsStrippingAdSegments: false,
                      NumStrippedAdSegments: 0
                    };
                    const lines = encodingsM3u8.replaceAll("\r", "").split("\n");
                    for (let i = 0; i < lines.length - 1; i++) {
                      if (lines[i].startsWith("#EXT-X-STREAM-INF") && lines[i + 1].includes(".m3u8")) {
                        const attributes = parseAttributes(lines[i]);
                        const resolution = attributes["RESOLUTION"];
                        if (resolution) {
                          const resolutionInfo = {
                            Resolution: resolution,
                            FrameRate: attributes["FRAME-RATE"],
                            Codecs: attributes["CODECS"],
                            Url: lines[i + 1]
                          };
                          streamInfo.Urls[lines[i + 1]] = resolutionInfo;
                          streamInfo.ResolutionList.push(resolutionInfo);
                        }
                        s.StreamInfosByUrl[lines[i + 1]] = streamInfo;
                      }
                    }
                    const nonHevcResolutionList = streamInfo.ResolutionList.filter((element) => element.Codecs.startsWith("avc") || element.Codecs.startsWith("av0"));
                    if (s.AlwaysReloadPlayerOnAd || nonHevcResolutionList.length > 0 && streamInfo.ResolutionList.some((element) => element.Codecs.startsWith("hev") || element.Codecs.startsWith("hvc")) && !s.SkipPlayerReloadOnHevc) {
                      if (nonHevcResolutionList.length > 0) {
                        for (let i = 0; i < lines.length - 1; i++) {
                          if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
                            const resSettings = parseAttributes(lines[i].substring(lines[i].indexOf(":") + 1));
                            const codecsKey = "CODECS";
                            if (resSettings[codecsKey] && (resSettings[codecsKey].startsWith("hev") || resSettings[codecsKey].startsWith("hvc"))) {
                              const oldResolution = resSettings["RESOLUTION"];
                              const [targetWidth, targetHeight] = oldResolution.split("x").map(Number);
                              const newResolutionInfo = nonHevcResolutionList.sort((a, b) => {
                                const [streamWidthA, streamHeightA] = a.Resolution.split("x").map(Number);
                                const [streamWidthB, streamHeightB] = b.Resolution.split("x").map(Number);
                                return Math.abs(streamWidthA * streamHeightA - targetWidth * targetHeight) - Math.abs(streamWidthB * streamHeightB - targetWidth * targetHeight);
                              })[0];
                              lines[i] = lines[i].replace(/CODECS="[^"]+"/, `CODECS="${newResolutionInfo.Codecs}"`);
                              lines[i + 1] = newResolutionInfo.Url + " ".repeat(i + 1);
                            }
                          }
                        }
                      }
                      if (nonHevcResolutionList.length > 0 || s.AlwaysReloadPlayerOnAd) {
                        streamInfo.ModifiedM3U8 = lines.join("\n");
                      }
                    }
                  }
                  streamInfo.LastPlayerReload = Date.now();
                  resolve(new Response(replaceServerTimeInM3u8(streamInfo.IsUsingModifiedM3U8 ? streamInfo.ModifiedM3U8 : streamInfo.EncodingsM3U8, serverTime)));
                } else {
                  resolve(response);
                }
              };
              realFetch(url, options).then((res) => processAfter(res)).catch((err) => reject(err));
            });
          }
        }
        return realFetch.apply(this, arguments);
      };
    }
    function hookWindowWorker() {
      const reinsert = getWorkersForReinsert(window.Worker);
      const newWorker = class Worker extends getCleanWorker(window.Worker) {
        constructor(twitchBlobUrl, options) {
          let isTwitchWorker = false;
          try {
            isTwitchWorker = new URL(twitchBlobUrl).origin.endsWith(".twitch.tv");
          } catch {
          }
          if (!isTwitchWorker) {
            super(twitchBlobUrl, options);
            return;
          }
          const s = self;
          const newBlobStr = `
          const pendingFetchRequests = new Map();
          self.pendingFetchRequests = pendingFetchRequests;
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
          AuthorizationHeader = ${s.AuthorizationHeader ? "'" + s.AuthorizationHeader + "'" : void 0};
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
          this.addEventListener("message", (e) => {
            if (e.data.key == "UpdateAdBlockBanner") {
              updateAdblockBanner(e.data);
            } else if (e.data.key == "PauseResumePlayer") {
              doTwitchPlayerTask(true, false);
            } else if (e.data.key == "ReloadPlayer") {
              doTwitchPlayerTask(false, true);
            }
          });
          this.addEventListener("message", async (event) => {
            if (event.data.key == "FetchRequest") {
              const fetchRequest = event.data.value;
              const responseData = await handleWorkerFetchRequest(fetchRequest);
              this.postMessage({
                key: "FetchResponse",
                value: responseData
              });
            }
          });
        }
      };
      let workerInstance = reinsertWorkers(newWorker, reinsert);
      Object.defineProperty(window, "Worker", {
        get: function() {
          return workerInstance;
        },
        set: function(value) {
          if (isValidWorker(value)) {
            workerInstance = value;
          } else {
            console.log("[TwitchShield] Intento de reasignar worker denegado");
          }
        }
      });
    }
    function updateAdblockBanner(data) {
      if (win.TwitchShieldSilentMode) {
        if (data.hasAds) {
          console.log(`[TwitchShield] Bloqueando anuncios (${data.isMidroll ? "midroll" : "preroll"})`);
        }
        return;
      }
      const playerRootDiv = document.querySelector(".video-player");
      if (playerRootDiv != null) {
        let adBlockDiv = playerRootDiv.querySelector(".adblock-overlay");
        if (adBlockDiv == null) {
          adBlockDiv = document.createElement("div");
          adBlockDiv.className = "adblock-overlay";
          adBlockDiv.innerHTML = '<div class="player-adblock-notice" style="color: white; background-color: rgba(24, 24, 27, 0.85); backdrop-filter: blur(4px); border: 1px solid rgba(145, 70, 255, 0.4); border-radius: 4px; position: absolute; top: 12px; left: 12px; padding: 4px 8px; font-size: 11px; z-index: 9999;"><p style="margin: 0;"></p></div>';
          adBlockDiv.style.display = "none";
          adBlockDiv.P = adBlockDiv.querySelector("p");
          playerRootDiv.appendChild(adBlockDiv);
        }
        if (adBlockDiv != null) {
          isActivelyStrippingAds = data.isStrippingAdSegments;
          let msg = data.isMidroll ? "Bloqueando anuncios (midroll)..." : "Bloqueando anuncios...";
          if (data.isStrippingAdSegments) msg += " (suprimiendo)";
          adBlockDiv.P.textContent = `\u{1F6E1}\uFE0F ${msg}`;
          adBlockDiv.style.display = data.hasAds ? "block" : "none";
        }
      }
    }
    let playerForMonitoringBuffering = null;
    const playerBufferState = {
      channelName: null,
      hasStreamStarted: false,
      position: 0,
      bufferedPosition: 0,
      bufferDuration: 0,
      numSame: 0,
      lastFixTime: 0,
      isLive: true
    };
    function monitorPlayerBuffering() {
      if (playerForMonitoringBuffering) {
        try {
          const player = playerForMonitoringBuffering.player;
          const state = playerForMonitoringBuffering.state;
          if (!player.core) {
            playerForMonitoringBuffering = null;
          } else if (state.props?.content?.type === "live" && !player.isPaused() && !player.getHTMLVideoElement()?.ended && playerBufferState.lastFixTime <= Date.now() - 8e3 && !isActivelyStrippingAds) {
            const m3u8Url = player.core?.state?.path;
            if (m3u8Url) {
              const fileName = new URL(m3u8Url).pathname.split("/").pop();
              if (fileName?.endsWith(".m3u8")) {
                const channelName = fileName.slice(0, -5);
                if (playerBufferState.channelName != channelName) {
                  playerBufferState.channelName = channelName;
                  playerBufferState.hasStreamStarted = false;
                  playerBufferState.numSame = 0;
                }
              }
            }
            if (player.getState() === "Playing") {
              playerBufferState.hasStreamStarted = true;
            }
            const position = player.core?.state?.position;
            const bufferedPosition = player.core?.state?.bufferedPosition;
            const bufferDuration = player.getBufferDuration ? player.getBufferDuration() : 0;
            if (position !== void 0 && bufferedPosition !== void 0) {
              if (playerBufferState.hasStreamStarted && (playerBufferState.position == position || bufferDuration < 1) && playerBufferState.bufferedPosition == bufferedPosition && playerBufferState.bufferDuration >= bufferDuration && (position != 0 || bufferedPosition != 0 || bufferDuration != 0)) {
                playerBufferState.numSame++;
                if (playerBufferState.numSame == 3) {
                  console.log("[TwitchShield] Detectado congelamiento en buffer, corrigiendo...");
                  doTwitchPlayerTask(true, false);
                  playerBufferState.lastFixTime = Date.now();
                  playerBufferState.numSame = 0;
                }
              } else {
                playerBufferState.numSame = 0;
              }
              playerBufferState.position = position;
              playerBufferState.bufferedPosition = bufferedPosition;
              playerBufferState.bufferDuration = bufferDuration;
            } else {
              playerBufferState.numSame = 0;
            }
          }
        } catch (err) {
          playerForMonitoringBuffering = null;
        }
      }
      if (!playerForMonitoringBuffering) {
        const playerAndState = getPlayerAndState();
        if (playerAndState && playerAndState.player && playerAndState.state) {
          playerForMonitoringBuffering = {
            player: playerAndState.player,
            state: playerAndState.state
          };
        }
      }
      const isLive = playerForMonitoringBuffering?.state?.props?.content?.type === "live";
      if (playerBufferState.isLive && !isLive) {
        updateAdblockBanner({ hasAds: false });
      }
      playerBufferState.isLive = isLive;
      setTimeout(monitorPlayerBuffering, 600);
    }
    function getPlayerAndState() {
      function findReactNode(root, constraint) {
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
        let reactRootNode2 = null;
        const rootNode = document.querySelector("#root");
        if (rootNode && rootNode._reactRootContainer && rootNode._reactRootContainer._internalRoot && rootNode._reactRootContainer._internalRoot.current) {
          reactRootNode2 = rootNode._reactRootContainer._internalRoot.current;
        }
        if (reactRootNode2 == null && rootNode != null) {
          const containerName = Object.keys(rootNode).find((x) => x.startsWith("__reactContainer"));
          if (containerName != null) {
            reactRootNode2 = rootNode[containerName];
          }
        }
        return reactRootNode2;
      }
      const reactRootNode = findReactRootNode();
      if (!reactRootNode) return null;
      let player = findReactNode(reactRootNode, (node) => node.setPlayerActive && node.props && node.props.mediaPlayerInstance);
      player = player && player.props && player.props.mediaPlayerInstance ? player.props.mediaPlayerInstance : null;
      if (player?.playerInstance) {
        player = player.playerInstance;
      }
      const playerState = findReactNode(reactRootNode, (node) => node.setSrc && node.setInitialPlaybackSettings);
      return { player, state: playerState };
    }
    function doTwitchPlayerTask(isPausePlay, isReload) {
      const playerAndState = getPlayerAndState();
      if (!playerAndState || !playerAndState.player) {
        const v = document.querySelector("video");
        if (v) {
          if (isPausePlay) {
            v.pause();
            v.play().catch(() => {
            });
          }
        }
        return;
      }
      const { player, state: playerState } = playerAndState;
      if (player.isPaused() || player.core?.paused) return;
      playerBufferState.lastFixTime = Date.now();
      playerBufferState.numSame = 0;
      if (isPausePlay) {
        player.pause();
        player.play();
        return;
      }
      if (isReload && playerState) {
        const lsKeyQuality = "video-quality";
        const lsKeyMuted = "video-muted";
        const lsKeyVolume = "volume";
        let currentQualityLS = null;
        let currentMutedLS = null;
        let currentVolumeLS = null;
        try {
          currentQualityLS = localStorage.getItem(lsKeyQuality);
          currentMutedLS = localStorage.getItem(lsKeyMuted);
          currentVolumeLS = localStorage.getItem(lsKeyVolume);
          if (localStorageHookFailed && player?.core?.state) {
            localStorage.setItem(lsKeyMuted, JSON.stringify({ default: player.core.state.muted }));
            localStorage.setItem(lsKeyVolume, player.core.state.volume);
          }
          if (localStorageHookFailed && player?.core?.state?.quality?.group) {
            localStorage.setItem(lsKeyQuality, JSON.stringify({ default: player.core.state.quality.group }));
          }
        } catch {
        }
        console.log("[TwitchShield] Recargando reproductor de Twitch...");
        playerState.setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true });
        postTwitchWorkerMessage("TriggeredPlayerReload", true);
        player.play();
        if (localStorageHookFailed && (currentQualityLS || currentMutedLS || currentVolumeLS)) {
          setTimeout(() => {
            try {
              if (currentQualityLS) localStorage.setItem(lsKeyQuality, currentQualityLS);
              if (currentMutedLS) localStorage.setItem(lsKeyMuted, currentMutedLS);
              if (currentVolumeLS) localStorage.setItem(lsKeyVolume, currentVolumeLS);
            } catch {
            }
          }, 3e3);
        }
        return;
      }
    }
    function postTwitchWorkerMessage(key, value) {
      twitchWorkers.forEach((worker) => {
        worker.postMessage({ key, value });
      });
    }
    async function handleWorkerFetchRequest(fetchRequest) {
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
      } catch (error) {
        return {
          id: fetchRequest.id,
          error: error?.message || "Error de red"
        };
      }
    }
    function hookFetch() {
      const realFetch = window.fetch;
      win.realFetch = realFetch;
      window.fetch = function(url, init, ...args) {
        if (typeof url === "string") {
          if (url.includes("gql")) {
            const s = typeof window !== "undefined" ? window : self;
            let deviceId = init?.headers?.["X-Device-Id"] || init?.headers?.["Device-ID"];
            if (typeof deviceId === "string" && s.GQLDeviceID != deviceId) {
              s.GQLDeviceID = deviceId;
              postTwitchWorkerMessage("UpdateDeviceId", s.GQLDeviceID);
            }
            if (init?.headers?.["Client-Version"] && init.headers["Client-Version"] !== s.ClientVersion) {
              postTwitchWorkerMessage("UpdateClientVersion", s.ClientVersion = init.headers["Client-Version"]);
            }
            if (init?.headers?.["Client-Session-Id"] && init.headers["Client-Session-Id"] !== s.ClientSession) {
              postTwitchWorkerMessage("UpdateClientSession", s.ClientSession = init.headers["Client-Session-Id"]);
            }
            if (init?.headers?.["Client-Integrity"] && init.headers["Client-Integrity"] !== s.ClientIntegrityHeader) {
              postTwitchWorkerMessage("UpdateClientIntegrityHeader", s.ClientIntegrityHeader = init.headers["Client-Integrity"]);
            }
            if (init?.headers?.["Authorization"] && init.headers["Authorization"] !== s.AuthorizationHeader) {
              postTwitchWorkerMessage("UpdateAuthorizationHeader", s.AuthorizationHeader = init.headers["Authorization"]);
            }
            if (init && typeof init.body === "string" && init.body.includes("PlaybackAccessToken")) {
              try {
                const bodyJson = JSON.parse(init.body);
                const items = Array.isArray(bodyJson) ? bodyJson : [bodyJson];
                for (const it of items) {
                  const foundHash = it?.extensions?.persistedQuery?.sha256Hash;
                  if (foundHash && foundHash.length === 64 && foundHash !== s.GQLPlaybackAccessTokenHash) {
                    s.GQLPlaybackAccessTokenHash = foundHash;
                    try {
                      localStorage.setItem("TWITCH_SHIELD_GQL_HASH", foundHash);
                    } catch {
                    }
                    postTwitchWorkerMessage("UpdateGQLHash", foundHash);
                    console.log("[TwitchShield] Hash din\xE1mico capturado:", foundHash);
                  }
                }
              } catch {
              }
              if (init.body.includes("picture-by-picture")) {
                init.body = "";
              } else {
                const targetPlayerType = s.ForceAccessTokenPlayerType || "popout";
                if (targetPlayerType) {
                  let replacedPlayerType = "";
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
                  } catch {
                  }
                }
              }
            }
          }
        }
        return (win.realFetch || realFetch).apply(this, arguments);
      };
    }
    function onContentLoaded() {
      try {
        Object.defineProperty(document, "visibilityState", {
          get() {
            return "visible";
          }
        });
      } catch {
      }
      let hidden = document.__lookupGetter__ ? document.__lookupGetter__("hidden") : null;
      let webkitHidden = document.__lookupGetter__ ? document.__lookupGetter__("webkitHidden") : null;
      try {
        Object.defineProperty(document, "hidden", {
          get() {
            return false;
          }
        });
      } catch {
      }
      const block = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };
      let wasVideoPlaying = true;
      const visibilityChange = (e) => {
        const isChrome = typeof window.chrome !== "undefined";
        const videos = document.getElementsByTagName("video");
        if (videos.length > 0) {
          if (hidden && hidden.apply(document) === true || webkitHidden && webkitHidden.apply(document) === true) {
            wasVideoPlaying = !videos[0].paused && !videos[0].ended;
          } else {
            if (!playerBufferState.hasStreamStarted) {
              playerBufferState.hasStreamStarted = true;
            }
            if (isChrome && wasVideoPlaying && !videos[0].ended && videos[0].paused && videos[0].muted) {
              videos[0].play().catch(() => {
              });
            }
          }
        }
        block(e);
      };
      document.addEventListener("visibilitychange", visibilityChange, true);
      document.addEventListener("webkitvisibilitychange", visibilityChange, true);
      document.addEventListener("mozvisibilitychange", visibilityChange, true);
      document.addEventListener("hasFocus", block, true);
      try {
        if (/Firefox/.test(navigator.userAgent)) {
          Object.defineProperty(document, "mozHidden", {
            get() {
              return false;
            }
          });
        } else {
          Object.defineProperty(document, "webkitHidden", {
            get() {
              return false;
            }
          });
        }
      } catch {
      }
      try {
        const keysToCache = [
          "video-quality",
          "video-muted",
          "volume",
          "lowLatencyModeEnabled",
          "persistenceEnabled"
        ];
        const cachedValues = /* @__PURE__ */ new Map();
        for (let i = 0; i < keysToCache.length; i++) {
          cachedValues.set(keysToCache[i], localStorage.getItem(keysToCache[i]));
        }
        const realSetItem = localStorage.setItem;
        localStorage.setItem = function(key, value) {
          if (cachedValues.has(key)) {
            cachedValues.set(key, value);
          }
          realSetItem.apply(this, arguments);
        };
        const realGetItem = localStorage.getItem;
        localStorage.getItem = function(key) {
          if (cachedValues.has(key)) {
            return cachedValues.get(key);
          }
          return realGetItem.apply(this, arguments);
        };
        if (!localStorage.getItem.toString().includes(Object.keys({ cachedValues })[0])) {
          localStorageHookFailed = true;
        }
      } catch (err) {
        localStorageHookFailed = true;
      }
    }
    win.TwitchShield = {
      version: ourTwitchShieldVersion,
      reloadStream: () => doTwitchPlayerTask(false, true),
      setSilentMode: (silent) => {
        win.TwitchShieldSilentMode = silent;
        console.log(`[TwitchShield] Modo silencioso: ${silent ? "ACTIVADO" : "DESACTIVADO"}`);
      },
      status: () => ({
        version: ourTwitchShieldVersion,
        silentMode: win.TwitchShieldSilentMode,
        capturedHash: window.GQLPlaybackAccessTokenHash,
        activeWorkers: twitchWorkers.length
      })
    };
    declareOptions(window);
    hookWindowWorker();
    hookFetch();
    if (window.PlayerBufferingFix !== false) {
      monitorPlayerBuffering();
    }
    if (document.readyState === "complete" || document.readyState === "interactive") {
      onContentLoaded();
    } else {
      window.addEventListener("DOMContentLoaded", onContentLoaded);
    }
    console.log(`[TwitchShield] Inicializado v${ourTwitchShieldVersion} (Modo: Silencioso, Idioma: ES)`);
  }

  // src/main.ts
  runTwitchShield();
})();
