import { HLSSegment, ParsedHLS } from '../types';

/**
 * Parses HLS tag attributes, e.g.
 * #EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002a,mp4a.40.2"
 */
export function parseAttributes(str: string): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  const regex = /([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(str)) !== null) {
    const key = match[1];
    const val = match[2] !== undefined ? match[2] : match[3];
    const num = Number(val);
    result[key] = !Number.isNaN(num) && val.trim() !== '' ? num : val;
  }
  return result;
}

/**
 * Robust RFC 8216 HLS parser for media and master playlists.
 */
export function parseHLS(rawText: string, adSignifier = 'stitched'): ParsedHLS {
  const lines = rawText.replaceAll('\r', '').split('\n');
  const isMaster = lines.some(l => l.startsWith('#EXT-X-STREAM-INF'));

  const parsed: ParsedHLS = {
    isMaster,
    segments: [],
    headers: [],
    rawText
  };

  if (isMaster) {
    return parsed;
  }

  let currentSegment: Partial<HLSSegment> | null = null;
  let pendingDiscontinuity = false;
  let pendingProgramDateTime: string | undefined;
  let customTags: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXT-X-VERSION:')) {
      parsed.version = parseInt(line.split(':')[1], 10);
      parsed.headers.push(line);
    } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      parsed.targetDuration = parseFloat(line.split(':')[1]);
      parsed.headers.push(line);
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      parsed.mediaSequence = parseInt(line.split(':')[1], 10);
      parsed.headers.push(line);
    } else if (line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:')) {
      parsed.discontinuitySequence = parseInt(line.split(':')[1], 10);
      parsed.headers.push(line);
    } else if (line === '#EXT-X-DISCONTINUITY') {
      pendingDiscontinuity = true;
    } else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      pendingProgramDateTime = line.substring(line.indexOf(':') + 1);
    } else if (line.startsWith('#EXTINF:')) {
      const parts = line.substring(8).split(',');
      const duration = parseFloat(parts[0]) || 2.0;
      const title = parts.slice(1).join(',');
      const isLive = title.includes('live');
      const isAd = !isLive || line.includes(adSignifier);

      currentSegment = {
        duration,
        title,
        isLive,
        isAd,
        discontinuity: pendingDiscontinuity,
        programDateTime: pendingProgramDateTime,
        customTags: [...customTags]
      };

      pendingDiscontinuity = false;
      pendingProgramDateTime = undefined;
      customTags = [];
    } else if (!line.startsWith('#')) {
      // Line is a URI
      if (currentSegment) {
        currentSegment.uri = line;
        parsed.segments.push(currentSegment as HLSSegment);
        currentSegment = null;
      }
    } else {
      // Other header/metadata tag (e.g. #EXT-X-DATERANGE, #EXT-X-TWITCH-PREFETCH)
      if (currentSegment) {
        customTags.push(line);
      } else {
        parsed.headers.push(line);
      }
    }
  }

  return parsed;
}

/**
 * Reconstructs HLS media playlist string from parsed representation.
 */
export function stringifyHLS(parsed: ParsedHLS): string {
  const out: string[] = ['#EXTM3U'];

  for (const h of parsed.headers) {
    if (h !== '#EXTM3U') {
      out.push(h);
    }
  }

  for (const seg of parsed.segments) {
    if (seg.discontinuity) {
      out.push('#EXT-X-DISCONTINUITY');
    }
    if (seg.programDateTime) {
      out.push(`#EXT-X-PROGRAM-DATE-TIME:${seg.programDateTime}`);
    }
    for (const tag of seg.customTags) {
      out.push(tag);
    }
    out.push(`#EXTINF:${seg.duration.toFixed(3)},${seg.title}`);
    out.push(seg.uri);
  }

  return out.join('\n') + '\n';
}
