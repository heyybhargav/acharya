const { YouTubeTranscriptApi } = require('youtube-captions-api');
async function run() {
  const api = new YouTubeTranscriptApi();
  const data = await api.fetch("WN9Mks1s4tM");
  console.log(data.snippets.length);
}
run();
