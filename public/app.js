const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
let localStream, peerConnection, socket;

// STUN + TURN server
const iceServers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: ["turn:relay1.expressturn.com:3478", "turns:relay1.expressturn.com:5349"],
      username: "ef5e8e68f7b4f0d0b7360b33",
      credential: "aS7uKzEot0z+9P5y",
    },
  ],
};

async function findMatch() {
  const goal = document.getElementById("goalInput").value.trim();
  if (!goal) return alert("Hãy nhập mục tiêu của bạn.");

  // Lấy media local
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    localVideo.play();
  } catch (err) {
    return alert("Không thể truy cập camera/micro: " + err.message);
  }

  // Gọi API match
  const response = await fetch("https://dotcool-back2.onrender.com/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal }),
  });
  const data = await response.json();

  const roomId = data.roomId;
  const isCaller = data.isCaller;
  console.log(`🎯 Kết nối với room: ${roomId} | Caller: ${isCaller}`);
  startWebRTC(isCaller, roomId);
}

async function startWebRTC(isCaller, roomId) {
  peerConnection = new RTCPeerConnection(iceServers);

  // Thêm track vào peerConnection
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  // Nhận track từ peer
  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    remoteVideo.play();
  };

  // ICE candidate
  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ iceCandidate: candidate }));
      console.log("📤 Gửi ICE candidate");
    }
  };

  // WebSocket signaling
  socket = new WebSocket(`wss://dotcool-back2.onrender.com/ws?roomId=${roomId}`);

  socket.onopen = async () => {
    console.log("✅ WebSocket đã kết nối");
    if (isCaller) {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.send(JSON.stringify({ offer }));
      console.log("📤 Gửi offer");
    }
  };

  socket.onmessage = async ({ data }) => {
    const msg = JSON.parse(data);

    if (msg.offer) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.send(JSON.stringify({ answer }));
      console.log("📤 Gửi answer");
    } else if (msg.answer) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.answer));
      console.log("📩 Nhận answer");
    } else if (msg.iceCandidate) {
      try {
        await peerConnection.addIceCandidate(msg.iceCandidate);
        console.log("📩 Nhận ICE candidate");
      } catch (err) {
        console.error("Lỗi ICE:", err);
      }
    }
  };

  socket.onclose = () => console.log("❌ WebSocket đóng");
  socket.onerror = err => console.error("⚠️ WebSocket error:", err);
}
