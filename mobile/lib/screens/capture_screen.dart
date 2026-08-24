import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:record/record.dart';

import '../api.dart';
import '../theme.dart';
import '../widgets.dart';
import 'detail_screen.dart';

class CaptureScreen extends StatefulWidget {
  const CaptureScreen({super.key});

  @override
  State<CaptureScreen> createState() => _CaptureScreenState();
}

class _CaptureScreenState extends State<CaptureScreen> {
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
      setState(() => _error = 'Necesitamos el micrófono para grabar.');
      return;
    }
    try {
      final dir = await getTemporaryDirectory();
      final path = '${dir.path}/recording-${DateTime.now().millisecondsSinceEpoch}.m4a';
      await _recorder.start(const RecordConfig(encoder: AudioEncoder.aacLc, numChannels: 1), path: path);
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
      if (_startedAt != null) _accumulated += DateTime.now().difference(_startedAt!);
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
      if (path == null) throw ApiException('No se generó el audio');
      final saved = await api.uploadRecording(
        file: File(path),
        title: _title.text.trim().isEmpty ? 'Llamada' : _title.text.trim(),
        durationSeconds: _accumulated.inMilliseconds / 1000,
      );
      if (!mounted) return;
      _title.clear();
      _elapsed = Duration.zero;
      final transcribe = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          backgroundColor: kPaper,
          title: const Text('Grabación lista'),
          content: const Text('¿La transcribimos ahora?'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Después')),
            TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Transcribir')),
          ],
        ),
      );
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => DetailScreen(recordingId: saved.id, autostart: transcribe == true ? 'transcribe' : null),
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
    final recColor = _state == 'recording' ? kRec : (_state == 'paused' ? kAccent : kCream);
    final tablet = isTablet(context);
    return CorkBackdrop(
      child: SafeArea(
        child: ListView(
        padding: EdgeInsets.fromLTRB(pagePadding(context), 8, pagePadding(context), 32),
        children: [
          const PageHeader(kicker: 'Captura', title: 'Grabar llamada'),
          Center(
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: tablet ? 560 : 480),
              child: PaperCard(
                child: Column(
                  children: [
                    Text(
                      'Usa el micrófono del teléfono o la tablet. El audio de Zoom o Teams no se puede interceptar.',
                      style: TextStyle(color: kMuted, fontSize: tablet ? 15 : 13),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 16),
                    TextField(controller: _title, enabled: _state == 'idle', decoration: const InputDecoration(hintText: 'Título de la llamada')),
                    if (_error.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      Text(_error, style: const TextStyle(color: kDanger, fontWeight: FontWeight.w700)),
                    ],
                    const SizedBox(height: 28),
                    Text(
                      _state == 'recording' ? 'GRABANDO' : (_state == 'paused' ? 'PAUSA' : 'LISTO'),
                      style: GoogleFonts.nunito(color: recColor == kCream ? kInk : recColor, fontWeight: FontWeight.w800, letterSpacing: 3),
                    ),
                    Text(formatClock(_elapsed), style: GoogleFonts.nunito(fontSize: tablet ? 64 : 52, fontWeight: FontWeight.w800, color: kInk)),
                    const SizedBox(height: 12),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: LinearProgressIndicator(
                        value: _meter < 0.06 ? 0.06 : _meter,
                        minHeight: 14,
                        color: kRec,
                        backgroundColor: const Color(0x223B2A12),
                      ),
                    ),
                    const SizedBox(height: 24),
                    Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      alignment: WrapAlignment.center,
                      children: [
                        FilledButton(
                          style: FilledButton.styleFrom(backgroundColor: kRec, foregroundColor: kCream),
                          onPressed: _state == 'idle' && !_busy ? _start : null,
                          child: const Text('Empezar'),
                        ),
                        OutlinedButton(
                          onPressed: _state == 'idle' || _busy ? null : _pauseOrResume,
                          child: Text(_state == 'paused' ? 'Seguir' : 'Pausa'),
                        ),
                        OutlinedButton(
                          style: OutlinedButton.styleFrom(foregroundColor: kDanger),
                          onPressed: _state == 'idle' || _busy ? null : _stop,
                          child: Text(_busy ? 'Guardando…' : 'Listo'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
      ),
    );
  }
}
