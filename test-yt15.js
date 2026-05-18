const { getTranscript } = require('youtube-captions-api');
async function run() {
  const data = await getTranscript("WN9Mks1s4tM");
  console.log(data.length);
}
run();
