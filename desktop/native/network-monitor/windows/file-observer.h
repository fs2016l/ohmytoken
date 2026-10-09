#pragma once
#include "monitor.h"
#include <tdh.h>
#include <unordered_map>
#include <functional>
#include <algorithm>

namespace omt {
// Bounds apply globally, not once per selected Agent. Never opens or reads a watched file.
class FileObserver {
  struct Name { std::wstring path; uint64_t at; };
  struct Thread { HANDLE handle; uint64_t birth; DWORD pid; uint64_t seen; };
  struct Access { std::string process, path; uint64_t first, last, count; };
  std::unordered_map<uint64_t, Name> names;
  std::unordered_map<DWORD, Thread> threads;
  std::unordered_map<std::string, Access> accesses;
  std::vector<std::pair<std::wstring, std::wstring>> devices;
  size_t nameBytes = 0, accessBytes = 0;
  bool truncated = false, missing = false;
  static bool value(EVENT_RECORD* event, const wchar_t* field, void* data, ULONG size) {
    PROPERTY_DATA_DESCRIPTOR property{};
    property.PropertyName = reinterpret_cast<ULONGLONG>(field); property.ArrayIndex = ULONG_MAX;
    return TdhGetProperty(event, 0, nullptr, 1, &property, size, static_cast<PBYTE>(data)) == ERROR_SUCCESS;
  }
  static uint64_t pointer(EVENT_RECORD* event, const wchar_t* field) {
    uint64_t result = 0;
    value(event, field, &result, event->EventHeader.Flags & EVENT_HEADER_FLAG_32_BIT_HEADER ? 4 : 8);
    return result;
  }
  static DWORD threadId(EVENT_RECORD* event) {
    // Older FileIo schemas mark TTID as pointer-sized, newer ones expose a DWORD.
    for (const auto* field : {L"IssuingThreadId", L"TTID"}) {
      PROPERTY_DATA_DESCRIPTOR property{}; property.PropertyName = reinterpret_cast<ULONGLONG>(field); property.ArrayIndex = ULONG_MAX;
      ULONG size = 0; uint64_t result = 0;
      if (TdhGetPropertySize(event, 0, nullptr, 1, &property, &size) == ERROR_SUCCESS &&
          (size == 4 || size == 8) && value(event, field, &result, size) && result <= MAXDWORD) return static_cast<DWORD>(result);
    }
    return 0;
  }
  static std::wstring text(EVENT_RECORD* event, const wchar_t* field) {
    PROPERTY_DATA_DESCRIPTOR property{}; property.PropertyName = reinterpret_cast<ULONGLONG>(field); property.ArrayIndex = ULONG_MAX;
    ULONG bytes = 0;
    if (TdhGetPropertySize(event, 0, nullptr, 1, &property, &bytes) != ERROR_SUCCESS || bytes < 2 || bytes > 8192 || bytes % 2) return {};
    std::wstring result(bytes / 2, L'\0');
    if (TdhGetProperty(event, 0, nullptr, 1, &property, bytes, reinterpret_cast<PBYTE>(result.data())) != ERROR_SUCCESS) return {};
    result.resize(wcsnlen(result.c_str(), result.size()));
    if (std::any_of(result.begin(), result.end(), [](wchar_t c) { return c < 32; })) return {};
    return result;
  }
  void remember(uint64_t object, std::wstring path, uint64_t at) {
    if (!object || path.empty()) return;
    auto old = names.find(object);
    if (old != names.end()) { nameBytes -= old->second.path.size() * 2 + 128; names.erase(old); }
    const auto bytes = path.size() * 2 + 128;
    if (names.size() >= 8192 || nameBytes + bytes > 4 * 1024 * 1024) { truncated = true; return; }
    nameBytes += bytes; names.emplace(object, Name{std::move(path), at});
  }
  DWORD threadProcess(DWORD tid, uint64_t at) {
    auto entry = threads.find(tid);
    if (entry != threads.end()) {
      DWORD code = 0;
      if (!GetExitCodeThread(entry->second.handle, &code) || code != STILL_ACTIVE) {
        CloseHandle(entry->second.handle); threads.erase(entry); entry = threads.end();
      }
    }
    if (entry == threads.end()) {
      HANDLE handle = OpenThread(THREAD_QUERY_LIMITED_INFORMATION, FALSE, tid);
      if (!handle) return 0;
      FILETIME created{}, exited{}, kernel{}, user{};
      const DWORD pid = GetProcessIdOfThread(handle);
      if (!pid || !GetThreadTimes(handle, &created, &exited, &kernel, &user)) { CloseHandle(handle); return 0; }
      ULARGE_INTEGER birth{}; birth.LowPart = created.dwLowDateTime; birth.HighPart = created.dwHighDateTime;
      if (threads.size() >= 2048) { auto old = threads.begin(); CloseHandle(old->second.handle); threads.erase(old); }
      entry = threads.emplace(tid, Thread{handle, unixMillis(birth.QuadPart), pid, now()}).first;
    }
    entry->second.seen = now();
    // A reused thread ID cannot claim a buffered event from the previous thread.
    return entry->second.birth <= at ? entry->second.pid : 0;
  }
  std::string path(const std::wstring& input) const {
    for (const auto& [device, drive] : devices) {
      if (input.compare(0, device.size(), device) == 0 && input.size() > device.size() && input[device.size()] == L'\\') return utf8(drive + input.substr(device.size()));
    }
    return utf8(input);
  }
 public:
  bool enabled = false;
  uint64_t epoch = 0;
  FileObserver() {
    for (wchar_t letter = L'A'; letter <= L'Z'; ++letter) {
      std::wstring drive{letter, L':'}; wchar_t device[4096]{};
      if (QueryDosDeviceW(drive.c_str(), device, 4096)) devices.emplace_back(device, drive);
    }
  }
  ~FileObserver() { clear(); }
  void clear() {
    for (auto& [id, thread] : threads) CloseHandle(thread.handle);
    threads.clear(); names.clear(); accesses.clear(); nameBytes = accessBytes = 0; truncated = missing = false;
  }
  void event(EVENT_RECORD* event, const std::function<std::string(DWORD, uint64_t)>& owner) {
    if (!enabled) return;
    const auto op = event->EventHeader.EventDescriptor.Opcode;
    const auto at = unixMillis(event->EventHeader.TimeStamp.QuadPart);
    if (op == 0 || op == 32 || op == 36) { remember(pointer(event, L"FileObject"), text(event, L"FileName"), at); return; }
    if (op == 35 || op == 66) {
      auto entry = names.find(pointer(event, L"FileObject"));
      if (entry != names.end()) { nameBytes -= entry->second.path.size() * 2 + 128; names.erase(entry); }
      return;
    }
    if (op != 64 && op != 67) return;
    const DWORD tid = threadId(event);
    if (!tid) { missing = true; return; }
    const auto key = owner(threadProcess(tid, at), at);
    if (key.empty()) return;
    const auto object = pointer(event, L"FileObject");
    if (op == 64) { remember(object, text(event, L"OpenPath"), at); return; }
    auto entry = names.find(object);
    if (entry == names.end()) entry = names.find(pointer(event, L"FileKey"));
    if (entry == names.end() || entry->second.at > at) { missing = true; return; }
    entry->second.at = at;
    const auto name = path(entry->second.path), id = key + "\n" + name;
    auto found = accesses.find(id);
    if (found == accesses.end()) {
      const auto bytes = id.size() + name.size() + 256;
      if (accesses.size() >= 2048 || accessBytes + bytes > 2 * 1024 * 1024) { truncated = true; return; }
      accessBytes += bytes;
      accesses.emplace(id, Access{key, name, at, at, 1});
    } else { found->second.first = std::min(found->second.first, at); found->second.last = std::max(found->second.last, at); found->second.count++; }
  }
  std::vector<std::string> drain() {
    std::vector<std::string> result;
    if (!enabled) return result;
    const auto prefix = "{\"type\":\"files\",\"epoch\":" + std::to_string(epoch) + ",\"files\":[";
    std::string batch; size_t count = 0;
    for (const auto& [id, file] : accesses) {
      if (count++) batch += ',';
      batch += "{\"processKey\":" + quote(file.process) + ",\"path\":" + quote(file.path) + ",\"operation\":\"read\",\"firstAt\":" + std::to_string(file.first) + ",\"lastAt\":" + std::to_string(file.last) + ",\"count\":" + std::to_string(file.count) + "}";
      if (count == 64) { result.push_back(prefix + batch + "]}"); batch.clear(); count = 0; }
    }
    if (count) result.push_back(prefix + batch + "]}");
    accesses.clear(); accessBytes = 0;
    for (const auto* issue : {truncated ? "capacity-reached" : nullptr, missing ? "path-unavailable" : nullptr}) if (issue) result.push_back(status("running", issue));
    truncated = missing = false;
    const auto cutoff = now() - 120000;
    for (auto it = names.begin(); it != names.end();) {
      if (it->second.at < cutoff) { nameBytes -= it->second.path.size() * 2 + 128; it = names.erase(it); } else ++it;
    }
    for (auto it = threads.begin(); it != threads.end();) {
      if (it->second.seen < cutoff) { CloseHandle(it->second.handle); it = threads.erase(it); } else ++it;
    }
    return result;
  }
  std::string status(const char* state, const char* issue = nullptr) const {
    return "{\"type\":\"file-status\",\"epoch\":" + std::to_string(epoch) + ",\"state\":" + quote(std::string(state)) + (issue ? ",\"issue\":" + quote(std::string(issue)) : "") + "}";
  }
};
}
