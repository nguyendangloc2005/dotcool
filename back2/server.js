const express = require("express");
const http = require("http");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const WebSocket = require("ws");

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 10000;

// Map: roomId -> array of clients
const rooms = {};
// Map: goal -> waiting roomId
const waitingRooms = {};

// HTTP endpoint để match người dùng
app.post("/match", (req, res) => {
  const { goal } = req.body;

  if (!goal) return res.status(400).json({ error: "Missing goal" });

  let roomId;

  if (waitingRooms[goal] && rooms[waitingRooms[goal]].length < 2) {
    roomId = waitingRooms[goal];
    console.log(`🔁 Found waiting room for goal "${goal}": ${roomId}`);
  } else {
    roomId = uuidv4();
    waitingRooms[goal] = roomId;
    rooms[roomId] = [];
    console.log(`🆕 Created new room for goal "${goal}": ${roomId}`);
  }

  res.json({ roomId });
});

// WebSocket signaling server
wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === "join") {
        const { roomId } = data;
        if (!rooms[roomId]) rooms[roomId] = [];

        ws.roomId = roomId;
        rooms[roomId].push(ws);
        console.log(`✅ New connection, room: ${roomId}`);
        console.log(`👥 Clients in room ${roomId}: ${rooms[roomId].length}`);

        // Nếu đủ 2 người → gửi tín hiệu bắt đầu kết nối
        if (rooms[roomId].length === 2) {
          rooms[roomId].forEach((client, index) => {
            client.send(JSON.stringify({ type: "ready", isCaller: index === 0 }));
          });
        }
      }

      // relay offer/answer/ice
      else if (["offer", "answer", "ice"].includes(data.type)) {
        const roomId = ws.roomId;
        if (!roomId || !rooms[roomId]) return;

        rooms[roomId].forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
          }
        });
      }
    } catch (err) {
      console.error("❌ WS message error:", err);
    }
  });

  ws.on("close", () => {
    const { roomId } = ws;
    if (roomId && rooms[roomId]) {
      rooms[roomId] = rooms[roomId].filter((c) => c !== ws);
      console.log(`❌ Client left room ${roomId}`);

      if (rooms[roomId].length === 0) {
        delete rooms[roomId];
        console.log(`🗑️ Room deleted: ${roomId}`);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Backend WebSocket server running on port ${PORT}`);
});
