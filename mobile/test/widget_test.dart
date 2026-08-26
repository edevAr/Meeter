import 'package:flutter_test/flutter_test.dart';

import 'package:ai_call_recorder/api.dart';
import 'package:ai_call_recorder/models.dart';
import 'package:ai_call_recorder/theme.dart';

void main() {
  test('status labels are in Spanish', () {
    expect(statusLabel('analyzed'), 'Lista');
    expect(formatDuration(90), contains('min'));
  });

  test('default API URL is the Mac LAN address, not localhost', () {
    expect(defaultApiBase, 'http://192.168.0.31:8001');
    expect(defaultApiBase.contains('127.0.0.1'), isFalse);
  });

  test('day key pads month and day', () {
    expect(dayKey(DateTime(2026, 8, 3)), '2026-08-03');
  });

  test('note ids are stable uuids for offline sync', () {
    final id = newNoteId();
    expect(id.contains('local-'), isFalse);
    expect(id.split('-').length, 5);
  });
}
