import { getOpenAITools } from './src/tools/index.js';
import fs from 'fs';

async function debug() {
  try {
    const tools = await getOpenAITools();
    console.log(JSON.stringify(tools, null, 2));
    fs.writeFileSync('./tmp/tools_debug.json', JSON.stringify(tools, null, 2));
  } catch (e) {
    console.error(e);
  }
}

debug();
