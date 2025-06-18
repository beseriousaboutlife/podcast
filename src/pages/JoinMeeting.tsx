import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users } from 'lucide-react';
import Header from '../components/Header';
import toast from 'react-hot-toast';

export default function JoinMeeting() {
  const [meetingKey, setMeetingKey] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!meetingKey.trim()) {
      toast.error('Please enter a meeting code');
      return;
    }

    setLoading(true);
    try {
      // Validate meeting exists before joining
      navigate(`/meeting/${meetingKey.trim()}`);
    } catch (error: any) {
      toast.error('Failed to join meeting');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 mb-8 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
          <span>Back to Dashboard</span>
        </button>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mx-auto mb-4">
              <Users className="h-8 w-8 text-green-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Join Meeting</h1>
            <p className="text-gray-600">Enter the meeting code to join an existing session</p>
          </div>

          <form onSubmit={handleJoin} className="space-y-6">
            <div>
              <label htmlFor="meetingKey" className="block text-sm font-medium text-gray-700 mb-2">
                Meeting Code
              </label>
              <input
                id="meetingKey"
                type="text"
                value={meetingKey}
                onChange={(e) => setMeetingKey(e.target.value)}
                placeholder="Enter meeting code (e.g., abc-def-ghi)"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                autoFocus
              />
              <p className="text-sm text-gray-500 mt-2">
                The meeting code is provided by the meeting host
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !meetingKey.trim()}
              className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Joining...' : 'Join Meeting'}
            </button>
          </form>

          <div className="mt-8 p-4 bg-blue-50 rounded-lg">
            <h3 className="font-medium text-blue-900 mb-2">Tips for joining:</h3>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• Make sure your microphone and camera are working</li>
              <li>• Use a stable internet connection for best quality</li>
              <li>• Find a quiet environment for recording</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}