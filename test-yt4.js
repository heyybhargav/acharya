async function run() {
  const response = await fetch("https://www.youtube.com/watch?v=jhgvdo9rb0w", {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+478'
    }
  });
  const html = await response.text();
  const match = html.match(/"captionTracks":\s*(\[.*?\])/);
  const tracks = JSON.parse(match[1]);
  const xmlRes = await fetch(tracks[0].baseUrl);
  const xml = await xmlRes.text();
  console.log(xml.substring(0, 500));
}
run();
