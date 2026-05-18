const { YouTubeTranscriptApi } = require('youtube-captions-api');
async function run() {
  const data = await YouTubeTranscriptApi.getTranscript("WN9Mks1s4tM");
  console.log(data.length);
}
run();
