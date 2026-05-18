async function run() {
  const response = await fetch("https://www.youtube.com/watch?v=jhgvdo9rb0w", {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+478'
    }
  });
  const html = await response.text();
  const match = html.match(/"captionTracks":\s*(\[.*?\])/);
  if (!match) return console.log("no match");
  const tracks = JSON.parse(match[1]);
  const url = tracks[0].baseUrl + "&fmt=json3";
  const jsonRes = await fetch(url);
  const json = await jsonRes.json();
  console.log(json.events.length, json.events[0]);
}
run();
