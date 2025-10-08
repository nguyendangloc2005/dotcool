const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
let localStream;
let peerConnection;
let socket;

// TURN + STUN servers
const iceServers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: [
        "turn:relay1.expressturn.com:3478",
        "turns:relay1.expressturn.com:5349",
      ],
      username: "ef5e8e68f7b4f0d0b7360b33",
      credential: "aS7uKzEot0z+9P5y",
    },
  ],
};

async function findMatch() {
  const goal = document.getElementById("goalInput").value.trim();
  if (!goal) return alert("Hãy nhập mục tiêu của bạn.");

  try {
    // Truy cập camera/mic
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (err) {
    return alert("Không thể truy cập camera/micro: " + err.message);
  }

  try {
    // Gọi API backend
    const response = await fetch("https://dotcool-back2.onrender.com/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal }),
    });

    const { roomId, isCaller } = await response.json();
    console.log(`🎯 Kết nối với room: ${roomId} | Caller: ${isCaller}`);
    startWebRTC(isCaller, roomId);
  } catch (err) {
    console.error("❌ Lỗi khi tìm match:", err);
  }
}

async function startWebRTC(isCaller, roomId) {
  peerConnection = new RTCPeerConnection(iceServers);

  // Gửi local stream lên
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  // Nhận luồng từ bên kia
  peerConnection.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
    console.log("📺 Nhận video từ đối phương");
  };

  // ICE candidate
  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ iceCandidate: candidate }));
      console.log("📤 Gửi ICE candidate");
    }
  };

  // ICE status debug
  peerConnection.onconnectionstatechange = () => {
    console.log("🌐 ICE state:", peerConnection.connectionState);
  };

  // Kết nối WebSocket
  socket = new WebSocket(`wss://dotcool-back2.onrender.com/ws?roomId=${roomId}`);

  socket.onopen = async () => {
    console.log("✅ WebSocket đã kết nối");

    // Delay nhỏ để đảm bảo 2 bên sẵn sàng
    setTimeout(async () => {
      if (isCaller) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.send(JSON.stringify({ offer }));
        console.log("📤 Gửi offer");
      }
    }, 1500);
  };

  socket.onmessage = async ({ data }) => {
    const msg = JSON.parse(data);

    if (msg.offer) {
      console.log("📩 Nhận offer");
      await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.send(JSON.stringify({ answer }));
      console.log("📤 Gửi answer");
    } else if (msg.answer) {
      console.log("📩 Nhận answer");
      await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.answer));
    } else if (msg.iceCandidate) {
      try {
        await peerConnection.addIceCandidate(msg.iceCandidate);
        console.log("✅ Thêm ICE candidate");
      } catch (err) {
        console.error("⚠️ Lỗi ICE:", err);
      }
    }
  };

  socket.onclose = () => console.log("❌ WebSocket đóng kết nối");
  socket.onerror = err => console.error("⚠️ Lỗi WebSocket:", err);
}
