// app.js – TẤT CẢ TRONG MỘT
// Login + Video Call + Firebase Auth + WebRTC
// ========================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js';

// === CẤU HÌNH FIREBASE ===
const firebaseConfig = {
  apiKey: "AIzaSyBM2VDBGfP3NQO4XHUvH3AksjtSDunyhus",
  authDomain: "ddsdcadc.firebaseapp.com",
  projectId: "ddsdcadc",
  storageBucket: "ddsdcadc.firebasestorage.app",
  messagingSenderId: "816654820680",
  appId: "1:816654820680:web:586f286cb42cba71afbf7d",
  measurementId: "G-32T5G1PV75"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// === BIẾN WEBRTC ===
let localVideo, remoteVideo, localStream, peerConnection, socket, isCallerGlobal = false;
const iceServers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

// ========================
// 1. TRANG ĐĂNG NHẬP (login.html)
// ========================
if (document.getElementById('loginForm')) {
  // Chuyển tab
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.form').forEach(f => f.classList.remove('active'));
      document.getElementById(tab + 'Form').classList.add('active');
    });
  });

  // Đăng nhập Email
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(['loginEmailError', 'loginPasswordError']);
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return showError('loginEmailError', 'Email không hợp lệ.');
    }
    if (!password) {
      return showError('loginPasswordError', 'Vui lòng nhập mật khẩu.');
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      handleAuthError(err, 'login');
    }
  });

  // Đăng ký
  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(['emailError', 'passwordError', 'confirmPasswordError']);
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const confirm = document.getElementById('confirmPassword').value;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return showError('emailError', 'Email không hợp lệ.');
    }
    if (password.length < 6) {
      return showError('passwordError', 'Mật khẩu phải ít nhất 6 ký tự.');
    }
    if (password !== confirm) {
      return showError('confirmPasswordError', 'Mật khẩu không khớp.');
    }

    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      handleAuthError(err, 'register');
    }
  });

  // Google Login
  document.getElementById('googleLogin').addEventListener('click', () => {
    signInWithPopup(auth, provider).catch(err => {
      if (err.code !== 'auth/popup-closed-by-user') {
        alert('Lỗi Google Login: ' + err.message);
      }
    });
  });
}

// ========================
// 2. TRANG VIDEO CALL (index.html)
// ========================
if (document.getElementById('goalInput')) {
  localVideo = document.getElementById("localVideo");
  remoteVideo = document.getElementById("remoteVideo");

  // Hiển thị thông tin người dùng
  onAuthStateChanged(auth, (user) => {
    if (user) {
      const name = user.displayName || user.email.split('@')[0];
      const photo = user.photoURL || 'https://via.placeholder.com/36?text=U';
      document.getElementById('userName').textContent = name;
      document.getElementById('userAvatar').src = photo;
    } else {
      window.location.href = '/login.html';
    }
  });

  // Đăng xuất
  document.getElementById('logoutBtn').addEventListener('click', () => {
    signOut(auth).then(() => {
      window.location.href = '/login.html';
    }).catch(err => {
      alert('Lỗi đăng xuất: ' + err.message);
    });
  });

  // Tìm người phù hợp
  window.findMatch = async function () {
  const goal = document.getElementById("goalInput").value.trim();
  if (!goal) return alert("Hãy nhập mục tiêu của bạn!");

  const user = auth.currentUser;
  if (!user) return alert("Bạn chưa đăng nhập!");

  const user_id = user.uid;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (err) {
    return alert("Không thể truy cập camera/micro.");
  }

  try {
    const res = await fetch("https://dotcool-back2.onrender.com/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, user_id }),
    });

    if (!res.ok) throw new Error("Lỗi server");
    const { roomId, isCaller } = await res.json();
    isCallerGlobal = isCaller;
    startWebRTC(isCaller, roomId);
  } catch (err) {
    alert("Không thể kết nối server. Vui lòng thử lại.");
  }
};

    // Bật camera
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
      console.log("Camera & mic đã bật");
    } catch (err) {
      console.error("Lỗi truy cập thiết bị:", err);
      return alert("Không thể truy cập camera/micro. Vui lòng cấp quyền.");
    }

    // Gửi yêu cầu match
    try {
      const res = await fetch("https://dotcool-back2.onrender.com/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, user_id }),
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Server error: ${res.status} - ${error}`);
      }

      const { roomId, isCaller } = await res.json();
      isCallerGlobal = isCaller;

      console.log(`Match thành công! Room: ${roomId} | Bạn là: ${isCaller ? "người gọi" : "người nhận"}`);
      startWebRTC(isCaller, roomId);

    } catch (err) {
      console.error("Lỗi kết nối server:", err);
      alert("Không thể kết nối đến server. Vui lòng thử lại sau.");
    }
  };

  // WebRTC
  function startWebRTC(isCaller, roomId) {
    // Đóng kết nối cũ nếu có
    if (peerConnection) peerConnection.close();
    if (socket) socket.close();

    peerConnection = new RTCPeerConnection(iceServers);

    // Thêm track từ localStream
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    // Nhận stream từ đối phương
    peerConnection.ontrack = (event) => {
      remoteVideo.srcObject = event.streams[0];
      console.log("Nhận được video từ đối phương");
    };

    peerConnection.onconnectionstatechange = () => {
      console.log("Trạng thái kết nối:", peerConnection.connectionState);
      if (peerConnection.connectionState === "failed") {
        alert("Kết nối thất bại. Đang tìm người mới...");
        resetCall();
      }
    };

    // Kết nối WebSocket
    const wsUrl = `wss://dotcool-back2.onrender.com/ws?roomId=${roomId}`;
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log("WebSocket kết nối thành công");
    };

    socket.onmessage = async ({ data }) => {
      try {
        const msg = JSON.parse(data);

        if (msg.ready && isCallerGlobal) {
          // Caller tạo offer
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          socket.send(JSON.stringify({ offer }));
          console.log("Đã gửi offer");
        }

        if (msg.offer && !isCallerGlobal) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.offer));
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          socket.send(JSON.stringify({ answer }));
          console.log("Đã gửi answer");
        }

        if (msg.answer) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.answer));
          console.log("Đã nhận answer");
        }

        if (msg.iceCandidate) {
          try {
            await peerConnection.addIceCandidate(msg.iceCandidate);
          } catch (err) {
            console.error("Lỗi ICE candidate:", err);
          }
        }
      } catch (err) {
        console.error("Lỗi xử lý message:", err);
      }
    };

    // Gửi ICE candidate
    peerConnection.onicecandidate = ({ candidate }) => {
      if (candidate && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ iceCandidate: candidate }));
      }
    };

    socket.onclose = () => {
      console.log("WebSocket đóng");
      alert("Đối phương đã rời cuộc gọi. Đang tìm người mới...");
      resetCall();
    };

    socket.onerror = (err) => {
      console.error("WebSocket lỗi:", err);
    };
  }

  // Reset khi kết thúc cuộc gọi
  function resetCall() {
    if (socket) socket.close();
    if (peerConnection) peerConnection.close();
    socket = null;
    peerConnection = null;
    setTimeout(() => {
      document.getElementById("goalInput").value = "";
      alert("Sẵn sàng tìm người mới!");
    }, 1000);
  }

  // Dọn dẹp khi rời trang
  window.addEventListener('beforeunload', () => {
    if (socket) socket.close();
    if (peerConnection) peerConnection.close();
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
  });
}

// ========================
// HÀM HỖ TRỢ
// ========================
function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
}

function clearErrors(ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = '';
      el.style.display = 'none';
    }
  });
}

function handleAuthError(err, type) {
  const code = err.code;
  if (code === 'auth/email-already-in-use') {
    showError('emailError', 'Email này đã được sử dụng.');
  } else if (code === 'auth/weak-password') {
    showError('passwordError', 'Mật khẩu quá yếu (ít nhất 6 ký tự).');
  } else if (code === 'auth/user-not-found' || code === 'auth/wrong-password') {
    showError('loginPasswordError', 'Email hoặc mật khẩu không đúng.');
  } else if (code === 'auth/too-many-requests') {
    alert('Quá nhiều lần thử. Vui lòng thử lại sau 1 phút.');
  } else {
    alert('Lỗi: ' + err.message);
  }
}

// === CHUYỂN HƯỚNG THEO TRẠNG THÁI ===
onAuthStateChanged(auth, (user) => {
  const isLoginPage = window.location.pathname.includes('login.html');
  const isVideoPage = window.location.pathname.includes('index.html') || window.location.pathname === '/';

  if (user && isLoginPage) {
    window.location.replace('/index.html');
  } else if (!user && isVideoPage) {
    window.location.replace('/login.html');
  }
});
