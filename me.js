import fetch from 'node-fetch';
import t from "@babel/types";
import { webcrack } from 'webcrack';
import vm from 'node:vm';
import cors from 'cors';
import express from 'express';

const HOST = 'vidsrc.xyz';
const ALT_HOSTS = [HOST, 'vidsrc.me', 'vidsrc.net'];
const SERVERS = [];
const ID = "VDM";
const REFERER = `http://${HOST}`;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36';
let js_context = vm.createContext(globalThis);

async function fetchReferer(url, args = { headers: {} }) {
  if (args.headers == undefined)
    args.headers = {};
  if (args.headers['Referer'] == undefined && args.headers['Referer'] != "")
    args.headers['Referer'] = REFERER;
  args.headers['User-Agent'] = USER_AGENT;
  return fetch(url, args);
}

function dec(input) {
  const reversed = input.split("").reverse().join("");
  let result = "";
  for (let i = 0; i < reversed.length; i++) {
    result += String.fromCharCode(reversed.charCodeAt(i) - 1);
  }
  let result2 = "";
  for (let i = 0; i < result.length; i += 2) {
    result2 += String.fromCharCode(parseInt(result.substr(i, 2), 16));
  }
  return result2;
}

async function episode(data_id, _server) {
  const url = `https://${HOST}/embed/${data_id}`;
  console.debug(ID, url);
  const res = await (await fetchReferer(url)).text();
  const url2 = 'https:' + (/id="player_iframe" src="(.*?)"/gm).exec(res)[1].trim();
  console.debug(ID, url2);
  const res2 = await (await fetchReferer(url2)).text();
  console.debug(ID, res2);
  const host = (new URL(url2)).host;
  const srcrcpLink = /src:\s*'(.*?)'/gm.exec(res2)[1];
  console.debug(ID, srcrcpLink);
  const url3 = `https://${host}${srcrcpLink}`;
  console.debug(ID, url3);
  const res3 = await (await fetch(url3)).text();
  const [, enc_url] = (/<div id=".*?" style="display:none;">(.*?)<\/div>/gm).exec(res3);
  const script_url = `https://${host}` + (/<script src="(.{20,}\.js\?_=.*?)"/gm).exec(res3)[1];
  console.debug(ID, script_url);
  let script = "";
  for (let i = 0; i < 3; i++) {
    const res_script = await fetchReferer(script_url);
    if (res_script.status != 200)
      continue;
    script = await (res_script).text();
  }
  const [_, script_id] = /window\[bMGyx71TzQLfdonN\(["'](.*?)["'].*innerHTML\);$/gm.exec(script);
  const new_script = (await webcrack(script, { mangle: false })).code;
  try {
    vm.runInContext(new_script, js_context);
  } catch (e) {
    console.error(ID, 'Error running script in context:', e);
  }
  const dec_url = vm.runInContext(`${script_id}('${enc_url}')`, js_context);
  console.debug(ID, dec_url)
  return { stream: dec_url };
}

async function movie(id, _server) {
  console.debug(ID, id);
  return episode(id, _server);
}

async function tv(id, s = 1, e = 1, _server) {
  console.debug(ID, id);
  return episode(`${id}/${s}-${e}`, _server);
}

async function test() {
  try {
    const tests = [movie("tt1300854")];
    const results = await Promise.all(tests);
    for (const r of results) {
      if (typeof r !== 'object' || r === null)
        throw `${JSON.stringify(r)} is not json`;
      console.debug(ID, JSON.stringify(r));
    }
    console.log(ID, `${HOST} passed the tests`);
    return { status: 'success', message: `${HOST} passed the tests` };
  } catch (e) {
    console.error(ID, `${HOST} failed the tests`, e);
    return { status: 'error', message: `${HOST} failed the tests: ${e.message || e}` };
  }
}

const app = express();
app.use(cors());

app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.get('/movie/:id', async (req, res) => {
  try {
    const result = await movie(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'An error occurred', message: error.message });
  }
});

app.get('/tv/:id/:season/:episode', async (req, res) => {
  try {
    const result = await tv(req.params.id, parseInt(req.params.season), parseInt(req.params.episode));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'An error occurred', message: error.message });
  }
});

app.get('/test', async (req, res) => {
  const testResult = await test();
  res.json(testResult);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
