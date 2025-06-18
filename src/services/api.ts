import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

class ApiService {
  private async request(endpoint: string, options: RequestInit = {}) {
    const token = localStorage.getItem('token');
    
    const config: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
      ...options,
    };

    const response = await fetch(`${API_URL}${endpoint}`, config);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Network error' }));
      
      // Handle token expiration
      if (response.status === 401 && error.message?.includes('expired')) {
        localStorage.removeItem('token');
        window.location.href = '/login';
        return;
      }
      
      throw new Error(error.message || 'Request failed');
    }

    return response.json();
  }

  // Auth endpoints
  login = (email: string, password: string, deviceId: string) =>
    this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, deviceId }),
    });

  register = (name: string, email: string, password: string) =>
    this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });

  logout = () => this.request('/api/auth/logout', { method: 'POST' });

  getProfile = () => this.request('/api/auth/profile');

  // Meeting endpoints - Fixed API paths
  createMeeting = (name: string) =>
    this.request('/api/meetings', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });

  getMeeting = (meetingKey: string) =>
    this.request(`/api/meetings/${meetingKey}`);

  getUserMeetings = () => this.request('/api/meetings/user');

  // Recording endpoints
  updateRecording = (meetingKey: string, recordsFileUrl: string) =>
    this.request(`/api/meetings/${meetingKey}/recording`, {
      method: 'PUT',
      body: JSON.stringify({ recordsFileUrl }),
    });
}

export const api = new ApiService();