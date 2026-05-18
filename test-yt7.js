const { YoutubeTranscript } = require('youtube-transcript-api');
async function run() {
  const transcriptItems = await YoutubeTranscript.fetchTranscript("https://youtu.be/jhgvdo9rb0w");
  console.log(transcriptItems[0]);
}
run();
