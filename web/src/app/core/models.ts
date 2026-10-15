export type Priority = 'low' | 'medium' | 'high';
export type ItemStatus = 'pending' | 'in_progress' | 'completed';
export type NoteColor = 'yellow' | 'amber' | 'mint' | 'sky' | 'rose' | 'lilac' | 'peach';

export interface Note {
  id: string;
  title: string;
  body: string;
  color: NoteColor | string;
  pinned: boolean;
  archived: boolean;
  recording_id: string | null;
  priority: number;
  pos_x: number;
  pos_y: number;
  rotation: number;
  width: number;
  height: number;
  reminder_at: string | null;
  alarm_tone: string;
  reminder_silenced: boolean;
  created_at: string;
  updated_at: string;
  access?: 'owner' | 'read' | 'write';
  owner_name?: string | null;
  share_count?: number;
}

export interface NoteShare {
  id: string;
  note_id: string;
  user_id: string;
  name: string;
  email: string;
  can_read: boolean;
  can_write: boolean;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  details: string;
  due_date: string | null;
  priority: Priority;
  status: ItemStatus;
  source: string;
  note_id: string | null;
  recording_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgendaItem {
  id: string;
  kind: 'task' | 'action_item';
  title: string;
  details: string;
  due_date: string | null;
  priority: Priority;
  status: ItemStatus;
  source: string;
  recording_id: string | null;
  note_id: string | null;
  overdue: boolean;
}

export interface Recording {
  id: string;
  title: string;
  audio_url: string;
  duration_seconds: number;
  created_at: string;
  status: string;
  source: string;
  error_message: string | null;
}

export interface Transcript {
  id: string;
  recording_id: string;
  text: string;
  language: string | null;
  segments: Array<{ id: string; start_time: number; end_time: number; speaker: string | null; text: string }>;
}

export interface Analysis {
  id: string;
  recording_id: string;
  summary: string;
  participants: string[];
  key_topics: string[];
  decisions: string[];
  action_items?: Array<{ task: string; owner: string | null; due_date: string | null; priority: Priority }>;
}

export interface Meta {
  transcription_provider: string;
  ai_provider: string;
  ai_model: string;
  ai_is_cloud: boolean;
  api_key_configured: boolean;
}
