export interface TwitchShieldConfig {
  version: number;
  adSignifier: string;
  clientId: string;
  backupPlayerTypes: string[];
  fallbackPlayerType: string;
  forceAccessTokenPlayerType: string;
  skipPlayerReloadOnHevc: boolean;
  alwaysReloadPlayerOnAd: boolean;
  reloadPlayerAfterAd: boolean;
  playerReloadMinimalRequestsTime: number;
  playerReloadMinimalRequestsPlayerIndex: number;
  playerBufferingFix: boolean;
  playerBufferingDelay: number;
  playerBufferingSameStateCount: number;
  playerBufferingDangerZone: number;
  playerBufferingDoPlayerReload: boolean;
  playerBufferingMinRepeatDelay: number;
  isAdStrippingEnabled: boolean;
  debug: boolean;
}

export interface StreamResolutionInfo {
  Resolution: string;
  FrameRate?: number | string;
  Codecs: string;
  Url: string;
}

export interface StreamChannelInfo {
  ChannelName: string;
  IsShowingAd: boolean;
  LastPlayerReload: number;
  EncodingsM3U8: string | null;
  ModifiedM3U8: null;
  IsUsingModifiedM3U8: boolean;
  UsherParams: string;
  RequestedAds: Set<string>;
  Urls: Record<string, StreamResolutionInfo>;
  ResolutionList: StreamResolutionInfo[];
  BackupEncodingsM3U8Cache: Record<string, string | null>;
  ActiveBackupPlayerType: string | null;
  IsMidroll: boolean;
  IsStrippingAdSegments: boolean;
  NumStrippedAdSegments: number;
}

export interface WorkerBridgeMessage {
  key: string;
  value?: any;
  hasAds?: boolean;
  isMidroll?: boolean;
  isStrippingAdSegments?: boolean;
  numStrippedAdSegments?: number;
}

export interface GQLHeaders {
  'Client-ID'?: string;
  'X-Device-Id'?: string;
  'Authorization'?: string;
  'Client-Integrity'?: string;
  'Client-Version'?: string;
  'Client-Session-Id'?: string;
}

export interface HLSSegment {
  duration: number;
  title: string;
  uri: string;
  isLive: boolean;
  isAd: boolean;
  discontinuity?: boolean;
  programDateTime?: string;
  customTags: string[];
}

export interface ParsedHLS {
  isMaster: boolean;
  version?: number;
  targetDuration?: number;
  mediaSequence?: number;
  discontinuitySequence?: number;
  segments: HLSSegment[];
  headers: string[];
  rawText: string;
}
