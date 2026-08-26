import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'models.dart';

class _Queue {
  _Queue({Map<String, Note>? upserts, List<String>? deletes})
      : upserts = upserts ?? {},
        deletes = deletes ?? [];

  final Map<String, Note> upserts;
  final List<String> deletes;

  int get length => upserts.length + deletes.length;
}

class NoteStore extends ChangeNotifier {
  NoteStore(this._api);

  final ApiClient _api;
  List<Note> notes = [];
  bool online = true;
  bool syncing = false;
  int pending = 0;
  Timer? _timer;
  Timer? _flushTimer;
  Timer? _reconnectTimer;
  StreamSubscription<Map<String, dynamic>>? _live;
  bool _flushing = false;
  bool _started = false;
  bool live = false;
  int _backoffMs = 1000;

  Future<void> start() async {
    if (_started) return;
    _started = true;
    await _loadCache();
    _api.addListener(_onAuth);
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => ping());
    unawaited(ping());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _flushTimer?.cancel();
    _reconnectTimer?.cancel();
    unawaited(_live?.cancel());
    _api.removeListener(_onAuth);
    super.dispose();
  }

  Note createNote({DateTime? day}) {
    final localDay = day ?? DateTime.now();
    final stamp = DateTime(localDay.year, localDay.month, localDay.day, 12).toUtc().toIso8601String();
    final col = notes.where((note) => !note.archived).length % 4;
    final note = Note(
      id: newNoteId(),
      title: '',
      body: '',
      color: 'yellow',
      pinned: false,
      archived: false,
      priority: 1,
      createdAt: stamp,
      updatedAt: stamp,
      posX: 36 + col * 202,
      posY: 132,
      rotation: -1.5,
      width: 180,
      height: 204,
    );
    _put(note);
    _enqueue(note);
    unawaited(flush());
    return note;
  }

  Future<void> save(Note note, {Map<String, dynamic>? patch}) async {
    if (!note.canEdit) return;
    if (patch != null) {
      if (patch.containsKey('title')) note.title = patch['title'] as String? ?? note.title;
      if (patch.containsKey('body')) note.body = patch['body'] as String? ?? note.body;
      if (patch.containsKey('color')) note.color = patch['color'] as String? ?? note.color;
      if (patch.containsKey('priority')) note.priority = patch['priority'] as int? ?? note.priority;
      if (patch.containsKey('pinned')) note.pinned = patch['pinned'] as bool? ?? note.pinned;
      if (patch.containsKey('archived')) note.archived = patch['archived'] as bool? ?? note.archived;
    }
    note.updatedAt = DateTime.now().toUtc().toIso8601String();
    _put(note);
    _enqueue(note);
    _scheduleFlush();
  }

  Future<void> ping() async {
    final reachable = await _api.isReachable();
    online = reachable;
    if (reachable) {
      if (!live) _connect();
      if (pending > 0) await flush();
    } else {
      live = false;
      notifyListeners();
    }
  }

  Future<void> refresh() => flush(force: true);

  Future<void> flush({bool force = false}) async {
    _flushTimer?.cancel();
    _flushTimer = null;
    await _flushNow(force: force);
  }

  void _onAuth() {
    unawaited(_live?.cancel());
    _live = null;
    live = false;
    unawaited(_loadCache().then((_) => ping()));
  }

  Future<void> _flushNow({bool force = false}) async {
    if (_flushing || !online || !_api.isLoggedIn) return;
    final pendingNow = (await _queue()).length;
    if (!force && pendingNow == 0 && live) return;
    _flushing = true;
    syncing = true;
    notifyListeners();
    try {
      if (force || pendingNow > 0) {
        final pulled = await _api.syncNotes([]);
        _forgetStale(pulled);
        _applyRemote(pulled);
      }
      final snapshot = await _queue();
      if (snapshot.length == 0) {
        online = true;
        return;
      }
      final payload = [
        ...snapshot.upserts.values.map((note) => note.toSyncJson()),
        ...snapshot.deletes.map((id) => {'id': id, 'deleted': true}),
      ];
      final result = await _api.syncNotes(payload);
      await _dropFlushed(snapshot);
      online = true;
      _applyRemote(result);
    } on ApiException catch (error) {
      if (error.statusCode != 401) online = false;
    } catch (_) {
      online = false;
    } finally {
      _flushing = false;
      syncing = false;
      notifyListeners();
    }
  }

  void _applyRemote(List<Note> incoming) {
    _forgetStale(incoming);
    final localById = {for (final note in notes) note.id: note};
    final merged = <Note>[];
    for (final note in incoming) {
      final local = localById[note.id];
      if (local != null && !_shouldApplyRemote(note.id, note.updatedAt)) {
        merged.add(local);
      } else if (local != null) {
        local.applyFrom(note);
        merged.add(local);
      } else {
        merged.add(note);
      }
    }
    for (final local in notes) {
      if (merged.any((note) => note.id == local.id)) continue;
      if (pendingIds.contains(local.id)) merged.add(local);
    }
    notes = merged;
    unawaited(_persist());
  }

  void _connect() {
    if (_live != null || !_api.isLoggedIn) return;
    _reconnectTimer?.cancel();
    _live = _api.noteEvents().listen(
      (event) {
        online = true;
        if (event['event'] == 'ready') {
          live = true;
          _backoffMs = 1000;
          unawaited(flush(force: true));
        } else {
          live = true;
          _applyEvent(event);
        }
        notifyListeners();
      },
      onError: (_) {
        live = false;
        _live = null;
        _scheduleReconnect();
        notifyListeners();
      },
      onDone: () {
        live = false;
        _live = null;
        _scheduleReconnect();
        notifyListeners();
      },
    );
  }

  void _scheduleReconnect() {
    if (!_api.isLoggedIn || _reconnectTimer != null) return;
    final wait = _backoffMs;
    _backoffMs = ((_backoffMs * 2).clamp(1000, 15000)).toInt();
    _reconnectTimer = Timer(Duration(milliseconds: wait), () {
      _reconnectTimer = null;
      if (!live) _connect();
    });
  }

  void _applyEvent(Map<String, dynamic> event) {
    final id = event['id'] as String? ?? '';
    if (id.isEmpty) return;
    final deleted = event['deleted'] == true || event['op'] == 'delete';
    final remoteAt = event['updated_at'] as String?;
    if (deleted) {
      if (!_shouldApplyRemote(id, remoteAt)) return;
      pendingIds.remove(id);
      unawaited(_writeQueue((queue) => queue.upserts.remove(id)));
      final next = notes.where((note) => note.id != id).toList();
      if (next.length == notes.length) return;
      notes = next;
      unawaited(_persist());
      return;
    }
    final raw = event['note'];
    if (raw is! Map<String, dynamic>) return;
    final incoming = Note.fromJson(raw);
    if (!_shouldApplyRemote(incoming.id, remoteAt ?? incoming.updatedAt)) return;
    pendingIds.remove(incoming.id);
    unawaited(_writeQueue((queue) => queue.upserts.remove(incoming.id)));
    final index = notes.indexWhere((note) => note.id == incoming.id);
    if (index >= 0) {
      notes[index].applyFrom(incoming);
    } else {
      notes = [...notes, incoming];
    }
    unawaited(_persist());
  }

  DateTime _stamp(String? value) => DateTime.tryParse(value ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0);

  DateTime _usableStamp(String? value) {
    final parsed = _stamp(value);
    final now = DateTime.now().toUtc();
    if (parsed.isAfter(now.add(const Duration(seconds: 5)))) {
      return DateTime.fromMillisecondsSinceEpoch(0, isUtc: true);
    }
    return parsed.toUtc();
  }

  bool _shouldApplyRemote(String id, String? updatedAt) {
    final local = notes.where((note) => note.id == id).firstOrNull;
    if (local == null) return true;
    return _usableStamp(local.updatedAt).isBefore(_usableStamp(updatedAt));
  }

  void _forgetStale(List<Note> incoming) {
    final drop = <String>[];
    for (final note in incoming) {
      if (!pendingIds.contains(note.id)) continue;
      final local = notes.where((item) => item.id == note.id).firstOrNull;
      if (local != null && !_usableStamp(local.updatedAt).isBefore(_usableStamp(note.updatedAt))) continue;
      drop.add(note.id);
    }
    if (drop.isEmpty) return;
    pendingIds.removeAll(drop);
    unawaited(_writeQueue((queue) {
      for (final id in drop) {
        queue.upserts.remove(id);
      }
    }));
  }

  Set<String> pendingIds = {};

  void _put(Note note) {
    final index = notes.indexWhere((item) => item.id == note.id);
    if (index >= 0) {
      notes[index] = note;
    } else {
      notes = [...notes, note];
    }
    unawaited(_persist());
    notifyListeners();
  }

  void _enqueue(Note note) {
    pendingIds.add(note.id);
    unawaited(_writeQueue((queue) {
      queue.deletes.remove(note.id);
      queue.upserts[note.id] = note;
    }));
  }

  void _scheduleFlush() {
    _flushTimer?.cancel();
    _flushTimer = Timer(const Duration(milliseconds: 400), () => unawaited(flush()));
  }

  String get _userId => _api.user?.id ?? 'anon';
  String get _cacheKey => 'meeter.notes-cache.$_userId';
  String get _queueKey => 'meeter.sync-queue.$_userId';

  Future<void> _loadCache() async {
    if (!_api.isLoggedIn) {
      notes = [];
      pending = 0;
      pendingIds = {};
      notifyListeners();
      return;
    }
    final prefs = await SharedPreferences.getInstance();
    try {
      final raw = prefs.getString(_cacheKey) ?? prefs.getString('meeter.notes-cache');
      if (raw != null) {
        final items = jsonDecode(raw) as List<dynamic>;
        notes = items.map((item) => Note.fromJson(item as Map<String, dynamic>)).toList();
      } else {
        notes = [];
      }
    } catch (_) {
      notes = [];
    }
    final queue = await _queue();
    pending = queue.length;
    pendingIds = queue.upserts.keys.toSet();
    notifyListeners();
  }

  Future<void> _persist() async {
    if (!_api.isLoggedIn) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_cacheKey, jsonEncode(notes.map((note) => note.toSyncJson()).toList()));
  }

  Future<_Queue> _queue() async {
    final prefs = await SharedPreferences.getInstance();
    try {
      final raw = prefs.getString(_queueKey) ?? prefs.getString('meeter.sync-queue');
      if (raw == null) return _Queue();
      final parsed = jsonDecode(raw) as Map<String, dynamic>;
      final upsertsRaw = parsed['upserts'] as Map<String, dynamic>? ?? {};
      return _Queue(
        upserts: upsertsRaw.map((id, value) => MapEntry(id, Note.fromJson(value as Map<String, dynamic>))),
        deletes: (parsed['deletes'] as List<dynamic>? ?? []).map((item) => item.toString()).toList(),
      );
    } catch (_) {
      return _Queue();
    }
  }

  Future<void> _writeQueue(void Function(_Queue queue) update) async {
    final queue = await _queue();
    update(queue);
    pending = queue.length;
    pendingIds = queue.upserts.keys.toSet();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _queueKey,
      jsonEncode({
        'upserts': queue.upserts.map((id, note) => MapEntry(id, note.toSyncJson())),
        'deletes': queue.deletes,
      }),
    );
    notifyListeners();
  }

  Future<void> _dropFlushed(_Queue snapshot) async {
    await _writeQueue((queue) {
      for (final entry in snapshot.upserts.entries) {
        if (queue.upserts[entry.key]?.updatedAt == entry.value.updatedAt) {
          queue.upserts.remove(entry.key);
        }
      }
      queue.deletes.removeWhere(snapshot.deletes.contains);
    });
  }
}
