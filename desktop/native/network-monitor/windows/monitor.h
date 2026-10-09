#pragma once
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <winsock2.h>
#include <windows.h>
#include <evntrace.h>
#include <evntcons.h>
#include <string>
#include <vector>
#include <cstdint>

namespace omt {
struct Process {
  DWORD pid = 0, parent = 0;
  uint64_t birth = 0, started = 0;
  std::wstring path, name, entry;
  std::string verifiedParentKey;
  std::string key() const;
  std::string json() const;
};
uint64_t now();
uint64_t unixMillis(uint64_t filetime);
std::string utf8(const std::wstring& text);
std::string quote(const std::string& text);
std::string quote(const std::wstring& text);
std::wstring userSid(HANDLE process);
bool readProcess(DWORD pid, DWORD parent, const std::wstring& sid, Process& result);
std::vector<Process> snapshot(const std::wstring& sid);

class Pipe {
  HANDLE handle = INVALID_HANDLE_VALUE;
  HANDLE parent = nullptr;
 public:
  ~Pipe();
  bool connect(const std::wstring& name, DWORD parentPid, const std::wstring& sid);
  bool write(const std::string& line);
  bool read(std::string& text, HANDLE stop);
  bool parentAlive() const;
  void cancel();
};
int collect(const std::wstring& sessionId, DWORD parentPid, bool elevate);
}
