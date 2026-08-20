import 'package:flutter_test/flutter_test.dart';

import 'package:ai_call_recorder/api.dart';
import 'package:ai_call_recorder/theme.dart';

void main() {
  test('status labels map analyzed to Completed', () {
    expect(statusLabel('analyzed'), 'Completed');
    expect(formatDuration(90), contains('min'));
  });

  test('default API URL is the Mac LAN address, not localhost', () {
    expect(defaultApiBase, 'http://192.168.0.31:8001');
    expect(defaultApiBase.contains('127.0.0.1'), isFalse);
  });
}
