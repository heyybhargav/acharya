const { videoInfo } = require('youtube-ext');
async function run() {
  const data = await videoInfo("WN9Mks1s4tM");
  console.log(data);
}
run();
