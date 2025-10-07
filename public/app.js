// frontend/app.js
const goal = prompt("Nhập mục tiêu để kết nối:");
const socket = new WebSocket("wss://dotcool-back2.onrender.com");
let peerConnection;
let localStream;
const pendingCandidates = [];

const servers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:relay1.expressturn.com:3478",
      username: "efree",
      credential: "efree",
    },
  ],
};

socket.onopen = () => {
  console.log("✅ WebSocket đã kết nối");
  socket.send(JSON.stringify({ goal }));
};

socket.onmessage = async (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "joined") {
    console.log(`🎯 Kết nối với room: ${msg.roomId} | Caller: ${msg.isCaller}`);
    await startCall(msg.isCaller);
  } else if (msg.offer) {
    console.log("📩 Nhận offer");
    await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.send(JSON.stringify({ answer }));
    console.log("📤 Gửi answer");
    while (pendingCandidates.length) {
      await peerConnection.addIceCandidate(pendingCandidates.shift());
    }
  } else if (msg.answer) {
    console.log("📩 Nhận answer");
    await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.answer));
  } else if (msg.iceCandidate) {
    console.log("📩 Nhận ICE candidate");
    if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
      await peerConnection
        .addIceCandidate(msg.iceCandidate)
        .catch((err) => console.error("Lỗi ICE:", err));
    } else {
      pendingCandidates.push(msg.iceCandidate);
    }
  }
};

async function startCall(isCaller) {
  peerConnection = new RTCPeerConnection(servers);

  // Lấy camera + mic
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  document.getElementById("localVideo").srcObject = localStream;
  localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));

  peerConnection.ontrack = (event) => {
    document.getElementById("remoteVideo").srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.send(JSON.stringify({ iceCandidate: event.candidate }));
      console.log("📤 Gửi ICE candidate");
    }
  };

  if (isCaller) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.send(JSON.stringify({ offer }));
    console.log("📤 Gửi offer");
  }
}
