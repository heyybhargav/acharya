const RE_YOUTUBE = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/110.0';
const CONSENT_COOKIE = 'CONSENT=YES+cb.20230221-12-p0.en+FX+662'; // Magic cookie to bypass Vercel IP consent block

export class YoutubeTranscript {
    static async fetchTranscript(videoId: string, config?: any) {
        const identifier = this.retrieveVideoId(videoId);
        
        const fetchFn = config?.fetch ?? fetch;
        const videoPageResponse = await fetchFn(`https://www.youtube.com/watch?v=${identifier}`, {
            headers: {
                ...(config?.lang && { 'Accept-Language': config.lang }),
                'User-Agent': USER_AGENT,
                'Cookie': CONSENT_COOKIE
            },
        });
        
        const videoPageBody = await videoPageResponse.text();
        
        if (videoPageBody.includes('class="g-recaptcha"')) {
            throw new Error('YouTube requires captcha');
        }
        
        if (!videoPageBody.includes('"playabilityStatus":')) {
            throw new Error(`The video is no longer available (${videoId})`);
        }
        
        const playerResponse = this.parseInlineJson(videoPageBody, 'ytInitialPlayerResponse');
        const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        
        if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
            throw new Error(`Transcript is disabled on this video (${videoId})`);
        }
        
        return this.fetchTranscriptFromTracks(captionTracks, videoId, config);
    }
    
    static parseInlineJson(html: string, globalName: string) {
        const startToken = `var ${globalName} = `;
        const startIndex = html.indexOf(startToken);
        if (startIndex === -1) return null;
        
        const jsonStart = startIndex + startToken.length;
        let depth = 0;
        for (let i = jsonStart; i < html.length; i++) {
            if (html[i] === '{') depth++;
            else if (html[i] === '}') {
                depth--;
                if (depth === 0) {
                    try {
                        return JSON.parse(html.slice(jsonStart, i + 1));
                    } catch {
                        return null;
                    }
                }
            }
        }
        return null;
    }
    
    static async fetchTranscriptFromTracks(captionTracks: any[], videoId: string, config?: any) {
        const track = config?.lang
            ? captionTracks.find((track) => track.languageCode === config?.lang) || captionTracks[0]
            : captionTracks[0];
            
        const transcriptURL = track.baseUrl;
        
        const fetchFn = config?.fetch ?? fetch;
        const transcriptResponse = await fetchFn(transcriptURL, {
            headers: {
                ...(config?.lang && { 'Accept-Language': config.lang }),
                'User-Agent': USER_AGENT,
                'Cookie': CONSENT_COOKIE
            },
        });
        
        if (!transcriptResponse.ok) {
            throw new Error(`No transcripts are available for this video (${videoId})`);
        }
        
        const transcriptBody = await transcriptResponse.text();
        const lang = track.languageCode;
        return this.parseTranscriptXml(transcriptBody, lang);
    }
    
    static parseTranscriptXml(xml: string, lang: string) {
        const results = [];
        const pRegex = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
        let match;
        
        // Classic format: <text start="s" dur="s">content</text>
        while ((match = pRegex.exec(xml)) !== null) {
            results.push({
                text: this.decodeEntities(match[3]),
                duration: parseFloat(match[2]),
                offset: parseFloat(match[1]) * 1000,
                lang,
            });
        }
        
        if (results.length > 0) return results;
        
        // srv3 format: <p t="ms" d="ms"><s>word</s>...</p>
        const srvRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
        while ((match = srvRegex.exec(xml)) !== null) {
            const startMs = parseInt(match[1], 10);
            const durMs = parseInt(match[2], 10);
            const inner = match[3];
            let text = '';
            
            const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
            let sMatch;
            while ((sMatch = sRegex.exec(inner)) !== null) {
                text += sMatch[1];
            }
            if (!text) {
                text = inner.replace(/<[^>]+>/g, '');
            }
            
            text = this.decodeEntities(text).trim();
            if (text) {
                results.push({
                    text,
                    duration: durMs / 1000,
                    offset: startMs,
                    lang,
                });
            }
        }
        
        return results;
    }
    
    static decodeEntities(text: string) {
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
    
    static retrieveVideoId(videoId: string) {
        if (videoId.length === 11) {
            return videoId;
        }
        const matchId = videoId.match(RE_YOUTUBE);
        if (matchId && matchId.length) {
            return matchId[1];
        }
        throw new Error('Impossible to retrieve Youtube video ID.');
    }
}
