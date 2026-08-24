import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'models.dart';

const lanHost = '192.168.0.31';
const apiPort = 8001;
const defaultApiBase = 'http://$lanHost:$apiPort';
const _urlKey = 'meeter.api-base';
const _tokenKey = 'meeter.session';
const _userKey = 'meeter.user';

bool _isLoopbackHost(String url) {
  final host = Uri.tryParse(url)?.host ?? '';
  return host == '127.0.0.1' || host == 'localhost' || host == '::1' || host == '10.0.2.2';
}

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;
  @override
  String toString() => message;
}

class ApiClient extends ChangeNotifier {
  String baseUrl = defaultApiBase;
  String? token;
  AuthUser? user;
  bool ready = false;

  bool get isLoggedIn => token != null && token!.isNotEmpty;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = (prefs.getString(_urlKey) ?? '').replaceAll(RegExp(r'/$'), '');
    if (stored.isEmpty || _isLoopbackHost(stored)) {
      baseUrl = defaultApiBase;
      await prefs.setString(_urlKey, baseUrl);
    } else {
      baseUrl = stored;
    }
    token = prefs.getString(_tokenKey);
    final rawUser = prefs.getString(_userKey);
    if (rawUser != null) {
      try {
        user = AuthUser.fromJson(jsonDecode(rawUser) as Map<String, dynamic>);
      } catch (_) {
        user = null;
      }
    }
    ready = true;
    notifyListeners();
  }

  Future<void> setBaseUrl(String url) async {
    baseUrl = (url.trim().isEmpty ? defaultApiBase : url.trim()).replaceAll(RegExp(r'/$'), '');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_urlKey, baseUrl);
    notifyListeners();
  }

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      };

  Future<void> _keep(AuthUser nextUser, String nextToken) async {
    user = nextUser;
    token = nextToken;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, nextToken);
    await prefs.setString(_userKey, jsonEncode(nextUser.toJson()));
    notifyListeners();
  }

  Future<void> logout() async {
    try {
      if (token != null) await _send('POST', '/api/auth/logout');
    } catch (_) {}
    token = null;
    user = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    await prefs.remove(_userKey);
    notifyListeners();
  }

  Future<dynamic> _send(String method, String path, {Object? body, bool allow404 = false}) async {
    final uri = Uri.parse('$baseUrl$path');
    late http.Response response;
    switch (method) {
      case 'GET':
        response = await http.get(uri, headers: _headers);
      case 'POST':
        response = await http.post(uri, headers: _headers, body: body);
      case 'PATCH':
        response = await http.patch(uri, headers: _headers, body: body);
      case 'DELETE':
        response = await http.delete(uri, headers: _headers);
      default:
        throw ApiException('Método no soportado');
    }
    if (response.statusCode == 401) {
      token = null;
      user = null;
      notifyListeners();
      throw ApiException('Inicia sesión para continuar.', statusCode: 401);
    }
    if (allow404 && response.statusCode == 404) return null;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(_detail(response), statusCode: response.statusCode);
    }
    if (response.body.isEmpty) return null;
    return jsonDecode(response.body);
  }

  String _detail(http.Response response) {
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map && decoded['detail'] is String) return decoded['detail'] as String;
    } catch (_) {}
    return 'No se pudo completar (${response.statusCode})';
  }

  Future<void> login(String email, String password) async {
    final json = await _send('POST', '/api/auth/login', body: jsonEncode({'email': email, 'password': password}))
        as Map<String, dynamic>;
    await _keep(AuthUser.fromJson(json['user'] as Map<String, dynamic>), json['token'] as String);
  }

  Future<void> register({required String email, required String password, required String name}) async {
    final json = await _send(
      'POST',
      '/api/auth/register',
      body: jsonEncode({'email': email, 'password': password, 'name': name}),
    ) as Map<String, dynamic>;
    await _keep(AuthUser.fromJson(json['user'] as Map<String, dynamic>), json['token'] as String);
  }

  Future<String?> forgotPassword(String email) async {
    final json = await _send('POST', '/api/auth/forgot-password', body: jsonEncode({'email': email}))
        as Map<String, dynamic>;
    return json['reset_code'] as String?;
  }

  Future<void> resetPassword({required String email, required String code, required String password}) async {
    await _send(
      'POST',
      '/api/auth/reset-password',
      body: jsonEncode({'email': email, 'code': code, 'password': password}),
    );
  }

  Future<List<Note>> listNotes({bool archived = false}) async {
    final items = await _send('GET', '/api/notes?archived=$archived') as List<dynamic>;
    return items.map((item) => Note.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<Note> createNote({
    String title = '',
    String body = '',
    String color = 'yellow',
    int priority = 1,
    String? createdAt,
  }) async {
    final json = await _send(
      'POST',
      '/api/notes',
      body: jsonEncode({
        'title': title,
        'body': body,
        'color': color,
        'priority': priority,
        if (createdAt != null) 'created_at': createdAt,
      }),
    ) as Map<String, dynamic>;
    return Note.fromJson(json);
  }

  Future<Note> updateNote(String id, Map<String, dynamic> payload) async {
    final json = await _send('PATCH', '/api/notes/$id', body: jsonEncode(payload)) as Map<String, dynamic>;
    return Note.fromJson(json);
  }

  Future<List<NoteShare>> listShares(String noteId) async {
    final items = await _send('GET', '/api/notes/$noteId/shares') as List<dynamic>;
    return items.map((item) => NoteShare.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<NoteShare> shareNote(
    String noteId, {
    required String identifier,
    required bool canRead,
    required bool canWrite,
  }) async {
    final json = await _send(
      'POST',
      '/api/notes/$noteId/shares',
      body: jsonEncode({'identifier': identifier, 'can_read': canRead, 'can_write': canWrite}),
    ) as Map<String, dynamic>;
    return NoteShare.fromJson(json);
  }

  Future<NoteShare> updateShare(
    String noteId,
    String shareId, {
    bool? canRead,
    bool? canWrite,
  }) async {
    final json = await _send(
      'PATCH',
      '/api/notes/$noteId/shares/$shareId',
      body: jsonEncode({
        if (canRead != null) 'can_read': canRead,
        if (canWrite != null) 'can_write': canWrite,
      }),
    ) as Map<String, dynamic>;
    return NoteShare.fromJson(json);
  }

  Future<void> unshare(String noteId, String shareId) async {
    await _send('DELETE', '/api/notes/$noteId/shares/$shareId');
  }

  Future<List<AgendaItem>> listAgenda(String period) async {
    final json = await _send('GET', '/api/agenda?period=$period') as Map<String, dynamic>;
    final items = json['items'] as List<dynamic>? ?? [];
    return items.map((item) => AgendaItem.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<void> createTask({required String title, String? dueDate, String priority = 'medium'}) async {
    await _send(
      'POST',
      '/api/tasks',
      body: jsonEncode({'title': title, 'due_date': dueDate, 'priority': priority}),
    );
  }

  Future<void> patchTask(String id, Map<String, dynamic> payload) async {
    await _send('PATCH', '/api/tasks/$id', body: jsonEncode(payload));
  }

  String audioUrl(Recording recording) => '$baseUrl${recording.audioUrl}';

  String exportUrl(String recordingId, String kind, String format) =>
      '$baseUrl/api/recordings/$recordingId/export/$kind?format=$format';

  Future<List<Recording>> listRecordings() async {
    final items = await _send('GET', '/api/recordings') as List<dynamic>;
    return items.map((item) => Recording.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<Recording> getRecording(String id) async {
    return Recording.fromJson(await _send('GET', '/api/recordings/$id') as Map<String, dynamic>);
  }

  Future<Recording> uploadRecording({
    required File file,
    required String title,
    required double durationSeconds,
  }) async {
    final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/api/recordings/upload'));
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    request.fields['title'] = title;
    request.fields['duration_seconds'] = durationSeconds.toString();
    request.fields['source'] = 'microphone';
    request.files.add(await http.MultipartFile.fromPath('file', file.path, filename: 'recording.m4a'));
    final streamed = await request.send();
    final response = await http.Response.fromStream(streamed);
    if (response.statusCode == 401) {
      token = null;
      user = null;
      notifyListeners();
      throw ApiException('Inicia sesión para continuar.', statusCode: 401);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(_detail(response), statusCode: response.statusCode);
    }
    return Recording.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> deleteRecording(String id) async {
    await _send('DELETE', '/api/recordings/$id');
  }

  Future<Transcript> transcribe(String id, {String? language}) async {
    return Transcript.fromJson(await _send(
      'POST',
      '/api/recordings/$id/transcribe',
      body: jsonEncode({'language': language}),
    ) as Map<String, dynamic>);
  }

  Future<Transcript?> getTranscript(String id) async {
    final json = await _send('GET', '/api/recordings/$id/transcript', allow404: true);
    if (json == null) return null;
    return Transcript.fromJson(json as Map<String, dynamic>);
  }

  Future<Analysis> analyze(String id) async {
    return Analysis.fromJson(await _send('POST', '/api/recordings/$id/analyze') as Map<String, dynamic>);
  }

  Future<Analysis?> getAnalysis(String id) async {
    final json = await _send('GET', '/api/recordings/$id/analysis', allow404: true);
    if (json == null) return null;
    return Analysis.fromJson(json as Map<String, dynamic>);
  }

  Future<List<ActionItem>> listActionItems() async {
    final items = await _send('GET', '/api/action-items') as List<dynamic>;
    return items.map((item) => ActionItem.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<Meta> getMeta() async {
    return Meta.fromJson(await _send('GET', '/api/meta') as Map<String, dynamic>);
  }
}
