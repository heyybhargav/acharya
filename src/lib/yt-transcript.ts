// Multi-client InnerTube YouTube transcript fetcher.
//
// YouTube increasingly throttles its public caption endpoints when the request
// comes from a datacenter IP (Vercel, AWS, GCP). A single client identity
// (e.g. ANDROID) is unreliable from serverless. We try several clients in
// sequence and accept the first one that returns caption tracks.
//
// This is not a guarantee. If all clients are throttled for a given video the
// user can paste the transcript manually.

export interface TranscriptItem {
  text: string;
  offsetMs: number;
  durationMs: number;
  lang?: string;
}

interface InnerTubeClient {
  name: string;
  version: string;
  userAgent: string;
  extra?: Record<string, unknown>;
}

const CLIENTS: InnerTubeClient[] = [
  {
    name: 'ANDROID',
    version: '20.10.38',
    userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
    extra: { androidSdkVersion: 34 },
  },
  {
    name: 'IOS',
    version: '19.09.3',
    userAgent: 'com.google.ios.youtube/19.09.3 (iPhone16,2; U; CPU iOS 17_4 like Mac OS X)',
    extra: { deviceModel: 'iPhone16,2' },
  },
  {
    name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    version: '2.0',
    userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  },
  {
    name: 'WEB',
    version: '2.20241201.00.00',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  },
  {
    name: 'ANDROID_VR',
    version: '1.57.29',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.57.29 (Linux; U; Android 12L; Quest 3) gzip',
  },
];

const RE_YOUTUBE = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;

export function extractVideoId(input: string): string {
  if (input.length === 11) return input;
  const m = input.match(RE_YOUTUBE);
  if (m && m[1]) return m[1];
  throw new Error('Could not extract a video id from the URL.');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

interface RawCaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
}

async function tryInnerTubeClient(videoId: string, client: InnerTubeClient): Promise<RawCaptionTrack[] | null> {
  const body = {
    context: {
      client: {
        clientName: client.name,
        clientVersion: client.version,
        hl: 'en',
        gl: 'US',
        ...(client.extra || {}),
      },
    },
    videoId,
  };
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': client.userAgent,
        'X-YouTube-Client-Name': client.name,
        'X-YouTube-Client-Version': client.version,
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://www.youtube.com',
        'Referer': `https://www.youtube.com/watch?v=${videoId}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) return null;
    return tracks as RawCaptionTrack[];
  } catch {
    return null;
  }
}

async function tryWebPageScrape(videoId: string): Promise<RawCaptionTrack[] | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'CONSENT=YES+cb.20240101-00-p0.en+FX',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (html.includes('class="g-recaptcha"')) return null;
    const token = 'var ytInitialPlayerResponse = ';
    const start = html.indexOf(token);
    if (start === -1) return null;
    const jsonStart = start + token.length;
    let depth = 0;
    let end = -1;
    for (let i = jsonStart; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end === -1) return null;
    const player = JSON.parse(html.slice(jsonStart, end));
    const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) return null;
    return tracks as RawCaptionTrack[];
  } catch {
    return null;
  }
}

function parseSrv3(xml: string, lang: string): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let match: RegExpExecArray | null;
  while ((match = pRegex.exec(xml)) !== null) {
    const startMs = parseInt(match[1], 10);
    const durMs = parseInt(match[2], 10);
    const inner = match[3];
    let text = '';
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = sRegex.exec(inner)) !== null) text += sMatch[1];
    if (!text) text = inner.replace(/<[^>]+>/g, '');
    text = decodeEntities(text).trim();
    if (text) items.push({ text, offsetMs: startMs, durationMs: durMs, lang });
  }
  return items;
}

function parseClassic(xml: string, lang: string): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const re = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const text = decodeEntities(match[3]).trim();
    if (!text) continue;
    items.push({
      text,
      offsetMs: Math.round(parseFloat(match[1]) * 1000),
      durationMs: Math.round(parseFloat(match[2]) * 1000),
      lang,
    });
  }
  return items;
}

async function fetchCaptionXml(baseUrl: string, userAgent: string, fmt: string): Promise<string | null> {
  const url = baseUrl + (baseUrl.includes('fmt=') ? '' : `&fmt=${fmt}`);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return null;
    const body = await res.text();
    if (!body || body.length === 0) return null;
    return body;
  } catch {
    return null;
  }
}

async function tryTrack(track: RawCaptionTrack, userAgent: string, preferredLang: string): Promise<TranscriptItem[] | null> {
  if (!track?.baseUrl) return null;
  const lang = track.languageCode || preferredLang;
  for (const fmt of ['srv3', 'srv1']) {
    const xml = await fetchCaptionXml(track.baseUrl, userAgent, fmt);
    if (!xml) continue;
    const items = fmt === 'srv3' ? parseSrv3(xml, lang) : parseClassic(xml, lang);
    if (items.length > 0) return items;
  }
  return null;
}

function pickTrack(tracks: RawCaptionTrack[], preferredLang: string): RawCaptionTrack | undefined {
  return (
    tracks.find(t => t.languageCode === preferredLang) ||
    tracks.find(t => t.languageCode?.startsWith(preferredLang)) ||
    tracks[0]
  );
}

export async function fetchTranscript(urlOrId: string, preferredLang = 'en'): Promise<TranscriptItem[]> {
  const videoId = extractVideoId(urlOrId);
  const errors: string[] = [];

  // First pass: try each InnerTube client.
  for (const client of CLIENTS) {
    const tracks = await tryInnerTubeClient(videoId, client);
    if (!tracks) {
      errors.push(`${client.name}: no caption tracks`);
      continue;
    }
    const track = pickTrack(tracks, preferredLang);
    if (!track) {
      errors.push(`${client.name}: no usable track`);
      continue;
    }
    const items = await tryTrack(track, client.userAgent, preferredLang);
    if (items && items.length > 0) return items;
    errors.push(`${client.name}: caption xml empty`);
  }

  // Second pass: scrape the watch page HTML for the player response.
  // Sometimes works when the InnerTube API is throttled, because the watch
  // page hits a different YouTube backend.
  const scrapeTracks = await tryWebPageScrape(videoId);
  if (scrapeTracks) {
    const track = pickTrack(scrapeTracks, preferredLang);
    if (track) {
      const items = await tryTrack(
        track,
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        preferredLang,
      );
      if (items && items.length > 0) return items;
      errors.push('WEB_SCRAPE: caption xml empty');
    } else {
      errors.push('WEB_SCRAPE: no usable track');
    }
  } else {
    errors.push('WEB_SCRAPE: page returned no player response');
  }

  throw new Error(
    `Could not fetch a transcript for this video from the server (${errors.join('; ')}). ` +
    `YouTube may be blocking our deployment IP. Paste the transcript manually, or upload the video file.`,
  );
}
