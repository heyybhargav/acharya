const { transcript } = require('youtube-ext');
async function run() {
  const data = await transcript("WN9Mks1s4tM");
  console.log(data.length);
}
run();
