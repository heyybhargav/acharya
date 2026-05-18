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
    if (!match) {
      console.log("No match found in HTML length:", html.length);
      return;
    }
    const tracks = JSON.parse(match[1]);
    console.log(tracks);
  } catch(e) {
    console.error(e);
  }
}
run();
