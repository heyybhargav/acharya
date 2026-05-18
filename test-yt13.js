import TranscriptClient from "youtube-transcript-api";
async function run() {
  const client = new TranscriptClient();
  await client.ready;
  const data = await client.getTranscript("jhgvdo9rb0w");
  console.log(data.transcripts.length);
}
run();
