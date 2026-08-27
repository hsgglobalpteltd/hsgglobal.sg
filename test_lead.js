import https from 'https';

const postData = JSON.stringify({
  name: 'Test Prospect Australia',
  company: 'Sydney Food Importers',
  email: 'sales@hsg-global.com',
  phone: '+61 412 345 678',
  inquiry_type: 'Looking to Import Asian Products',
  message: 'Testing live exhibitor lead flow',
  is_dev_mode: true,
  client_origin: 'http://localhost:5176'
});

const req = https.request('https://ib-v2.hsgglobalpteltd.workers.dev/api/exhibitor/submit-lead', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
}, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('STATUS:', res.statusCode);
    console.log('RESPONSE:', data);
  });
});

req.on('error', (e) => {
  console.error('ERROR:', e.message);
});

req.write(postData);
req.end();
