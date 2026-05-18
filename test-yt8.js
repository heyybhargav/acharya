const { Innertube } = require('youtubei.js');

async function run() {
  const youtube = await Innertube.create();
  const info = await youtube.getInfo("jhgvdo9rb0w");
  const transcriptData = await info.getTranscript();
  
  if (transcriptData && transcriptData.transcript) {
    const items = transcriptData.transcript.content.body.initial_segments;
    console.log(items[0]);
  } else {
    console.log("No transcript");
  }
}
run();
