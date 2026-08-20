import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:record/record.dart';

import '../api.dart';
import '../theme.dart';
import 'detail_screen.dart';

class RecordScreen extends StatefulWidget {
  const RecordScreen({super.key, this.standalone = false});

  final bool standalone;

  @override
  State<RecordScreen> createState() => _RecordScreenState();
}

class _RecordScreenState extends State<RecordScreen> {
  final _recorder = AudioRecorder();
  final _title = TextEditingController();
  String _state = 'idle';
  Duration _elapsed = Duration.zero;
  double _meter = 0;
  bool _busy = false;
  String _error = '';
  DateTime? _startedAt;
  Duration _accumulated = Duration.zero;
  Timer? _ticker;

  @override
  void dispose() {
    _ticker?.cancel();
    _title.dispose();
    _recorder.dispose();
    super.dispose();
  }

  void _tick() {
    _ticker?.cancel();
    _ticker = Timer.periodic(const Duration(milliseconds: 200), (_) async {
      if (!mounted || _state == 'idle') return;
      final now = _state == 'recording' && _startedAt != null
          ? _accumulated + DateTime.now().difference(_startedAt!)
          : _accumulated;
      var meter = _meter;
      try {
        final amp = await _recorder.getAmplitude();
        meter = ((amp.current + 60) / 60).clamp(0, 1);
      } catch (_) {}
      setState(() {
        _elapsed = now;
        _meter = meter;
      });
    });
  }

  Future<void> _start() async {
    setState(() => _error = '');
    final allowed = await _recorder.hasPermission();
    if (!allowed) {
      setState(() => _error = 'Microphone permission is required to record.');
      return;
    }
    try {
      final dir = await getTemporaryDirectory();
      final path = '${dir.path}/recording-${DateTime.now().millisecondsSinceEpoch}.m4a';
      await _recorder.start(
        const RecordConfig(encoder: AudioEncoder.aacLc, numChannels: 1),
        path: path,
      );
      _startedAt = DateTime.now();
      _accumulated = Duration.zero;
      setState(() => _state = 'recording');
      _tick();
    } catch (error) {
      setState(() => _error = error.toString());
    }
  }

  Future<void> _pauseOrResume() async {
    if (_state == 'recording') {
      await _recorder.pause();
      if (_startedAt != null) {
        _accumulated += DateTime.now().difference(_startedAt!);
      }
      setState(() => _state = 'paused');
      return;
    }
    await _recorder.resume();
    _startedAt = DateTime.now();
    setState(() => _state = 'recording');
  }

  Future<void> _stop() async {
    setState(() => _busy = true);
    final api = context.read<ApiClient>();
    try {
      final path = await _recorder.stop();
      _ticker?.cancel();
      if (_state == 'recording' && _startedAt != null) {
        _accumulated += DateTime.now().difference(_startedAt!);
      }
      setState(() {
        _state = 'idle';
        _meter = 0;
      });
      if (path == null) throw ApiException('No audio file was produced');
      final saved = await api.uploadRecording(
            file: File(path),
            title: _title.text.trim().isEmpty ? 'Untitled recording' : _title.text.trim(),
            durationSeconds: _accumulated.inMilliseconds / 1000,
          );
      if (!mounted) return;
      _title.clear();
      _elapsed = Duration.zero;
      final transcribe = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          backgroundColor: kCard,
          title: const Text('Recording saved', style: TextStyle(color: kText)),
          content: const Text('Transcribe this recording now?', style: TextStyle(color: kMuted)),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Later')),
            TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Transcribe')),
          ],
        ),
      );
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => DetailScreen(
            recordingId: saved.id,
            autostart: transcribe == true ? 'transcribe' : null,
          ),
        ),
      );
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final recColor = _state == 'recording' ? kRec : (_state == 'paused' ? kWarning : kMuted);
    final label = _state == 'recording' ? 'REC' : (_state == 'paused' ? 'PAUSED' : 'READY');
    final body = ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Text('New recording', style: TextStyle(color: kText, fontSize: 28, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        const Text(
          'Mobile capture uses the phone microphone. System audio from Zoom or Teams is not available on iOS/Android.',
          style: TextStyle(color: kMuted, fontSize: 14),
        ),
        const SizedBox(height: 18),
        TextField(
          controller: _title,
          enabled: _state == 'idle',
          style: const TextStyle(color: kText),
          decoration: const InputDecoration(hintText: 'Meeting title'),
        ),
        if (_error.isNotEmpty) ...[
          const SizedBox(height: 10),
          Text(_error, style: const TextStyle(color: kDanger)),
        ],
        const SizedBox(height: 36),
        Text(label, textAlign: TextAlign.center, style: TextStyle(color: recColor, fontWeight: FontWeight.w800, letterSpacing: 3)),
        Text(formatClock(_elapsed), textAlign: TextAlign.center, style: const TextStyle(color: kText, fontSize: 52, fontWeight: FontWeight.w800)),
        const SizedBox(height: 18),
        ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: LinearProgressIndicator(
            value: _meter < 0.06 ? 0.06 : _meter,
            minHeight: 16,
            color: kAccent,
            backgroundColor: const Color(0xFF15171F),
          ),
        ),
        const SizedBox(height: 28),
        Row(
          children: [
            Expanded(
              child: FilledButton(
                style: FilledButton.styleFrom(backgroundColor: kRec),
                onPressed: _state == 'idle' && !_busy ? _start : null,
                child: const Text('Start'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: OutlinedButton(
                onPressed: _state == 'idle' || _busy ? null : _pauseOrResume,
                child: Text(_state == 'paused' ? 'Resume' : 'Pause'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: OutlinedButton(
                style: OutlinedButton.styleFrom(foregroundColor: kDanger, side: const BorderSide(color: kDanger)),
                onPressed: _state == 'idle' || _busy ? null : _stop,
                child: const Text('Stop'),
              ),
            ),
          ],
        ),
      ],
    );
    if (!widget.standalone) return body;
    return Scaffold(
      appBar: AppBar(title: const Text('Record')),
      body: body,
    );
  }
}
