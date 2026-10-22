import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAttributes, parseHLS, stringifyHLS } from '../src/hls/parser.ts';
import { HLSSynchronizer } from '../src/hls/synchronizer.ts';

test('parseAttributes handles various HLS formats', () => {
  const line = 'BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002a,mp4a.40.2"';
  const attrs = parseAttributes(line);

  assert.equal(attrs['BANDWIDTH'], 6000000);
  assert.equal(attrs['RESOLUTION'], '1920x1080');
  assert.equal(attrs['FRAME-RATE'], 60);
  assert.equal(attrs['CODECS'], 'avc1.64002a,mp4a.40.2');
});

test('parseHLS and stringifyHLS correctly parse and reconstruct media playlist', () => {
  const m3u8 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:54321
#EXTINF:2.000,live
https://video-edge.twitch.tv/seg-1.ts
#EXTINF:2.000,live
https://video-edge.twitch.tv/seg-2.ts
`;

  const parsed = parseHLS(m3u8);
  assert.equal(parsed.isMaster, false);
  assert.equal(parsed.version, 3);
  assert.equal(parsed.mediaSequence, 54321);
  assert.equal(parsed.segments.length, 2);
  assert.equal(parsed.segments[0].isLive, true);
  assert.equal(parsed.segments[0].isAd, false);

  const serialized = stringifyHLS(parsed);
  assert.ok(serialized.includes('#EXT-X-MEDIA-SEQUENCE:54321'));
  assert.ok(serialized.includes('https://video-edge.twitch.tv/seg-1.ts'));
});

test('HLSSynchronizer detects stitched ads and strips them with continuity preservation', () => {
  const m3u8WithAds = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:100
#EXTINF:2.000,live
https://video-edge.twitch.tv/seg-1.ts
#EXTINF:2.000,stitched
https://video-edge.twitch.tv/ad-seg-1.ts
#EXTINF:2.000,stitched
https://video-edge.twitch.tv/ad-seg-2.ts
#EXTINF:2.000,live
https://video-edge.twitch.tv/seg-2.ts
`;

  const synchronizer = new HLSSynchronizer();
  assert.equal(synchronizer.hasAds(m3u8WithAds), true);

  const { cleanedText, strippedCount } = synchronizer.stripAdsFromPlaylist(m3u8WithAds);
  assert.equal(strippedCount, 2);
  assert.ok(!cleanedText.includes('ad-seg-1.ts'));
  assert.ok(!cleanedText.includes('ad-seg-2.ts'));
  assert.ok(cleanedText.includes('seg-1.ts'));
  assert.ok(cleanedText.includes('seg-2.ts'));
  assert.ok(cleanedText.includes('#EXT-X-DISCONTINUITY'));
});
