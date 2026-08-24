import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController _url;
  Meta? _meta;
  String _message = '';
  String _error = '';

  @override
  void initState() {
    super.initState();
    final api = context.read<ApiClient>();
    _url = TextEditingController(text: api.baseUrl);
    _refreshMeta();
  }

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _refreshMeta() async {
    try {
      final meta = await context.read<ApiClient>().getMeta();
      if (!mounted) return;
      setState(() {
        _meta = meta;
        _error = '';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    }
  }

  Future<void> _save() async {
    setState(() {
      _error = '';
      _message = '';
    });
    await context.read<ApiClient>().setBaseUrl(_url.text);
    setState(() => _message = 'URL guardada. El teléfono hablará con este backend.');
    await _refreshMeta();
  }

  @override
  Widget build(BuildContext context) {
    final api = context.watch<ApiClient>();
    return CorkBackdrop(
      child: SafeArea(
        child: ListView(
        padding: EdgeInsets.fromLTRB(pagePadding(context), 8, pagePadding(context), 32),
        children: [
          const PageHeader(kicker: 'Cuenta', title: 'Ajustes'),
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: Column(
                children: [
                  PaperCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(api.user?.name.isNotEmpty == true ? api.user!.name : 'Meeter', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
                        Text(api.user?.email ?? '', style: const TextStyle(color: kMuted)),
                        const SizedBox(height: 16),
                        const Text('URL del API', style: TextStyle(fontWeight: FontWeight.w800)),
                        const SizedBox(height: 6),
                        TextField(controller: _url, autocorrect: false, decoration: const InputDecoration(hintText: defaultApiBase)),
                        const SizedBox(height: 8),
                        const Text(
                          'En un teléfono físico usa la IP de tu Mac, no 127.0.0.1. Misma Wi‑Fi. Puerto 8001.',
                          style: TextStyle(color: kMuted, fontSize: 12),
                        ),
                        const SizedBox(height: 12),
                        FilledButton(onPressed: _save, child: const Text('Guardar URL')),
                        const SizedBox(height: 8),
                        OutlinedButton(
                          onPressed: () => api.logout(),
                          child: const Text('Salir'),
                        ),
                        if (_message.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 10), child: Text(_message, style: const TextStyle(color: kMint))),
                        if (_error.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 10), child: Text(_error, style: const TextStyle(color: kDanger))),
                      ],
                    ),
                  ),
                  if (_meta != null) ...[
                    const SizedBox(height: 14),
                    PaperCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Backend', style: TextStyle(fontWeight: FontWeight.w800)),
                          Text('Transcripción: ${_meta!.transcriptionProvider}', style: const TextStyle(color: kMuted)),
                          Text('IA: ${_meta!.aiProvider} / ${_meta!.aiModel}', style: const TextStyle(color: kMuted)),
                          Text('Clave de IA: ${_meta!.apiKeyConfigured ? 'sí' : 'no'}', style: const TextStyle(color: kMuted)),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
      ),
    );
  }
}
