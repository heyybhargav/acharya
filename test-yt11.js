async function run() {
  const response = await fetch("https://www.youtube.com/watch?v=jhgvdo9rb0w", {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+478'
    }
  });
  const html = await response.text();
  const match = html.match(/"captionTracks":\s*(\[.*?\])/);
  const tracks = JSON.parse(match[1]);
  
  const xmlRes = await fetch(tracks[0].baseUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+478'
    }
  });
  const xml = await xmlRes.text();
  console.log("Length:", xml.length);
  console.log(xml.substring(0, 200));
}
run();
