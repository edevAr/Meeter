class Recording {
  Recording({
    required this.id,
    required this.title,
    required this.audioUrl,
    required this.durationSeconds,
    required this.createdAt,
    required this.status,
    required this.source,
    this.language,
    this.errorMessage,
    this.deviceName,
  });

  final String id;
  final String title;
  final String audioUrl;
  final double durationSeconds;
  final String createdAt;
  final String status;
  final String source;
  final String? language;
  final String? errorMessage;
  final String? deviceName;

  factory Recording.fromJson(Map<String, dynamic> json) {
    return Recording(
      id: json['id'] as String,
      title: json['title'] as String,
      audioUrl: json['audio_url'] as String,
      durationSeconds: (json['duration_seconds'] as num?)?.toDouble() ?? 0,
      createdAt: json['created_at'] as String,
      status: json['status'] as String,
      source: json['source'] as String? ?? 'microphone',
      language: json['language'] as String?,
      errorMessage: json['error_message'] as String?,
      deviceName: json['device_name'] as String?,
    );
  }

  bool get canTranscribe =>
      {'recorded', 'transcribed', 'analyzed', 'failed'}.contains(status);

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
    this.language,
  });

  final String id;
  final String recordingId;
  final String text;
  final String? language;
  final List<TranscriptSegment> segments;

  factory Transcript.fromJson(Map<String, dynamic> json) {
    final raw = json['segments'] as List<dynamic>? ?? [];
    return Transcript(
      id: json['id'] as String,
      recordingId: json['recording_id'] as String,
      text: json['text'] as String? ?? '',
      language: json['language'] as String?,
      segments: raw
          .map((item) => TranscriptSegment.fromJson(item as Map<String, dynamic>))
          .toList(),
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
    this.recordingTitle,
    this.owner,
    this.dueDate,
  });

  final String id;
  final String recordingId;
  final String? recordingTitle;
  final String task;
  final String? owner;
  final String? dueDate;
  final String priority;
  final String status;

  factory ActionItem.fromJson(Map<String, dynamic> json) {
    return ActionItem(
      id: json['id'] as String,
      recordingId: json['recording_id'] as String,
      recordingTitle: json['recording_title'] as String?,
      task: json['task'] as String,
      owner: json['owner'] as String?,
      dueDate: json['due_date'] as String?,
      priority: json['priority'] as String? ?? 'medium',
      status: json['status'] as String? ?? 'pending',
    );
  }

  String get displayOwner => owner?.isNotEmpty == true ? owner! : 'Not specified';
  String get displayDue => dueDate?.isNotEmpty == true ? dueDate! : 'Not specified';
}

class Dashboard {
  Dashboard({
    required this.recordings,
    required this.transcribed,
    required this.analyzed,
    required this.recent,
  });

  final int recordings;
  final int transcribed;
  final int analyzed;
  final List<Recording> recent;

  factory Dashboard.fromJson(Map<String, dynamic> json) {
    final raw = json['recent'] as List<dynamic>? ?? [];
    return Dashboard(
      recordings: json['recordings'] as int? ?? 0,
      transcribed: json['transcribed'] as int? ?? 0,
      analyzed: json['analyzed'] as int? ?? 0,
      recent: raw.map((item) => Recording.fromJson(item as Map<String, dynamic>)).toList(),
    );
  }
}

class SearchHit {
  SearchHit({
    required this.kind,
    required this.id,
    required this.recordingId,
    required this.title,
    required this.snippet,
  });

  final String kind;
  final String id;
  final String recordingId;
  final String title;
  final String snippet;

  factory SearchHit.fromJson(Map<String, dynamic> json) {
    return SearchHit(
      kind: json['kind'] as String,
      id: json['id'] as String,
      recordingId: json['recording_id'] as String,
      title: json['title'] as String,
      snippet: json['snippet'] as String? ?? '',
    );
  }
}

class Meta {
  Meta({
    required this.transcriptionProvider,
    required this.transcriptionIsCloud,
    required this.allowCloudTranscription,
    required this.aiProvider,
    required this.aiModel,
    required this.aiIsCloud,
    required this.defaultLanguage,
    required this.apiKeyConfigured,
  });

  final String transcriptionProvider;
  final bool transcriptionIsCloud;
  final bool allowCloudTranscription;
  final String aiProvider;
  final String aiModel;
  final bool aiIsCloud;
  final String defaultLanguage;
  final bool apiKeyConfigured;

  factory Meta.fromJson(Map<String, dynamic> json) {
    return Meta(
      transcriptionProvider: json['transcription_provider'] as String? ?? 'whisper',
      transcriptionIsCloud: json['transcription_is_cloud'] as bool? ?? false,
      allowCloudTranscription: json['allow_cloud_transcription'] as bool? ?? false,
      aiProvider: json['ai_provider'] as String? ?? 'openai',
      aiModel: json['ai_model'] as String? ?? '',
      aiIsCloud: json['ai_is_cloud'] as bool? ?? true,
      defaultLanguage: json['default_language'] as String? ?? 'auto',
      apiKeyConfigured: json['api_key_configured'] as bool? ?? false,
    );
  }
}
