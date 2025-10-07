const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
let localStream, peerConnection, socket;

// STUN + TURN server đáng tin cậy
const iceServers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: ["turn:relay1.expressturn.com:3478", "turns:relay1.expressturn.com:5349"],
      username: "ef5e8e68f7b4f0d0b7360b33",
      credential: "aS7uKzEot0z+9P5y",
    },
  ],
};

async function findMatch() {
  const goal = document.getElementById("goalInput").value.trim();
  if (!goal) return alert("Nhập mục tiêu");

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    localVideo.play();
  } catch (err) {
    return alert("Không truy cập cam/mic: " + err.message);
  }

  const resp = await fetch("https://dotcool-back2.onrender.com/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal }),
  });
  const { roomId, isCaller } = await resp.json();
  startWebRTC(isCaller, roomId);
}

async function startWebRTC(isCaller, roomId) {
  peerConnection = new RTCPeerConnection(iceServers);

  // thêm track local
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  // nhận track remote
  peerConnection.ontrack = e => {
    remoteVideo.srcObject = e.streams[0];
    remoteVideo.play();
  };

  // ICE candidate
  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ iceCandidate: candidate }));
    }
  };

  // Log trạng thái kết nối
  peerConnection.oniceconnectionstatechange = () =>
    console.log("ICE state:", peerConnection.iceConnectionState);
  peerConnection.onconnectionstatechange = () =>
    console.log("Connection state:", peerConnection.connectionState);

  // WebSocket signaling
  socket = new WebSocket(`wss://dotcool-back2.onrender.com/ws?roomId=${roomId}`);

  socket.onopen = async () => {
    if (isCaller) {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.send(JSON.stringify({ offer }));
    }
  };

  socket.onmessage = async ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.offer) {
      await peerConnection.setRemoteDescription(msg.offer);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.send(JSON.stringify({ answer }));
    } else if (msg.answer) {
      await peerConnection.setRemoteDescription(msg.answer);
    } else if (msg.iceCandidate) {
      await peerConnection.addIceCandidate(msg.iceCandidate);
    }
  };
}
