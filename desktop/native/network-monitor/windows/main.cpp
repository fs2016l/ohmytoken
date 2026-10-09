#include "monitor.h"
#include <iostream>

int wmain(int argc, wchar_t** argv) {
  std::wstring session;
  DWORD parent = 0; bool elevate = false, list = false;
  for (int i = 1; i < argc; i++) {
    const std::wstring arg(argv[i]);
    if (arg == L"--list") list = true;
    else if (arg == L"--allow-elevation") elevate = true;
    else if (arg == L"--no-elevation") elevate = false;
    else if (arg == L"--session" && i + 1 < argc) session = argv[++i];
    else if (arg == L"--parent" && i + 1 < argc) parent = wcstoul(argv[++i], nullptr, 10);
    else return 2;
  }
  if (list) {
    for (const auto& row : omt::snapshot(omt::userSid(GetCurrentProcess())))
      std::cout << "{\"type\":\"processes\",\"processes\":[" << row.json() << "]}\n";
    return 0;
  }
  if (!parent || session.size() != 32 || session.find_first_not_of(L"0123456789abcdef") != std::wstring::npos) return 2;
  return omt::collect(session, parent, elevate);
}
