const https = require('https');

async function fetchYoutubeTranscript(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+478'
    }
  });
  const html = await response.text();
  const match = html.match(/"captionTracks":\s*(\[.*?\])/);
  if (!match) throw new Error("No captions found");
  const tracks = JSON.parse(match[1]);
  const enTrack = tracks.find(t => t.languageCode === 'en') || tracks[0];
  if (!enTrack) throw new Error("No en track");
  
  const xmlRes = await fetch(enTrack.baseUrl);
  const xml = await xmlRes.text();
  return xml.substring(0, 500); // Just peek
}
fetchYoutubeTranscript('jhgvdo9rb0w').then(console.log).catch(console.error);
