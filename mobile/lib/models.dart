class AuthUser {
  AuthUser({required this.id, required this.email, required this.name});

  final String id;
  final String email;
  final String name;

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['id'] as String,
      email: json['email'] as String? ?? '',
      name: json['name'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() => {'id': id, 'email': email, 'name': name};
}

class Note {
  Note({
    required this.id,
    required this.title,
    required this.body,
    required this.color,
    required this.pinned,
    required this.archived,
    required this.priority,
    required this.createdAt,
    required this.updatedAt,
    this.recordingId,
    this.reminderAt,
    this.access = 'owner',
    this.ownerName,
    this.shareCount = 0,
  });

  final String id;
  String title;
  String body;
  String color;
  bool pinned;
  bool archived;
  int priority;
  final String? recordingId;
  String? reminderAt;
  final String createdAt;
  String updatedAt;
  String access;
  String? ownerName;
  int shareCount;

  bool get isOwner => access != 'read' && access != 'write';
  bool get canEdit => access != 'read';
  bool get canShare => isOwner && !archived;

  factory Note.fromJson(Map<String, dynamic> json) {
    return Note(
      id: json['id'] as String,
      title: json['title'] as String? ?? '',
      body: json['body'] as String? ?? '',
      color: json['color'] as String? ?? 'yellow',
      pinned: json['pinned'] as bool? ?? false,
      archived: json['archived'] as bool? ?? false,
      priority: json['priority'] as int? ?? 1,
      recordingId: json['recording_id'] as String?,
      reminderAt: json['reminder_at'] as String?,
      createdAt: json['created_at'] as String? ?? '',
      updatedAt: json['updated_at'] as String? ?? '',
      access: json['access'] as String? ?? 'owner',
      ownerName: json['owner_name'] as String?,
      shareCount: json['share_count'] as int? ?? 0,
    );
  }

  String get plainText {
    return body
        .replaceAll(RegExp(r'<!--meeter-images:.*?-->', dotAll: true), '')
        .replaceAll(RegExp(r'<!--meeter-marks:.*?-->', dotAll: true), '')
        .trim();
  }

  String mergeText(String text) {
    final images = RegExp(r'<!--meeter-images:.*?-->', dotAll: true).firstMatch(body)?.group(0) ?? '';
    final marks = RegExp(r'<!--meeter-marks:.*?-->', dotAll: true).firstMatch(body)?.group(0) ?? '';
    return '$text$images$marks';
  }
}

class NoteShare {
  NoteShare({
    required this.id,
    required this.noteId,
    required this.userId,
    required this.name,
    required this.email,
    required this.canRead,
    required this.canWrite,
  });

  final String id;
  final String noteId;
  final String userId;
  final String name;
  final String email;
  final bool canRead;
  final bool canWrite;

  factory NoteShare.fromJson(Map<String, dynamic> json) {
    return NoteShare(
      id: json['id'] as String,
      noteId: json['note_id'] as String,
      userId: json['user_id'] as String,
      name: json['name'] as String? ?? '',
      email: json['email'] as String? ?? '',
      canRead: json['can_read'] as bool? ?? true,
      canWrite: json['can_write'] as bool? ?? false,
    );
  }
}

class Recording {
  Recording({
    required this.id,
    required this.title,
    required this.audioUrl,
    required this.durationSeconds,
    required this.createdAt,
    required this.status,
    required this.source,
    this.errorMessage,
  });

  final String id;
  final String title;
  final String audioUrl;
  final double durationSeconds;
  final String createdAt;
  final String status;
  final String source;
  final String? errorMessage;

  factory Recording.fromJson(Map<String, dynamic> json) {
    return Recording(
      id: json['id'] as String,
      title: json['title'] as String,
      audioUrl: json['audio_url'] as String,
      durationSeconds: (json['duration_seconds'] as num?)?.toDouble() ?? 0,
      createdAt: json['created_at'] as String,
      status: json['status'] as String,
      source: json['source'] as String? ?? 'microphone',
      errorMessage: json['error_message'] as String?,
    );
  }

  bool get canTranscribe => {'recorded', 'transcribed', 'analyzed', 'failed'}.contains(status);
  bool get canAnalyze => {'transcribed', 'analyzed'}.contains(status);
}

class TranscriptSegment {
  TranscriptSegment({
    required this.id,
    required this.startTime,
    required this.endTime,
    required this.text,
    this.speaker,
  });

  final String id;
  final double startTime;
  final double endTime;
  final String text;
  final String? speaker;

  factory TranscriptSegment.fromJson(Map<String, dynamic> json) {
    return TranscriptSegment(
      id: json['id'] as String,
      startTime: (json['start_time'] as num?)?.toDouble() ?? 0,
      endTime: (json['end_time'] as num?)?.toDouble() ?? 0,
      text: json['text'] as String? ?? '',
      speaker: json['speaker'] as String?,
    );
  }
}

class Transcript {
  Transcript({
    required this.id,
    required this.recordingId,
    required this.text,
    required this.segments,
  });

  final String id;
  final String recordingId;
  final String text;
  final List<TranscriptSegment> segments;

  factory Transcript.fromJson(Map<String, dynamic> json) {
    final raw = json['segments'] as List<dynamic>? ?? [];
    return Transcript(
      id: json['id'] as String,
      recordingId: json['recording_id'] as String,
      text: json['text'] as String? ?? '',
      segments: raw.map((item) => TranscriptSegment.fromJson(item as Map<String, dynamic>)).toList(),
    );
  }
}

class Analysis {
  Analysis({
    required this.id,
    required this.recordingId,
    required this.summary,
    required this.participants,
    required this.keyTopics,
    required this.decisions,
  });

  final String id;
  final String recordingId;
  final String summary;
  final List<String> participants;
  final List<String> keyTopics;
  final List<String> decisions;

  factory Analysis.fromJson(Map<String, dynamic> json) {
    List<String> strings(String key) =>
        (json[key] as List<dynamic>? ?? []).map((item) => item.toString()).toList();
    return Analysis(
      id: json['id'] as String,
      recordingId: json['recording_id'] as String,
      summary: json['summary'] as String? ?? '',
      participants: strings('participants'),
      keyTopics: strings('key_topics'),
      decisions: strings('decisions'),
    );
  }
}

class ActionItem {
  ActionItem({
    required this.id,
    required this.recordingId,
    required this.task,
    required this.priority,
    required this.status,
    this.owner,
  });

  final String id;
  final String recordingId;
  final String task;
  final String? owner;
  final String priority;
  final String status;

  factory ActionItem.fromJson(Map<String, dynamic> json) {
    return ActionItem(
      id: json['id'] as String,
      recordingId: json['recording_id'] as String? ?? '',
      task: json['task'] as String,
      owner: json['owner'] as String?,
      priority: json['priority'] as String? ?? 'medium',
      status: json['status'] as String? ?? 'pending',
    );
  }
}

class AgendaItem {
  AgendaItem({
    required this.id,
    required this.kind,
    required this.title,
    required this.priority,
    required this.status,
    required this.overdue,
    this.dueDate,
    this.noteId,
    this.recordingId,
  });

  final String id;
  final String kind;
  final String title;
  final String? dueDate;
  final String priority;
  final String status;
  final bool overdue;
  final String? noteId;
  final String? recordingId;

  factory AgendaItem.fromJson(Map<String, dynamic> json) {
    return AgendaItem(
      id: json['id'] as String,
      kind: json['kind'] as String? ?? 'task',
      title: json['title'] as String? ?? '',
      dueDate: json['due_date'] as String?,
      priority: json['priority'] as String? ?? 'medium',
      status: json['status'] as String? ?? 'pending',
      overdue: json['overdue'] as bool? ?? false,
      noteId: json['note_id'] as String?,
      recordingId: json['recording_id'] as String?,
    );
  }
}

class Meta {
  Meta({
    required this.transcriptionProvider,
    required this.aiProvider,
    required this.aiModel,
    required this.apiKeyConfigured,
  });

  final String transcriptionProvider;
  final String aiProvider;
  final String aiModel;
  final bool apiKeyConfigured;

  factory Meta.fromJson(Map<String, dynamic> json) {
    return Meta(
      transcriptionProvider: json['transcription_provider'] as String? ?? 'whisper',
      aiProvider: json['ai_provider'] as String? ?? 'openai',
      aiModel: json['ai_model'] as String? ?? '',
      apiKeyConfigured: json['api_key_configured'] as bool? ?? false,
    );
  }
}
