#include "monitor.h"
#include <tlhelp32.h>
#include <sddl.h>
#include <shellapi.h>
#include <winternl.h>
#include <sstream>
#include <algorithm>

namespace omt {
uint64_t unixMillis(uint64_t ft) { return ft / 10000 - 11644473600000ULL; }
uint64_t now() {
  FILETIME ft; GetSystemTimeAsFileTime(&ft);
  return unixMillis((uint64_t(ft.dwHighDateTime) << 32) | ft.dwLowDateTime);
}
std::string utf8(const std::wstring& text) {
  const auto size = WideCharToMultiByte(CP_UTF8, 0, text.data(), int(text.size()), nullptr, 0, nullptr, nullptr);
  std::string value(size, 0);
  if (size) WideCharToMultiByte(CP_UTF8, 0, text.data(), int(text.size()), value.data(), size, nullptr, nullptr);
  return value;
}
std::string quote(const std::string& text) {
  std::string result = "\"";
  for (unsigned char c : text) {
    if (c == '"' || c == '\\') { result += '\\'; result += c; }
    else if (c >= 32) result += c;
  }
  return result + '"';
}
std::string quote(const std::wstring& text) { return quote(utf8(text)); }
std::string Process::key() const { return std::to_string(pid) + ":" + std::to_string(birth); }
std::string Process::json() const {
  return "{\"pid\":" + std::to_string(pid) + ",\"key\":" + quote(key()) +
    ",\"parentPid\":" + std::to_string(parent) + ",\"parentKey\":" + (verifiedParentKey.empty() ? "null" : quote(verifiedParentKey)) + ",\"startedAt\":" + std::to_string(started) +
    ",\"path\":" + quote(path) + ",\"name\":" + quote(name) + (entry.empty() ? "" : ",\"entryPoint\":" + quote(entry)) + "}";
}
std::wstring userSid(HANDLE process) {
  HANDLE token = nullptr;
  if (!OpenProcessToken(process, TOKEN_QUERY, &token)) return {};
  DWORD size = 0; GetTokenInformation(token, TokenUser, nullptr, 0, &size);
  std::vector<BYTE> data(size);
  bool ok = size && GetTokenInformation(token, TokenUser, data.data(), size, &size);
  CloseHandle(token);
  if (!ok) return {};
  LPWSTR sid = nullptr;
  if (!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(data.data())->User.Sid, &sid)) return {};
  std::wstring result(sid); LocalFree(sid); return result;
}
static std::wstring lower(std::wstring value) {
  std::transform(value.begin(), value.end(), value.begin(), [](wchar_t c) { return wchar_t(towlower(c)); });
  return value;
}
static std::wstring entryPoint(HANDLE process, const std::wstring& name) {
  const auto base = lower(name);
  const bool runtime = base == L"node.exe" || base == L"nodejs.exe" || base == L"bun.exe" || base == L"deno.exe" || base.rfind(L"python", 0) == 0 || base.rfind(L"pypy", 0) == 0;
  if (!runtime) return {};
  // This undocumented information class is optional metadata only. Failure never
  // widens a Node/Python rule to every interpreter process.
  using Query = NTSTATUS(NTAPI*)(HANDLE, PROCESSINFOCLASS, PVOID, ULONG, PULONG);
  auto query = reinterpret_cast<Query>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryInformationProcess"));
  if (!query) return {};
  ULONG needed = 0;
  query(process, static_cast<PROCESSINFOCLASS>(60), nullptr, 0, &needed);
  if (!needed || needed > 128 * 1024) return {};
  std::vector<BYTE> buffer(needed);
  if (query(process, static_cast<PROCESSINFOCLASS>(60), buffer.data(), needed, &needed) < 0) return {};
  const auto line = reinterpret_cast<UNICODE_STRING*>(buffer.data());
  const auto start = reinterpret_cast<uintptr_t>(line->Buffer), begin = reinterpret_cast<uintptr_t>(buffer.data());
  if (start < begin || start + line->Length > begin + buffer.size()) return {};
  std::wstring raw(line->Buffer, line->Length / sizeof(wchar_t));
  int count = 0; auto argv = CommandLineToArgvW(raw.c_str(), &count);
  SecureZeroMemory(raw.data(), raw.size() * sizeof(wchar_t));
  SecureZeroMemory(buffer.data(), buffer.size());
  if (!argv) return {};
  std::wstring result;
  for (int i = 1; i < count; i++) {
    const std::wstring arg(argv[i]);
    if (arg.rfind(L"-e", 0) == 0 || arg.rfind(L"-c", 0) == 0 || arg.rfind(L"-p", 0) == 0 || arg.rfind(L"--eval", 0) == 0 || arg.rfind(L"--print", 0) == 0 || arg == L"-") break;
    if (arg == L"-m" && i + 1 < count) {
      const std::wstring module(argv[i + 1]);
      if (module.find_first_not_of(L"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-") == std::wstring::npos) result = L"module:" + module;
      break;
    }
    if (arg == L"--require" || arg == L"-r" || arg == L"--import" || arg == L"--loader" || arg == L"--conditions" || arg == L"--title" || arg == L"--env-file" || arg == L"--env-file-if-exists" || arg == L"-W" || arg == L"-X") { ++i; continue; }
    if (!arg.empty() && arg[0] == L'-') {
      if (arg.find(L'=') != std::wstring::npos || arg == L"--" || arg == L"--no-warnings" || arg == L"--enable-source-maps" || arg == L"--experimental-strip-types" || arg == L"--inspect" || arg == L"--inspect-brk" || arg == L"--preserve-symlinks" || arg == L"--preserve-symlinks-main" || arg == L"--no-deprecation" || arg == L"--trace-warnings" || arg == L"-u" || arg == L"-B" || arg == L"-E" || arg == L"-I" || arg == L"-O" || arg == L"-OO" || arg == L"-q" || arg == L"-s" || arg == L"-S" || arg == L"-v" || arg == L"-b" || arg == L"-bb" || arg == L"-x") continue;
      break; // An unknown option may consume a path argument; never guess it is the script.
    }
    if ((base == L"bun.exe" || base == L"deno.exe") && arg == L"run") continue;
    const bool absolute = (arg.size() > 2 && arg[1] == L':' && (arg[2] == L'\\' || arg[2] == L'/')) || arg.rfind(L"\\\\", 0) == 0;
    // A relative script name cannot identify an application without a verified
    // working directory. Leave it instance-only rather than grouping all cli.js.
    if (absolute) result = arg;
    break; // Arguments following the entry point are never copied or logged.
  }
  for (int i = 0; i < count; i++) SecureZeroMemory(argv[i], wcslen(argv[i]) * sizeof(wchar_t));
  LocalFree(argv); return result;
}
bool readProcess(DWORD pid, DWORD parent, const std::wstring& sid, Process& result) {
  HANDLE handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!handle) return false;
  FILETIME created{}, exit{}, kernel{}, user{};
  wchar_t path[32768]; DWORD size = DWORD(std::size(path));
  const bool ok = userSid(handle) == sid && GetProcessTimes(handle, &created, &exit, &kernel, &user) && QueryFullProcessImageNameW(handle, 0, path, &size);
  if (ok) {
    result.pid = pid; result.parent = parent; result.path.assign(path, size);
    result.name = result.path.substr(result.path.find_last_of(L"\\/") + 1);
    result.birth = (uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime;
    result.started = unixMillis(result.birth);
    result.entry = entryPoint(handle, result.name);
  }
  CloseHandle(handle); return ok;
}
std::vector<Process> snapshot(const std::wstring& sid) {
  std::vector<Process> result;
  HANDLE handle = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (handle == INVALID_HANDLE_VALUE) return result;
  PROCESSENTRY32W row{}; row.dwSize = sizeof(row);
  if (Process32FirstW(handle, &row)) do {
    Process item;
    if (readProcess(row.th32ProcessID, row.th32ParentProcessID, sid, item)) result.push_back(std::move(item));
  } while (Process32NextW(handle, &row));
  CloseHandle(handle); return result;
}
}
