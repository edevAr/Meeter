import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'models.dart';

/// LAN IP of the Mac that runs Docker (`ipconfig getifaddr en0`).
/// Physical phones cannot use 127.0.0.1 — that is the phone itself.
const lanHost = '192.168.0.31';
const apiPort = 8001;
const defaultApiBase = 'http://$lanHost:$apiPort';
const _storageKey = 'ai-call-recorder.api-base';

bool _isLoopbackHost(String url) {
  final host = Uri.tryParse(url)?.host ?? '';
  return host == '127.0.0.1' || host == 'localhost' || host == '::1' || host == '10.0.2.2';
}

class ApiException implements Exception {
  ApiException(this.message);
  final String message;

  @override
  String toString() => message;
}

class ApiClient extends ChangeNotifier {
  ApiClient();

  String baseUrl = defaultApiBase;
  bool ready = false;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = (prefs.getString(_storageKey) ?? '').replaceAll(RegExp(r'/$'), '');
    if (stored.isEmpty || _isLoopbackHost(stored)) {
      baseUrl = defaultApiBase;
      await prefs.setString(_storageKey, baseUrl);
    } else {
      baseUrl = stored;
    }
    ready = true;
    notifyListeners();
  }

  Future<void> setBaseUrl(String url) async {
    baseUrl = (url.trim().isEmpty ? defaultApiBase : url.trim()).replaceAll(RegExp(r'/$'), '');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_storageKey, baseUrl);
    notifyListeners();
  }

  String audioUrl(Recording recording) => '$baseUrl${recording.audioUrl}';

  String exportUrl(String recordingId, String kind, String format) =>
      '$baseUrl/api/recordings/$recordingId/export/$kind?format=$format';

  Future<Map<String, dynamic>> _json(
    String method,
    String path, {
    Object? body,
    bool allow404 = false,
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = {if (body != null) 'Content-Type': 'application/json'};
    late http.Response response;
    switch (method) {
      case 'GET':
        response = await http.get(uri);
      case 'POST':
        response = await http.post(uri, headers: headers, body: body);
      case 'PATCH':
        response = await http.patch(uri, headers: headers, body: body);
      case 'DELETE':
        response = await http.delete(uri);
      default:
        throw ApiException('Unsupported method');
    }
    if (allow404 && response.statusCode == 404) return {};
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(_detail(response));
    }
    if (response.body.isEmpty) return {};
    final decoded = jsonDecode(response.body);
    if (decoded is Map<String, dynamic>) return decoded;
    throw ApiException('Unexpected response');
  }

  Future<List<dynamic>> _jsonList(String path) async {
    final uri = Uri.parse('$baseUrl$path');
    final response = await http.get(uri);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(_detail(response));
    }
    final decoded = jsonDecode(response.body);
    if (decoded is List) return decoded;
    throw ApiException('Unexpected response');
  }

  String _detail(http.Response response) {
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map && decoded['detail'] is String) {
        return decoded['detail'] as String;
      }
    } catch (_) {}
    return 'Request failed (${response.statusCode})';
  }

  Future<Dashboard> getDashboard() async {
    final json = await _json('GET', '/api/dashboard');
    return Dashboard.fromJson(json);
  }

  Future<List<Recording>> listRecordings() async {
    final items = await _jsonList('/api/recordings');
    return items.map((item) => Recording.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<Recording> getRecording(String id) async {
    return Recording.fromJson(await _json('GET', '/api/recordings/$id'));
  }

  Future<Recording> uploadRecording({
    required File file,
    required String title,
    required double durationSeconds,
  }) async {
    final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/api/recordings/upload'));
    request.fields['title'] = title;
    request.fields['duration_seconds'] = durationSeconds.toString();
    request.fields['source'] = 'microphone';
    request.files.add(await http.MultipartFile.fromPath(
      'file',
      file.path,
      filename: 'recording.m4a',
    ));
    final streamed = await request.send();
    final response = await http.Response.fromStream(streamed);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(_detail(response));
    }
    return Recording.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> deleteRecording(String id) async {
    await _json('DELETE', '/api/recordings/$id');
  }

  Future<Transcript> transcribe(String id, {String? language}) async {
    return Transcript.fromJson(await _json(
      'POST',
      '/api/recordings/$id/transcribe',
      body: jsonEncode({'language': language}),
    ));
  }

  Future<Transcript?> getTranscript(String id) async {
    final json = await _json('GET', '/api/recordings/$id/transcript', allow404: true);
    if (json.isEmpty) return null;
    return Transcript.fromJson(json);
  }

  Future<Analysis> analyze(String id) async {
    return Analysis.fromJson(await _json('POST', '/api/recordings/$id/analyze'));
  }

  Future<Analysis?> getAnalysis(String id) async {
    final json = await _json('GET', '/api/recordings/$id/analysis', allow404: true);
    if (json.isEmpty) return null;
    return Analysis.fromJson(json);
  }

  Future<List<ActionItem>> listActionItems({String? status, bool highPriority = false}) async {
    final query = <String, String>{
      if (status != null) 'status': status,
      if (highPriority) 'high_priority': 'true',
    };
    final suffix = query.isEmpty ? '' : '?${Uri(queryParameters: query).query}';
    final items = await _jsonList('/api/action-items$suffix');
    return items.map((item) => ActionItem.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<ActionItem> patchActionItem(String id, Map<String, dynamic> payload) async {
    return ActionItem.fromJson(await _json(
      'PATCH',
      '/api/action-items/$id',
      body: jsonEncode(payload),
    ));
  }

  Future<List<SearchHit>> search(String q) async {
    final json = await _json('GET', '/api/search?q=${Uri.encodeQueryComponent(q)}');
    final results = json['results'] as List<dynamic>? ?? [];
    return results.map((item) => SearchHit.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<Meta> getMeta() async {
    return Meta.fromJson(await _json('GET', '/api/meta'));
  }
}
