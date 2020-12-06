const CANVAS_X = 300;
const CANVAS_Y = 450;
const COOLDOWN_MS = 10000;

const fs = require('fs');
const https = require('https');
const WebSocket = require('ws');
const jwt = require('./util/jwt_helper');
const db = require('./util/db_helper')
const logic = require('./util/logic')

db.createTables();

const server = https.createServer({
  cert: fs.readFileSync('./cert/server.crt'),
  key: fs.readFileSync('./cert/server.key')
}).listen(8989);

const wss = new WebSocket.Server({ server });
const canvas = db.loadCanvasFromDB(CANVAS_X, CANVAS_Y);

const broadcast = (data, ws) => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client !== ws) {
      client.send(JSON.stringify(data));
    }
  });
};

wss.on('connection', (ws, req) => {
  let userInfo = null;

  ws.send(JSON.stringify({
    type: 'LOAD_CANVAS',
    message: { x: CANVAS_X, y: CANVAS_Y, canvas: Array.from(canvas) },
  }));

  ws.on('message', (message) => {
    const data = JSON.parse(message);
    switch (data.type) {
      case 'SET_PIXEL':
        setPixel(data, ws, userInfo)
        break;
      case 'AUTHENTICATE':
        userInfo = authenticate(data, userInfo, ws);
        break;
      case 'PURCHASE':
        purchase(data, userInfo, ws)
        break;
      default:
        break;
    }
  });
});

function setPixel(data, ws, userInfo) {
  const x = data.payload.x;
  const y = data.payload.y;
  const color = data.payload.color;

  if (!logic.pixelInsertIsValid(userInfo, x, y, CANVAS_X, CANVAS_Y)) return;

  const value = (CANVAS_Y * (x + 1)) - CANVAS_Y + y;
  canvas[value] = color;
  db.addPixelToDB(x, y, color, userInfo.userId)

  broadcast({
    type: 'SET_PIXEL',
    message: data.payload,
  }, ws);

  userInfo.cooldown = Date.now() + COOLDOWN_MS;
  ws.send(JSON.stringify({
    type: 'USER_INFO',
    message: userInfo
  }));
}

function authenticate(data, userInfo, ws) {
  const session = jwt.from(data.payload.token);
  userInfo = logic.getUserInfo(session);

  console.log(userInfo);

  ws.send(JSON.stringify({
    type: 'USER_INFO',
    message: userInfo
  }));

  return userInfo
}

function purchase(data, userInfo, ws) {
  const receipt = jwt.from(data.payload.transaction.transactionReceipt);
  const transactionId = receipt.data.transactionId;
  const time = receipt.data.time;
  const sku = receipt.data.product.sku;
  const amount = receipt.data.product.cost.amount;
  const uid = userInfo.userId;

  console.log(receipt);

  userInfo.purchasedPixels += amount;
  logic.processPurchase(transactionId, uid, time, sku, amount)

  ws.send(JSON.stringify({
    type: 'USER_INFO',
    message: userInfo
  }));

  return userInfo;
}