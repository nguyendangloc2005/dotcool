// server.js
const http = require("http");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const rooms = {}; // { goal: { roomId, clients: [] } }

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      // Khi client gửi { goal }
      if (data.goal) {
        let goalRoom = Object.values(rooms).find(
          (r) => r.goal === data.goal && r.clients.length < 2
        );

        if (!goalRoom) {
          const newRoomId = uuidv4();
          rooms[newRoomId] = { goal: data.goal, clients: [ws] };
          ws.roomId = newRoomId;
          ws.isCaller = true;
          console.log(`🆕 Created new room for goal "${data.goal}": ${newRoomId}`);
        } else {
          goalRoom.clients.push(ws);
          ws.roomId = Object.keys(rooms).find((id) => rooms[id] === goalRoom);
          ws.isCaller = false;
          console.log(`🔁 Found waiting room for goal "${data.goal}": ${ws.roomId}`);
        }

        ws.send(JSON.stringify({
          type: "joined",
          roomId: ws.roomId,
          isCaller: ws.isCaller
        }));

        console.log(`✅ New connection to room: ${ws.roomId}`);
        console.log(`👥 Clients in room ${ws.roomId}: ${rooms[ws.roomId].clients.length}`);
        return;
      }

      // Truyền tín hiệu WebRTC giữa 2 client trong cùng room
      const room = rooms[ws.roomId];
      if (room && room.clients.length === 2) {
        room.clients.forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(msg);
          }
        });
      }

    } catch (err) {
      console.error("❌ Error:", err);
    }
  });

  ws.on("close", () => {
    const roomId = ws.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].clients = rooms[roomId].clients.filter(c => c !== ws);
      console.log(`❌ Client left room ${roomId}`);
      if (rooms[roomId].clients.length === 0) {
        delete rooms[roomId];
        console.log(`🗑️ Room deleted: ${roomId}`);
      }
    }
  });
});

server.listen(10000, () => {
  console.log("✅ Backend WebSocket server running on port 10000");
});
