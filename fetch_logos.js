const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const logos = [
  { file: 'retailers/retailer-fairprice.svg', url: 'https://upload.wikimedia.org/wikipedia/commons/4/4e/NTUC_FairPrice_logo.svg' },
  { file: 'retailers/retailer-shengsiong.png', url: 'https://upload.wikimedia.org/wikipedia/en/thumb/0/03/Sheng_Siong_logo.svg/512px-Sheng_Siong_logo.svg.png' },
  { file: 'retailers/retailer-coldstorage.svg', url: 'https://upload.wikimedia.org/wikipedia/en/2/23/Cold_Storage_%28supermarket%29_logo.svg' },
  { file: 'retailers/retailer-giant.svg', url: 'https://upload.wikimedia.org/wikipedia/commons/0/07/Giant_Hypermarket_logo.svg' },
  { file: 'retailers/retailer-shell.svg', url: 'https://upload.wikimedia.org/wikipedia/en/e/e8/Shell_logo.svg' },
  { file: 'retailers/retailer-cheers.png', url: 'https://upload.wikimedia.org/wikipedia/en/thumb/9/90/Cheers_convenience_store_logo.png/320px-Cheers_convenience_store_logo.png' },
  { file: 'retailers/retailer-spc.png', url: 'https://upload.wikimedia.org/wikipedia/en/thumb/5/52/Singapore_Petroleum_Company_logo.svg/512px-Singapore_Petroleum_Company_logo.svg.png' },
  { file: 'retailers/retailer-esso.svg', url: 'https://upload.wikimedia.org/wikipedia/commons/0/04/Esso_logo.svg' },
  { file: 'brands/brand-bibik-express.jpg', url: 'https://ib.hsgglobalpteltd.workers.dev/api/files/1783253457536_BAWANG_BESAR_BB.jpg' },
  { file: 'brands/brand-pak-man.jpg', url: 'https://ib.hsgglobalpteltd.workers.dev/api/files/1783253547696_Pes_Asam_Pedas_E.jpg' },
  { file: 'brands/brand-hausboom.png', url: 'https://i.imgur.com/bpZzGUn.png' },
  { file: 'brands/brand-boom-plus.jpeg', url: 'https://i.imgur.com/CxUtC7b.jpeg' },
  { file: 'brands/brand-supergulp.jpeg', url: 'https://i.imgur.com/J76t3XK.jpeg' },
  { file: 'brands/brand-dapur-malai.jpeg', url: 'https://i.imgur.com/t8rgfrU.jpeg' },
  { file: 'brands/brand-noi-kassim.jpeg', url: 'https://i.imgur.com/x4F87mK.jpeg' },
  { file: 'brands/brand-selera-rasa.jpeg', url: 'https://i.imgur.com/nUQp1iK.jpeg' }
];

function download(url, dest) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest).then(resolve);
      }
      if (res.statusCode !== 200) {
        console.log(`Failed ${url}: Status ${res.statusCode}`);
        return resolve(false);
      }
      const fileStream = fs.createWriteStream(dest);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`Downloaded: ${path.basename(dest)}`);
        resolve(true);
      });
    });
    req.on('error', (err) => {
      console.log(`Error ${url}: ${err.message}`);
      resolve(false);
    });
  });
}

async function run() {
  const baseDir = 'c:/Users/User/Desktop/iB/Project6/public/assets';
  for (const item of logos) {
    const dest = path.join(baseDir, item.file);
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await download(item.url, dest);
  }
}

run();
