const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
let localStream;
let peerConnection;
let socket;

// TURN + STUN server (public config)
const iceServers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: [
        "turn:relay1.expressturn.com:3478",
        "turns:relay1.expressturn.com:5349"
      ],
      username: "ef5e8e68f7b4f0d0b7360b33",
      credential: "aS7uKzEot0z+9P5y",
    },
  ],
};

async function findMatch() {
  const goal = document.getElementById("goalInput").value.trim();
  if (!goal) {
    alert("Hãy nhập mục tiêu của bạn.");
    return;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (err) {
    alert("Không thể truy cập camera/micro: " + err.message);
    return;
  }

  try {
    const response = await fetch("https://dotcool-back2.onrender.com/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal }),
    });

    const data = await response.json();
    const { roomId, isCaller } = data;

    console.log(`🎯 Kết nối với room: ${roomId} | Caller: ${isCaller}`);
    startWebRTC(isCaller, roomId);
  } catch (err) {
    console.error("❌ Lỗi khi tìm match:", err);
  }
}

async function startWebRTC(isCaller, roomId) {
  peerConnection = new RTCPeerConnection(iceServers);

  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  peerConnection.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
  };

  // WebSocket signaling
  socket = new WebSocket(`wss://dotcool-back2.onrender.com/ws?roomId=${roomId}`);

  socket.onopen = async () => {
    console.log("✅ WebSocket đã kết nối");

    if (isCaller) {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      console.log("📤 Gửi offer");
      socket.send(JSON.stringify({ offer }));
    }
  };

  socket.onmessage = async ({ data }) => {
    const msg = JSON.parse(data);

    if (msg.offer) {
      console.log("📩 Nhận offer");
      await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      console.log("📤 Gửi answer");
      socket.send(JSON.stringify({ answer }));
    } else if (msg.answer) {
      console.log("📩 Nhận answer");
      await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.answer));
    } else if (msg.iceCandidate) {
      console.log("📩 Nhận ICE candidate");
      try {
        await peerConnection.addIceCandidate(msg.iceCandidate);
      } catch (err) {
        console.error("Lỗi ICE:", err);
      }
    }
  };

  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate && socket.readyState === WebSocket.OPEN) {
      console.log("📤 Gửi ICE candidate");
      socket.send(JSON.stringify({ iceCandidate: candidate }));
    }
  };

  socket.onclose = () => console.log("❌ WebSocket đóng kết nối");
  socket.onerror = err => console.error("⚠️ Lỗi WebSocket:", err);
}
