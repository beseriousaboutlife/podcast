import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

export class SocketService {
  private socket: Socket | null = null;
  private static instance: SocketService;

  static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService();
    }
    return SocketService.instance;
  }

  connect(): Socket {
    if (!this.socket) {
      const token = localStorage.getItem('token');
      this.socket = io(SOCKET_URL, {
        auth: {
          token,
        },
        transports: ['websocket', 'polling'],
      });

      this.socket.on('connect', () => {
        console.log('Connected to server');
      });

      this.socket.on('disconnect', () => {
        console.log('Disconnected from server');
      });

      this.socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
      });
    }

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  // Meeting room methods
  joinRoom(meetingKey: string, userInfo: any) {
    this.socket?.emit('join-room', { meetingKey, userInfo });
  }

  leaveRoom(meetingKey: string) {
    this.socket?.emit('leave-room', { meetingKey });
  }

  sendMessage(meetingKey: string, message: string) {
    this.socket?.emit('chat-message', { meetingKey, message });
  }

  // WebRTC signaling
  sendOffer(meetingKey: string, offer: RTCSessionDescriptionInit, to: string) {
    this.socket?.emit('webrtc-offer', { meetingKey, offer, to });
  }

  sendAnswer(meetingKey: string, answer: RTCSessionDescriptionInit, to: string) {
    this.socket?.emit('webrtc-answer', { meetingKey, answer, to });
  }

  sendIceCandidate(meetingKey: string, candidate: RTCIceCandidate, to: string) {
    this.socket?.emit('webrtc-ice-candidate', { meetingKey, candidate, to });
  }

  // Screen sharing
  startScreenShare(meetingKey: string) {
    this.socket?.emit('start-screen-share', { meetingKey });
  }

  stopScreenShare(meetingKey: string) {
    this.socket?.emit('stop-screen-share', { meetingKey });
  }

  // Recording
  startRecording(meetingKey: string) {
    this.socket?.emit('start-recording', { meetingKey });
  }

  stopRecording(meetingKey: string) {
    this.socket?.emit('stop-recording', { meetingKey });
  }
}

export const socketService = SocketService.getInstance();