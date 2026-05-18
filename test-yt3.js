async function run() {
  try {
    const response = await fetch("https://www.youtube.com/watch?v=jhgvdo9rb0w", {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+478'
      }
    });
    const html = await response.text();
    const match = html.match(/"captionTracks":\s*(\[.*?\])/);
    if (!match) throw new Error("No captions");
    const tracks = JSON.parse(match[1]);
    const track = tracks.find(t => t.languageCode === 'en') || tracks[0];
    
    const xmlRes = await fetch(track.baseUrl);
    const xml = await xmlRes.text();
    
    const regex = /<text start="([^"]+)"[^>]*>(.*?)<\/text>/g;
    let matches;
    const items = [];
    while ((matches = regex.exec(xml)) !== null) {
      items.push({
        offset: parseFloat(matches[1]) * 1000,
        text: matches[2]
      });
    }
    console.log("Parsed items:", items.length);
    console.log(items[0], items[1]);
  } catch(e) {
    console.error(e);
  }
}
run();
