import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';

class NoteEditor extends StatefulWidget {
  const NoteEditor({super.key, required this.note, this.embedded = false, this.onClose});

  final Note note;
  final bool embedded;
  final VoidCallback? onClose;

  @override
  State<NoteEditor> createState() => _NoteEditorState();
}

class _NoteEditorState extends State<NoteEditor> {
  late final TextEditingController _title;
  late final TextEditingController _body;
  late String _color;
  late int _priority;
  String _error = '';
  bool _busy = false;

  Note get note => widget.note;
  bool get canEdit => note.canEdit;

  @override
  void initState() {
    super.initState();
    _title = TextEditingController(text: note.title);
    _body = TextEditingController(text: note.plainText);
    _color = note.color;
    _priority = note.priority;
  }

  @override
  void didUpdateWidget(covariant NoteEditor oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.note.id != widget.note.id) {
      _title.text = widget.note.title;
      _body.text = widget.note.plainText;
      _color = widget.note.color;
      _priority = widget.note.priority;
    }
  }

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!canEdit) return;
    setState(() => _busy = true);
    try {
      await context.read<ApiClient>().updateNote(note.id, {
        'title': _title.text.trim(),
        'body': note.mergeText(_body.text),
        'color': _color,
        'priority': _priority,
      });
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _patch(Map<String, dynamic> payload) async {
    if (!note.isOwner) return;
    await context.read<ApiClient>().updateNote(note.id, payload);
    widget.onClose?.call();
    if (!widget.embedded && mounted) Navigator.pop(context);
  }

  Future<void> _share() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: kPaper,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (_) => ShareSheet(note: note),
    );
  }

  @override
  Widget build(BuildContext context) {
    final body = PaperCard(
      color: noteColorOf(_color),
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
      child: Column(
        children: [
          Row(
            children: [
              if (widget.embedded)
                IconButton(onPressed: widget.onClose, icon: const Icon(Icons.close, color: kInk)),
              Expanded(
                child: TextField(
                  controller: _title,
                  readOnly: !canEdit,
                  onEditingComplete: _save,
                  onTapOutside: (_) => _save(),
                  style: GoogleFonts.caveat(fontSize: 28, fontWeight: FontWeight.w700, color: kInk),
                  decoration: const InputDecoration(
                    hintText: 'Título (opcional)',
                    filled: false,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                  ),
                ),
              ),
              if (note.canShare)
                IconButton(onPressed: _share, icon: const Icon(Icons.ios_share, color: kInk)),
              if (note.isOwner) ...[
                IconButton(onPressed: () => _patch({'pinned': true, 'archived': false}), icon: const Icon(Icons.check, color: kInk)),
                IconButton(onPressed: () => _patch({'archived': true, 'pinned': false}), icon: const Icon(Icons.delete_outline, color: kDanger)),
              ],
            ],
          ),
          if (!note.isOwner)
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                note.access == 'write' ? 'Compartida · puedes editar' : 'Compartida · solo lectura',
                style: const TextStyle(color: kMuted, fontWeight: FontWeight.w700, fontSize: 12),
              ),
            ),
          Expanded(
            child: TextField(
              controller: _body,
              readOnly: !canEdit,
              maxLines: null,
              expands: true,
              onEditingComplete: _save,
              onTapOutside: (_) => _save(),
              style: GoogleFonts.nunito(fontSize: 16, height: 1.4, color: kInk),
              decoration: const InputDecoration(
                hintText: 'Escribe aquí…',
                filled: false,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
              ),
            ),
          ),
          if (canEdit) ...[
            Wrap(
              spacing: 8,
              children: notePalette.entries
                  .map(
                    (entry) => GestureDetector(
                      onTap: () {
                        setState(() => _color = entry.key);
                        _save();
                      },
                      child: CircleAvatar(
                        radius: 12,
                        backgroundColor: entry.value,
                        child: _color == entry.key ? const Icon(Icons.check, size: 14, color: kInk) : null,
                      ),
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 10),
            Row(
              children: List.generate(5, (index) {
                final level = index + 1;
                return Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ChoiceChip(
                    label: Text('$level'),
                    selected: _priority == level,
                    onSelected: (_) {
                      setState(() => _priority = level);
                      _save();
                    },
                  ),
                );
              }),
            ),
          ],
          if (_error.isNotEmpty) Text(_error, style: const TextStyle(color: kDanger)),
          if (_busy) const LinearProgressIndicator(color: kInk, minHeight: 2),
        ],
      ),
    );

    if (widget.embedded) return body;
    return Scaffold(
      backgroundColor: kCork,
      appBar: AppBar(
        title: const Text('Nota'),
        actions: [
          if (note.canShare) IconButton(onPressed: _share, icon: const Icon(Icons.ios_share)),
        ],
      ),
      body: CorkBackdrop(
        child: Padding(
          padding: EdgeInsets.fromLTRB(pagePadding(context), 8, pagePadding(context), 20),
          child: body,
        ),
      ),
    );
  }
}

class ShareSheet extends StatefulWidget {
  const ShareSheet({super.key, required this.note});
  final Note note;

  @override
  State<ShareSheet> createState() => _ShareSheetState();
}

class _ShareSheetState extends State<ShareSheet> {
  final _identifier = TextEditingController();
  bool _read = true;
  bool _write = false;
  bool _busy = false;
  String _error = '';
  List<NoteShare> _people = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _identifier.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final people = await context.read<ApiClient>().listShares(widget.note.id);
      if (mounted) setState(() => _people = people);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  Future<void> _share() async {
    if (_identifier.text.trim().isEmpty) {
      setState(() => _error = 'Escribe un nombre o correo.');
      return;
    }
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      final person = await context.read<ApiClient>().shareNote(
            widget.note.id,
            identifier: _identifier.text.trim(),
            canRead: _read || _write,
            canWrite: _write,
          );
      setState(() {
        _people = [..._people.where((item) => item.id != person.id), person];
        _identifier.clear();
      });
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Compartir nota', style: GoogleFonts.nunito(fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 10),
          TextField(controller: _identifier, decoration: const InputDecoration(hintText: 'ana o ana@correo.com')),
          Row(
            children: [
              FilterChip(
                label: const Text('Lectura'),
                selected: _read,
                onSelected: (on) => setState(() => _read = on || _write),
              ),
              const SizedBox(width: 8),
              FilterChip(
                label: const Text('Escritura'),
                selected: _write,
                onSelected: (on) => setState(() {
                  _write = on;
                  if (on) _read = true;
                }),
              ),
            ],
          ),
          if (_error.isNotEmpty) Text(_error, style: const TextStyle(color: kDanger)),
          FilledButton(onPressed: _busy ? null : _share, child: Text(_busy ? 'Un segundo…' : 'Compartir')),
          const SizedBox(height: 12),
          if (_people.isEmpty)
            const Text('Aún no está compartida.', style: TextStyle(color: kMuted))
          else
            ..._people.map(
              (person) => ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(person.name.isEmpty ? person.email : person.name),
                subtitle: Text(person.email),
                trailing: IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () async {
                    await context.read<ApiClient>().unshare(widget.note.id, person.id);
                    setState(() => _people = _people.where((item) => item.id != person.id).toList());
                  },
                ),
              ),
            ),
        ],
      ),
    );
  }
}
