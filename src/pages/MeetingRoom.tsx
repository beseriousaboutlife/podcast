import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Mic, MicOff, Video, VideoOff, Phone, PhoneOff, Monitor, 
  MessageSquare, Users, Settings, MoreVertical, Copy, 
  Maximize2, Minimize2
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { socketService } from '../services/socket';
import { api } from '../services/api';
import toast from 'react-hot-toast';

interface Participant {
  userId: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
  socketId: string;
  stream?: MediaStream;
  audioEnabled: boolean;
  videoEnabled: boolean;
  isScreenSharing?: boolean;
}

interface ChatMessage {
  message: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
  timestamp: string;
}

interface Meeting {
  id: string;
  name: string;
  meeting_key: string;
  host_id: string;
  host_name: string;
  created_at: string;
}

export default function MeetingRoom() {
  const { meetingKey } = useParams<{ meetingKey: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  // State
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [participants, setParticipants] = useState<Map<string, Participant>>(new Map());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideosRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const chatEndRef = useRef<HTMLDivElement>(null);

  // WebRTC configuration
  const rtcConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  useEffect(() => {
    if (!meetingKey || !user) return;

    initializeMeeting();
    return () => {
      cleanup();
    };
  }, [meetingKey, user]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const initializeMeeting = async () => {
    try {
      // Get meeting details
      const meetingData = await api.getMeeting(meetingKey!);
      setMeeting(meetingData);

      // Initialize media
      await initializeMedia();

      // Connect to socket
      const socket = socketService.connect();
      setupSocketListeners(socket);

      // Join room
      socketService.joinRoom(meetingKey!, {
        userId: user?.id,
        user: {
          id: user?.id,
          name: user?.name,
          email: user?.email,
        },
        audioEnabled: isAudioEnabled,
        videoEnabled: isVideoEnabled,
      });

      setConnectionStatus('connected');
    } catch (error) {
      console.error('Failed to initialize meeting:', error);
      toast.error('Failed to join meeting');
      navigate('/dashboard');
    }
  };

  const initializeMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      setLocalStream(stream);
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Failed to get user media:', error);
      toast.error('Could not access camera/microphone');
    }
  };

  const setupSocketListeners = (socket: any) => {
    socket.on('room-users', (users: Participant[]) => {
      const participantsMap = new Map();
      users.forEach(participant => {
        if (participant.userId !== user?.id) {
          participantsMap.set(participant.socketId, participant);
          createPeerConnection(participant.socketId, true);
        }
      });
      setParticipants(participantsMap);
    });

    socket.on('user-joined', (participant: Participant) => {
      if (participant.userId !== user?.id) {
        setParticipants(prev => new Map(prev.set(participant.socketId, participant)));
        createPeerConnection(participant.socketId, true);
      }
    });

    socket.on('user-left', ({ socketId }: { socketId: string }) => {
      setParticipants(prev => {
        const newMap = new Map(prev);
        newMap.delete(socketId);
        return newMap;
      });
      
      // Clean up peer connection
      const pc = peerConnectionsRef.current.get(socketId);
      if (pc) {
        pc.close();
        peerConnectionsRef.current.delete(socketId);
      }
    });

    socket.on('webrtc-offer', async ({ offer, from, userId }) => {
      await handleOffer(offer, from, userId);
    });

    socket.on('webrtc-answer', async ({ answer, from }) => {
      await handleAnswer(answer, from);
    });

    socket.on('webrtc-ice-candidate', async ({ candidate, from }) => {
      await handleIceCandidate(candidate, from);
    });

    socket.on('chat-message', (message: ChatMessage) => {
      setChatMessages(prev => [...prev, message]);
    });

    socket.on('recording-started', ({ user: recordingUser }) => {
      setIsRecording(true);
      toast.success(`${recordingUser.name} started recording`);
    });

    socket.on('recording-stopped', ({ user: recordingUser }) => {
      setIsRecording(false);
      toast.success(`${recordingUser.name} stopped recording`);
    });

    socket.on('user-started-screen-share', ({ userId, socketId }) => {
      setParticipants(prev => {
        const newMap = new Map(prev);
        const participant = newMap.get(socketId);
        if (participant) {
          participant.isScreenSharing = true;
          newMap.set(socketId, participant);
        }
        return newMap;
      });
    });

    socket.on('user-stopped-screen-share', ({ userId, socketId }) => {
      setParticipants(prev => {
        const newMap = new Map(prev);
        const participant = newMap.get(socketId);
        if (participant) {
          participant.isScreenSharing = false;
          newMap.set(socketId, participant);
        }
        return newMap;
      });
    });

    socket.on('error', ({ message }) => {
      toast.error(message);
    });
  };

  const createPeerConnection = async (socketId: string, isInitiator = false) => {
    const pc = new RTCPeerConnection(rtcConfiguration);
    peerConnectionsRef.current.set(socketId, pc);

    // Add local stream
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    // Handle remote stream
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      const videoElement = remoteVideosRef.current.get(socketId);
      if (videoElement) {
        videoElement.srcObject = remoteStream;
      }

      // Update participant with stream info
      setParticipants(prev => {
        const newMap = new Map(prev);
        const participant = newMap.get(socketId);
        if (participant) {
          participant.stream = remoteStream;
          newMap.set(socketId, participant);
        }
        return newMap;
      });
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketService.sendIceCandidate(meetingKey!, event.candidate, socketId);
      }
    };

    // Create offer if initiator
    if (isInitiator) {
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await pc.setLocalDescription(offer);
        socketService.sendOffer(meetingKey!, offer, socketId);
      } catch (error) {
        console.error('Error creating offer:', error);
      }
    }

    return pc;
  };

  const handleOffer = async (offer: RTCSessionDescriptionInit, from: string, userId: string) => {
    try {
      let pc = peerConnectionsRef.current.get(from);
      if (!pc) {
        pc = await createPeerConnection(from, false);
      }
      
      await pc.setRemoteDescription(offer);
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      socketService.sendAnswer(meetingKey!, answer, from);
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  };

  const handleAnswer = async (answer: RTCSessionDescriptionInit, from: string) => {
    try {
      const pc = peerConnectionsRef.current.get(from);
      if (pc) {
        await pc.setRemoteDescription(answer);
      }
    } catch (error) {
      console.error('Error handling answer:', error);
    }
  };

  const handleIceCandidate = async (candidate: RTCIceCandidate, from: string) => {
    try {
      const pc = peerConnectionsRef.current.get(from);
      if (pc) {
        await pc.addIceCandidate(candidate);
      }
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
    }
  };

  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  const toggleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });

        // Replace video track in all peer connections
        const videoTrack = screenStream.getVideoTracks()[0];
        peerConnectionsRef.current.forEach(pc => {
          const sender = pc.getSenders().find(s => 
            s.track && s.track.kind === 'video'
          );
          if (sender) {
            sender.replaceTrack(videoTrack);
          }
        });

        // Update local video
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }

        setIsScreenSharing(true);
        socketService.startScreenShare(meetingKey!);

        // Handle screen share end
        videoTrack.onended = () => {
          stopScreenShare();
        };
      } else {
        stopScreenShare();
      }
    } catch (error) {
      console.error('Screen share error:', error);
      toast.error('Failed to share screen');
    }
  };

  const stopScreenShare = async () => {
    try {
      // Go back to camera
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      const videoTrack = cameraStream.getVideoTracks()[0];
      peerConnectionsRef.current.forEach(pc => {
        const sender = pc.getSenders().find(s => 
          s.track && s.track.kind === 'video'
        );
        if (sender) {
          sender.replaceTrack(videoTrack);
        }
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = cameraStream;
      }

      setLocalStream(cameraStream);
      setIsScreenSharing(false);
      socketService.stopScreenShare(meetingKey!);
    } catch (error) {
      console.error('Error stopping screen share:', error);
    }
  };

  const startRecording = () => {
    setIsRecording(true);
    socketService.startRecording(meetingKey!);
    toast.success('Recording started');
  };

  const stopRecording = () => {
    setIsRecording(false);
    socketService.stopRecording(meetingKey!);
    toast.success('Recording stopped');
  };

  const sendMessage = () => {
    if (newMessage.trim()) {
      socketService.sendMessage(meetingKey!, newMessage.trim());
      setNewMessage('');
    }
  };

  const copyMeetingLink = () => {
    const link = `${window.location.origin}/meeting/${meetingKey}`;
    navigator.clipboard.writeText(link);
    toast.success('Meeting link copied to clipboard');
  };

  const leaveMeeting = () => {
    cleanup();
    navigate('/dashboard');
  };

  const cleanup = () => {
    // Stop local stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }

    // Close all peer connections
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();

    // Leave socket room
    if (meetingKey) {
      socketService.leaveRoom(meetingKey);
    }

    socketService.disconnect();
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const renderParticipantVideo = (participant: Participant, socketId: string) => (
    <div key={socketId} className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
      <video
        ref={(el) => {
          if (el) {
            remoteVideosRef.current.set(socketId, el);
          }
        }}
        autoPlay
        playsInline
        muted={false}
        className="w-full h-full object-cover"
      />
      <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
        {participant.user.name}
        {!participant.audioEnabled && <MicOff className="inline h-3 w-3 ml-1" />}
      </div>
      {participant.isScreenSharing && (
        <div className="absolute top-2 right-2 bg-blue-600 text-white px-2 py-1 rounded text-xs">
          Sharing
        </div>
      )}
    </div>
  );

  if (!meeting) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p>Connecting to meeting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h1 className="text-lg font-semibold text-gray-900">{meeting.name}</h1>
          <span className="text-sm text-gray-500">•</span>
          <span className="text-sm text-gray-500 font-mono">{meetingKey}</span>
          <button
            onClick={copyMeetingLink}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
            title="Copy meeting link"
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center space-x-2">
          {isRecording && (
            <div className="flex items-center space-x-2 text-red-600">
              <div className="w-2 h-2 bg-red-600 rounded-full animate-pulse"></div>
              <span className="text-sm font-medium">Recording</span>
            </div>
          )}
          <span className="text-sm text-gray-500">
            {participants.size + 1} participant{participants.size !== 0 ? 's' : ''}
          </span>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Video Area */}
        <div className="flex-1 p-4">
          <div className="h-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {/* Local Video */}
            <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
              <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
                You {!isAudioEnabled && <MicOff className="inline h-3 w-3 ml-1" />}
              </div>
              {isScreenSharing && (
                <div className="absolute top-2 right-2 bg-blue-600 text-white px-2 py-1 rounded text-xs">
                  Sharing
                </div>
              )}
            </div>

            {/* Remote Videos */}
            {Array.from(participants.entries()).map(([socketId, participant]) =>
              renderParticipantVideo(participant, socketId)
            )}
          </div>
        </div>

        {/* Sidebar */}
        {(showChat || showParticipants) && (
          <div className="w-80 bg-white border-l border-gray-200 flex flex-col">
            {/* Sidebar Header */}
            <div className="p-4 border-b border-gray-200">
              <div className="flex space-x-1">
                <button
                  onClick={() => {
                    setShowParticipants(true);
                    setShowChat(false);
                  }}
                  className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    showParticipants
                      ? 'bg-blue-100 text-blue-600'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Participants ({participants.size + 1})
                </button>
                <button
                  onClick={() => {
                    setShowChat(true);
                    setShowParticipants(false);
                  }}
                  className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    showChat
                      ? 'bg-blue-100 text-blue-600'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Chat {chatMessages.length > 0 && `(${chatMessages.length})`}
                </button>
              </div>
            </div>

            {/* Participants Panel */}
            {showParticipants && (
              <div className="flex-1 p-4 overflow-y-auto">
                <div className="space-y-3">
                  {/* Current User */}
                  <div className="flex items-center space-x-3 p-2 rounded-lg bg-blue-50">
                    <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                      <span className="text-white text-sm font-medium">
                        {user?.name?.charAt(0)}
                      </span>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">You</p>
                      <p className="text-xs text-gray-500">{user?.email}</p>
                    </div>
                    <div className="flex space-x-1">
                      {!isAudioEnabled && <MicOff className="h-4 w-4 text-red-500" />}
                      {!isVideoEnabled && <VideoOff className="h-4 w-4 text-red-500" />}
                    </div>
                  </div>

                  {/* Remote Participants */}
                  {Array.from(participants.values()).map((participant) => (
                    <div key={participant.socketId} className="flex items-center space-x-3 p-2 rounded-lg">
                      <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center">
                        <span className="text-white text-sm font-medium">
                          {participant.user.name.charAt(0)}
                        </span>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{participant.user.name}</p>
                        <p className="text-xs text-gray-500">{participant.user.email}</p>
                      </div>
                      <div className="flex space-x-1">
                        {!participant.audioEnabled && <MicOff className="h-4 w-4 text-red-500" />}
                        {!participant.videoEnabled && <VideoOff className="h-4 w-4 text-red-500" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Chat Panel */}
            {showChat && (
              <>
                <div className="flex-1 p-4 overflow-y-auto">
                  <div className="space-y-4">
                    {chatMessages.map((msg, index) => (
                      <div key={index} className="flex space-x-2">
                        <div className="w-6 h-6 bg-gray-600 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs font-medium">
                            {msg.user.name.charAt(0)}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            <p className="text-sm font-medium text-gray-900">{msg.user.name}</p>
                            <p className="text-xs text-gray-500">
                              {new Date(msg.timestamp).toLocaleTimeString()}
                            </p>
                          </div>
                          <p className="text-sm text-gray-700 mt-1">{msg.message}</p>
                        </div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                </div>
                <div className="p-4 border-t border-gray-200">
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                      placeholder="Type a message..."
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={sendMessage}
                      disabled={!newMessage.trim()}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Send
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-white border-t border-gray-200 px-4 py-3">
        <div className="flex items-center justify-center space-x-4">
          <button
            onClick={toggleAudio}
            className={`p-3 rounded-full transition-colors ${
              isAudioEnabled
                ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                : 'bg-red-600 text-white hover:bg-red-700'
            }`}
            title={isAudioEnabled ? 'Mute' : 'Unmute'}
          >
            {isAudioEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
          </button>

          <button
            onClick={toggleVideo}
            className={`p-3 rounded-full transition-colors ${
              isVideoEnabled
                ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                : 'bg-red-600 text-white hover:bg-red-700'
            }`}
            title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
          >
            {isVideoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          </button>

          <button
            onClick={toggleScreenShare}
            className={`p-3 rounded-full transition-colors ${
              isScreenSharing
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
            title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
          >
            <Monitor className="h-5 w-5" />
          </button>

          <button
            onClick={() => {
              setShowChat(!showChat);
              setShowParticipants(false);
            }}
            className={`p-3 rounded-full transition-colors ${
              showChat
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
            title="Chat"
          >
            <MessageSquare className="h-5 w-5" />
          </button>

          <button
            onClick={() => {
              setShowParticipants(!showParticipants);
              setShowChat(false);
            }}
            className={`p-3 rounded-full transition-colors ${
              showParticipants
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
            title="Participants"
          >
            <Users className="h-5 w-5" />
          </button>

          <button
            onClick={toggleFullscreen}
            className="p-3 rounded-full bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </button>

          <div className="flex space-x-2">
            {meeting.host_id === user?.id && (
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  isRecording
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {isRecording ? 'Stop Recording' : 'Start Recording'}
              </button>
            )}

            <button
              onClick={leaveMeeting}
              className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 transition-colors"
            >
              Leave Meeting
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}